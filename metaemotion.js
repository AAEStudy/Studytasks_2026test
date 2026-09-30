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
function instrImg(src, tag, prompt = ""){
  return { type: jsPsychImageKeyboardResponse, stimulus: src, prompt, choices: META_KEYS.start, data:{task:"metaemotion", event:tag} };
}

const META_RESPONSE_FORMAT_VERSION = "emotion-mouse-replay-v1";
const REPLAY_INSTRUCTIONS = `Across the picture tasks, you may use "View again" up to ${STUDY_RESPONSE_SETTINGS.imageReplayLimit} times if you missed a picture or need another look. For questions comparing two pictures, both pictures will be shown again in the same order. Use this option before submitting your answer.`;

function responseMetadata() {
  return {
    response_format_version: META_RESPONSE_FORMAT_VERSION,
    fast_threshold_ms: STUDY_RESPONSE_SETTINGS.fastThresholdMs,
    fast_streak_length: STUDY_RESPONSE_SETTINGS.fastStreakLength,
    speed_reminder_limit: STUDY_RESPONSE_SETTINGS.maxSpeedReminders,
    replay_limit: STUDY_RESPONSE_SETTINGS.imageReplayLimit
  };
}

function button(value, label) {
  return `<button type="button" class="study-response-button" data-study-response="${value}" tabindex="-1">${label}</button>`;
}

// Repeat only the viewing + first judgment sequence. Requests never create
// extra scored responses, and confidence cannot request a replay.
function withReplay(state, jsPsych, pictures, responseTrial, phase, chunk) {
  const trialId = ++state.nextImageTrialId;
  let firstOnset = null;
  let screenOnset = null;
  let replayRequested = false;
  let cleanup = () => {};
  let finished = false;
  const requests = [];
  const viewing = pictures.flatMap(pic => [
    passiveImg(pic, META_TIMING.pic_ms, { phase, chunk, image_trial_id: trialId }),
    fixation(META_TIMING.fix_ms)
  ]);
  const trial = {
    ...responseTrial,
    data: { ...responseTrial.data, image_trial_id: trialId, ...responseMetadata() },
    on_start: current => {
      current.stimulus = responseTrial.stimulus + `<div><button type="button" class="study-response-button replay-button" data-study-response="replay" tabindex="-1" ${state.replaysRemaining ? '' : 'disabled'}>View again (${state.replaysRemaining} remaining)</button></div>`;
    },
    on_load: () => {
      screenOnset = performance.now();
      if (firstOnset === null) firstOnset = screenOnset;
      finished = false;
      cleanup = StudyResponses.freshClicks(jsPsych.getDisplayElement(), response => {
        if (finished || (response === 'replay' && state.replaysRemaining <= 0)) return;
        finished = true;
        cleanup();
        StudyResponses.finishMouseTrial(jsPsych, { response, rt: performance.now() - screenOnset });
      });
    },
    on_finish: data => {
      cleanup();
      replayRequested = data.response === 'replay';
      if (replayRequested) {
        state.replaysRemaining--;
        const request = {
          request_index: requests.length + 1, image_trial_id: trialId,
          elapsed_ms: performance.now() - firstOnset, screen_rt_ms: data.rt,
          remaining: state.replaysRemaining, pictures: [...pictures]
        };
        requests.push(request);
        data.event = 'replay_request';
        data.response = null;
        Object.assign(data, request);
      } else {
        Object.assign(data, {
          replay_count: requests.length, replay_requests: requests.slice(),
          replays_remaining: state.replaysRemaining,
          total_response_rt_s: (performance.now() - firstOnset) / 1000,
          final_response_rt_s: data.rt / 1000,
          speed_reminder_shown: false, speed_reminder_kinds: ''
        });
        responseTrial.on_finish(data);
      }
    }
  };
  return { timeline: [...viewing, trial], loop_function: () => replayRequested };
}

