// metaemotion.js
// Provides:
//  - initMetaEmotion(params): loads CSV lists (via fetch), returns promise resolving to state object
//  - buildMetaEmotionCalibrationChunk(state, nTrials, chunkIndex): returns timeline array and advances cursor
//  - buildMetaEmotionReview(state, nItems): timeline array
//  - buildMetaEmotionMetaJ(state, nTrials): timeline array
//  - exportMetaEmotion(state, jsPsych): returns {caliCsvText, metaJCsvText, pracCsvText}
//
// NOTE: This uses the Matlab-style CSV formats (no header) expected by the original study.

const META_PATHS = {
  assets: "assets/",
  practice: "stimuli/practice/",
  formal: "stimuli/formal/",
  lists: "lists/"
};

const META_TIMING = { pic_ms: 500, fix_ms: 500, iti_ms: 500, review_ms: 500 };

const META_KEYS = { start: [" "], choice12: ["1","2"], conf1234: ["1","2","3","4"] };

// GetSecs-like clock for timestamps (seconds)
const GETSECS_OFFSET = 8000;
let _metaStartSec = null;
function getSecs(){
  if (_metaStartSec === null) _metaStartSec = performance.now()/1000;
  return GETSECS_OFFSET + (performance.now()/1000 - _metaStartSec);
}

function pad2(n){ return String(n).padStart(2,"0"); }
function matlabTimestamp(d=new Date()){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}_${pad2(d.getHours())}.${pad2(d.getMinutes())}`; }

function basenameMaybe(x){ const s=String(x||"").trim(); return s.split(/[/\\]/).pop().trim(); }
function picIdFromFilename(filename){ const m = basenameMaybe(filename).match(/\d+/); return m?Number(m[0]):NaN; }

function resolveTrialLimit(requested, total){
  if (requested === undefined || requested === null || requested === "ALL" || requested === Infinity) {
    return total;
  }
  const n = Math.floor(Number(requested));
  if (!Number.isFinite(n)) return total;
  return Math.max(0, Math.min(total, n));
}

async function loadCSV(url){
  const r = await fetch(url, {cache:"no-store"});
  if(!r.ok) throw new Error(`Failed to load CSV: ${url}`);
  return (await r.text()).replace(/^\uFEFF/,"").replace(/\r\n/g,"\n").replace(/\r/g,"\n");
}

function parseCSV(text){
  const rows=[]; let row=[]; let cell=""; let inQ=false;
  for(let i=0;i<text.length;i++){
    const c=text[i], n=text[i+1];
    if(c === '"' && inQ && n === '"'){ cell+='"'; i++; }
    else if(c === '"'){ inQ=!inQ; }
    else if(c === "," && !inQ){ row.push(cell); cell=""; }
    else if(c === "\n" && !inQ){ row.push(cell); cell=""; if(row.some(v=>String(v).trim().length>0)) rows.push(row.map(String)); row=[]; }
    else { cell+=c; }
  }
  row.push(cell); if(row.some(v=>String(v).trim().length>0)) rows.push(row.map(String));
  return rows;
}

function parsePairsWithCat(csvText){
  const rows=parseCSV(csvText); if(rows.length<2) return [];
  const header=rows[0].map(h=>String(h).trim().toLowerCase());
  const i1 = header.indexOf("pic1")>=0 ? header.indexOf("pic1") : header.indexOf("p1");
  const i2 = header.indexOf("pic2")>=0 ? header.indexOf("pic2") : header.indexOf("p2");
  let ic = header.indexOf("category"); if(ic<0) ic = header.indexOf("cat");
  if(ic<0) ic = 2; // fallback third col
  if(i1<0 || i2<0) throw new Error("calibration_pairs.csv must have pic1,pic2,(category)");
  return rows.slice(1).map(r=>({
    p1: basenameMaybe(r[i1]),
    p2: basenameMaybe(r[i2]),
    cat: Number(String(r[ic]??"").match(/\d+/)?.[0] ?? NaN)
  })).filter(t=>t.p1 && t.p2);
}

function parsePracticePairs(csvText){
  const rows=parseCSV(csvText); if(rows.length<2) return [];
  const header=rows[0].map(h=>String(h).trim().toLowerCase());
  const i1 = header.indexOf("pic1")>=0 ? header.indexOf("pic1") : header.indexOf("p1");
  const i2 = header.indexOf("pic2")>=0 ? header.indexOf("pic2") : header.indexOf("p2");
  let ic = header.indexOf("category"); if(ic<0) ic = header.indexOf("cat"); if(ic<0) ic = header.indexOf("note");
  if(ic<0) ic = 2;
  return rows.slice(1).map(r=>({
    p1: basenameMaybe(r[i1]),
    p2: basenameMaybe(r[i2]),
    cat: Number(String(r[ic]??"").match(/\d+/)?.[0] ?? NaN)
  })).filter(t=>t.p1 && t.p2);
}

function parseSingle(csvText){
  const rows=parseCSV(csvText); if(rows.length<2) return [];
  const header=rows[0].map(h=>String(h).trim().toLowerCase());
  const ci = header.indexOf("pic")>=0 ? header.indexOf("pic") : (header.indexOf("img")>=0 ? header.indexOf("img") : 0);
  return rows.slice(1).map(r=>basenameMaybe(r[ci])).filter(v=>String(v).trim().length>0);
}

function fixation(ms){
  return { type: jsPsychHtmlKeyboardResponse, stimulus:`<div class="fixation">+</div>`, choices:"NO_KEYS", trial_duration: ms,
    data:{task:"metaemotion", event:"fixation"} };
}
function iti(ms){
  return { type: jsPsychHtmlKeyboardResponse, stimulus:"", choices:"NO_KEYS", trial_duration: ms, data:{task:"metaemotion", event:"iti"} };
}
function passiveImg(src, ms, extra){
  if(!src){
    return { type: jsPsychHtmlKeyboardResponse, stimulus:`<div class="center">(missing image)</div>`, choices:"NO_KEYS", trial_duration: ms, data:{task:"metaemotion", event:"image_missing", ...extra} };
  }
  return { type: jsPsychImageKeyboardResponse, stimulus: src, choices:"NO_KEYS", trial_duration: ms,
    data:{task:"metaemotion", event:"image", stimulus:src, ...extra} };
}
function instrImg(src, tag){
  return { type: jsPsychImageKeyboardResponse, stimulus: src, choices: META_KEYS.start, data:{task:"metaemotion", event:tag} };
}

// cache type1 response for confidence
const lastType1ByPic = {};

function twoIFC(pic1, pic2, cat, phase, chunk){
  const pic1_id = picIdFromFilename(pic1), pic2_id = picIdFromFilename(pic2);
  return {
    timeline: [
      passiveImg(pic1, META_TIMING.pic_ms, {phase, chunk}),
      fixation(META_TIMING.fix_ms),
      passiveImg(pic2, META_TIMING.pic_ms, {phase, chunk}),
      fixation(META_TIMING.fix_ms),
      {
        type: jsPsychHtmlKeyboardResponse,
        stimulus: `<div class="center" style="font-size:28px; line-height:1.35;">
          Which picture elicited stronger <b>positive emotion</b>?<br><br>
          Press <b>1</b> for the FIRST picture, <b>2</b> for the SECOND picture.
        </div>`,
        choices: META_KEYS.choice12,
        data: { task:"metaemotion", event:"2ifc", phase, chunk, pic1, pic2, pic1_id, pic2_id, cat },
        on_finish: (d)=>{
          d.choice_key = d.response;
          d.chosen_id = (d.response==="1") ? pic1_id : pic2_id;
          d.timestamp_s = getSecs();
          d.rt_s = d.rt/1000;
        }
      },
      iti(META_TIMING.iti_ms)
    ]
  };
}

function metaTrial(pic, chunk){
  const pic_id = picIdFromFilename(pic);
  return {
    timeline: [
      passiveImg(pic, META_TIMING.pic_ms, {phase:"meta", chunk}),
      fixation(META_TIMING.fix_ms),
      {
        type: jsPsychHtmlKeyboardResponse,
        stimulus: `<div class="center" style="font-size:28px; line-height:1.35;">
          Compared to the <b>median</b> of the whole picture set,<br>
          did this picture induce <b>higher</b> or <b>lower</b> positive emotion?<br><br>
          Press <b>1</b> = Higher, <b>2</b> = Lower
        </div>`,
        choices: META_KEYS.choice12,
        data: {task:"metaemotion", event:"meta_type1", chunk, pic, pic_id},
        on_finish:(d)=>{
          d.type1_key = d.response;
          d.type1_rt_s = d.rt/1000;
          d.type1_time_s = getSecs();
          lastType1ByPic[pic_id] = {type1_key:d.type1_key, type1_rt_s:d.type1_rt_s, type1_time_s:d.type1_time_s};
        }
      },
      {
        type: jsPsychHtmlKeyboardResponse,
        stimulus: `<div class="center" style="font-size:28px; line-height:1.35;">
          Confidence (1 = very unconfident … 4 = very confident)<br><br>
          Press <b>1</b> / <b>2</b> / <b>3</b> / <b>4</b>
        </div>`,
        choices: META_KEYS.conf1234,
        data: {task:"metaemotion", event:"meta_conf", chunk, pic, pic_id},
        on_finish:(d)=>{
          const prev = lastType1ByPic[pic_id];
          d.conf_key = d.response;
          d.conf_rt_s = d.rt/1000;
          d.conf_time_s = getSecs();
          if(prev){ d.type1_key=prev.type1_key; d.type1_rt_s=prev.type1_rt_s; d.type1_time_s=prev.type1_time_s; }
        }
      },
      iti(META_TIMING.iti_ms)
    ]
  };
}

export async function initMetaEmotion(params){
  const practiceCSV = await loadCSV(META_PATHS.lists + "practice_pairs.csv");
  const calibrationCSV = await loadCSV(META_PATHS.lists + "calibration_pairs.csv");
  const reviewCSV = await loadCSV(META_PATHS.lists + "review_list.csv");
  const metaCSV = await loadCSV(META_PATHS.lists + "meta_list.csv");

  const practicePairs = parsePracticePairs(practiceCSV);
  const calibrationPairs = parsePairsWithCat(calibrationCSV);
  const reviewList = parseSingle(reviewCSV);
  const metaList = parseSingle(metaCSV);
  const calibrationTargetCount = resolveTrialLimit(params.calibrationLimit, calibrationPairs.length);

  const state = {
    subject: params.subject,
    practicePairs,
    calibrationPairs,
    calibrationTargetCount,
    reviewList,
    metaList,
    caliCursor: 0
  };
  return state;
}

export function buildMetaEmotionPractice(state){
  const tl = [];
  tl.push(instrImg(META_PATHS.assets + "instruction.jpg", "practice_instructions"));
  for(const t of state.practicePairs){
    tl.push(twoIFC(META_PATHS.practice + t.p1, META_PATHS.practice + t.p2, t.cat, "practice", 0));
  }
  tl.push(instrImg(META_PATHS.assets + "endx_prac.jpg", "practice_end"));
  return tl;
}

export function buildMetaEmotionCalibrationChunk(state, nTrials, chunkIndex){
  const tl = [];
  const start = state.caliCursor;
  const target = state.calibrationTargetCount ?? state.calibrationPairs.length;
  const end = Math.min(target, start + nTrials);
  if (start >= end) return tl;

  tl.push(instrImg(META_PATHS.assets + "instruction.jpg", `cali_instructions_chunk_${chunkIndex}`));
  for(let i=start; i<end; i++){
    const t = state.calibrationPairs[i];
    tl.push(twoIFC(META_PATHS.formal + t.p1, META_PATHS.formal + t.p2, t.cat, "calibration", chunkIndex));
  }
  state.caliCursor = end;
  return tl;
}

export function buildMetaEmotionReview(state, nItems=20){
  const tl = [];
  tl.push({
    type: jsPsychHtmlKeyboardResponse,
    stimulus: `<div class="center" style="font-size:24px; line-height:1.35;">
      Next, you will re-view all pictures.<br><br>
      Press <b>SPACE</b> to begin.
    </div>`,
    choices: META_KEYS.start,
    data: {task:"metaemotion", event:"review_instructions"}
  });
  // Review uses review_list.csv directly; it does not depend on finishing calibration.
  state.reviewList.slice(0,nItems).forEach(fn=>{
    tl.push(passiveImg(META_PATHS.formal + fn, META_TIMING.review_ms, {phase:"review"}));
  });
  return tl;
}

export function buildMetaEmotionMetaJ(state, nTrials=60){
  const tl = [];
  tl.push(instrImg(META_PATHS.assets + "instruction2.jpg", "meta_instructions"));
  // Meta-judgment uses meta_list.csv directly; shortened calibration test runs are safe.
  state.metaList.slice(0,nTrials).forEach(fn=>{
    tl.push(metaTrial(META_PATHS.formal + fn, 0));
  });
  return tl;
}

export function exportMetaEmotion(state, jsPsych){
  const subj = state.subject;
  const rowsToCSV = rows => rows.map(r=>r.join(",")).join("\n") + "\n";

  const prac = jsPsych.data.get().filter({task:"metaemotion", event:"2ifc", phase:"practice"}).values()
    .map(d=>[subj, d.timestamp_s??"", d.pic1_id??"", d.pic2_id??"", d.cat??"", d.choice_key??"", d.chosen_id??"", d.rt_s??""]);

  const cali = jsPsych.data.get().filter({task:"metaemotion", event:"2ifc", phase:"calibration"}).values()
    .map(d=>[subj, d.timestamp_s??"", d.pic1_id??"", d.pic2_id??"", d.cat??"", d.choice_key??"", d.chosen_id??"", d.rt_s??""]);

  const meta = jsPsych.data.get().filter({task:"metaemotion", event:"meta_conf"}).values()
    .map(d=>[subj, d.type1_time_s??d.conf_time_s??"", d.pic_id??"", d.type1_key??"", d.type1_rt_s??"", d.conf_key??"", d.conf_rt_s??""]);

  return {
    pracCsvText: prac.length ? rowsToCSV(prac) : "",
    caliCsvText: cali.length ? rowsToCSV(cali) : "",
    metaJCsvText: meta.length ? rowsToCSV(meta) : "",
    stamp: matlabTimestamp(new Date())
  };
}