function twoIFC(state, jsPsych, pic1, pic2, cat, phase, chunk) {
  const pic1_id = picIdFromFilename(pic1), pic2_id = picIdFromFilename(pic2);
  let result;
  const responseTrial = {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: `<div class="center" style="font-size:28px; line-height:1.35;">
      Which picture elicited stronger <b>positive emotion</b>?<br><br>
      Press <b>1</b> for the FIRST picture, <b>2</b> for the SECOND picture.
    </div>`,
    choices: META_KEYS.choice12,
    data: { task:"metaemotion", event:"2ifc", phase, chunk, pic1, pic2, pic1_id, pic2_id, cat },
    on_finish: data => {
      data.choice_key = data.response;
      data.chosen_id = data.response === "1" ? pic1_id : pic2_id;
      data.timestamp_s = getSecs();
      data.rt_s = data.rt / 1000;
      Object.assign(data, StudyResponses.recordSpeed(`emotion_${phase}_comparison`, data.rt));
      result = data;
    }
  };
  return { timeline: [
    withReplay(state, jsPsych, [pic1, pic2], responseTrial, phase, chunk),
    StudyResponses.reminderTrial(jsPsych, kinds => {
      result.speed_reminder_shown = true;
      result.speed_reminder_kinds = kinds.join('|');
    }),
    iti(META_TIMING.iti_ms)
  ] };
}

function metaTrial(state, jsPsych, pic, chunk) {
  const pic_id = picIdFromFilename(pic);
  let judgment;
  let confidence;
  const responseTrial = {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: `<section class="emotion-response-screen">
      <p>Compared to the <b>median</b> of the whole picture set,<br>
      did this picture induce <b>higher</b> or <b>lower</b> positive emotion?</p>
      <div class="emotion-response-options">${button('1', 'Higher')}${button('2', 'Lower')}</div>
      <p>Click your answer.</p>
    </section>`,
    choices: "NO_KEYS",
    data: {task:"metaemotion", event:"meta_type1", chunk, pic, pic_id},
    on_finish: data => {
      data.type1_key = data.response;
      data.type1_rt_s = data.rt / 1000;
      data.type1_time_s = getSecs();
      Object.assign(data, StudyResponses.recordSpeed('emotion_judgment', data.rt));
      judgment = data;
    }
  };
  const confidenceTrial = StudyResponses.mouseTrial(jsPsych, {
    stimulus: `<section class="emotion-response-screen">
      <h2>Confidence</h2>
      <p>1 = very unconfident … 4 = very confident</p>
      <div class="emotion-response-options four">${[1,2,3,4].map(value => button(value, value)).join('')}</div>
      <p>Click your answer.</p>
    </section>`,
    data: {task:"metaemotion", event:"meta_conf", chunk, pic, pic_id, ...responseMetadata()},
    on_finish: data => {
      data.conf_key = data.response;
      data.conf_rt_s = data.rt / 1000;
      data.conf_time_s = getSecs();
      data.type1_key = judgment.type1_key;
      data.type1_rt_s = judgment.type1_rt_s;
      data.type1_time_s = judgment.type1_time_s;
      for (const key of ['image_trial_id', 'replay_count', 'replay_requests', 'replays_remaining', 'total_response_rt_s', 'final_response_rt_s']) data[key] = judgment[key];
      data.type1_fast = judgment.fast_response;
      data.type1_fast_streak = judgment.fast_streak;
      Object.assign(data, StudyResponses.recordSpeed('emotion_confidence', data.rt));
      data.speed_reminder_shown = false;
      data.speed_reminder_kinds = '';
      confidence = data;
    }
  });
  return { timeline: [
    withReplay(state, jsPsych, [pic], responseTrial, "meta", chunk),
    confidenceTrial,
    StudyResponses.reminderTrial(jsPsych, kinds => {
      confidence.speed_reminder_shown = true;
      confidence.speed_reminder_kinds = kinds.join('|');
    }),
    iti(META_TIMING.iti_ms)
  ] };
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
    jsPsych: params.jsPsych,
    nextImageTrialId: 0,
    replaysRemaining: STUDY_RESPONSE_SETTINGS.imageReplayLimit,
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
  tl.push(instrImg(META_PATHS.assets + "instruction.jpg", "practice_instructions", `<p class="center">${REPLAY_INSTRUCTIONS}</p>`));
  for(const t of state.practicePairs){
    tl.push(twoIFC(state, state.jsPsych, META_PATHS.practice + t.p1, META_PATHS.practice + t.p2, t.cat, "practice", 0));
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

  tl.push(instrImg(META_PATHS.assets + "instruction.jpg", `cali_instructions_chunk_${chunkIndex}`, `<p class="center">${REPLAY_INSTRUCTIONS}</p>`));
  for(let i=start; i<end; i++){
    const t = state.calibrationPairs[i];
    tl.push(twoIFC(state, state.jsPsych, META_PATHS.formal + t.p1, META_PATHS.formal + t.p2, t.cat, "calibration", chunkIndex));
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
  tl.push({
    type: jsPsychHtmlKeyboardResponse,
    stimulus: `<div class="emotion-response-screen" style="text-align:left;">
      <p>Judge how positive the emotions of the pictures you see are.</p>
      <p>If it's higher than the middle of all the images you saw earlier, click Higher; if it is below the middle, click Lower.</p>
      <p>Then, how confident you are in the decision?</p>
      <p>A score of 1 is very unconfident and a score of 4 is very confident. Please try to use all the ratings. Click the number for your answer.</p>
      <p>There is no right answer to the choice of images, so answer intuitively.</p>
      <p>Please choose "images that give you more positive emotional feelings" instead of judging the positive and negative nature of the picture itself.</p>
      <p>${REPLAY_INSTRUCTIONS}</p>
      <p>Each answer requires a new mouse click. Press SPACE to begin.</p>
    </div>`,
    choices: META_KEYS.start,
    data: {task:"metaemotion", event:"meta_instructions"}
  });
  // Meta-judgment uses meta_list.csv directly; shortened calibration test runs are safe.
  state.metaList.slice(0,nTrials).forEach(fn=>{
    tl.push(metaTrial(state, state.jsPsych, META_PATHS.formal + fn, 0));
  });
  return tl;
}

export function exportMetaEmotion(state, jsPsych){
  const subj = state.subject;
  const csvCell = value => {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  };
  const rowsToCSV = rows => rows.map(r=>r.map(csvCell).join(",")).join("\n") + "\n";
  // Append provenance without changing the original response/RT column positions.
  const details = d => [
    d.response_format_version??"", d.image_trial_id??"", d.replay_count??"", d.replays_remaining??"",
    d.total_response_rt_s??"", d.final_response_rt_s??"", d.replay_requests ? JSON.stringify(d.replay_requests) : "",
    d.fast_response??"", d.fast_streak??"", d.type1_fast??"", d.type1_fast_streak??"",
    d.speed_reminder_shown??"", d.speed_reminder_kinds??"",
    d.fast_threshold_ms??"", d.fast_streak_length??"", d.speed_reminder_limit??"", d.replay_limit??""
  ];

  const prac = jsPsych.data.get().filter({task:"metaemotion", event:"2ifc", phase:"practice"}).values()
    .map(d=>[subj, d.timestamp_s??"", d.pic1_id??"", d.pic2_id??"", d.cat??"", d.choice_key??"", d.chosen_id??"", d.rt_s??"", ...details(d)]);

  const cali = jsPsych.data.get().filter({task:"metaemotion", event:"2ifc", phase:"calibration"}).values()
    .map(d=>[subj, d.timestamp_s??"", d.pic1_id??"", d.pic2_id??"", d.cat??"", d.choice_key??"", d.chosen_id??"", d.rt_s??"", ...details(d)]);

  const meta = jsPsych.data.get().filter({task:"metaemotion", event:"meta_conf"}).values()
    .map(d=>[subj, d.type1_time_s??d.conf_time_s??"", d.pic_id??"", d.type1_key??"", d.type1_rt_s??"", d.conf_key??"", d.conf_rt_s??"", ...details(d)]);

  return {
    pracCsvText: prac.length ? rowsToCSV(prac) : "",
    caliCsvText: cali.length ? rowsToCSV(cali) : "",
    metaJCsvText: meta.length ? rowsToCSV(meta) : "",
    stamp: matlabTimestamp(new Date())
  };
}
