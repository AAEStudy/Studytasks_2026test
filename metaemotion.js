// metaemotion.js
// Provides:
//  - initMetaEmotion(params): loads CSV lists (via fetch), returns promise resolving to state object
//  - buildMetaEmotionCalibrationChunk(state, nTrials, chunkIndex): returns timeline array and advances cursor
//  - buildMetaEmotionReview(state, nItems): timeline array
//  - buildMetaEmotionMetaJ(state, nTrials): timeline array
//  - exportMetaEmotion(state, jsPsych): returns {caliCsvText, metaJCsvText, pracCsvText}
//
// NOTE: This uses the Matlab-style CSV formats (no header) expected by the original study.

import { IMAGE_SCHEDULE_VERSION, SCHEDULE_FIELDS, sessionSeed, createCalibrationSchedule, createReviewSchedule, createMetaSchedule, assertSameImages } from "./js/image-schedule.mjs";

const META_PATHS = {
  practice: "stimuli/practice/",
  formal: "stimuli/formal/",
  lists: "lists/"
};

// Extra viewing time applies to pairwise comparisons and their practice/replays.
// Keep the final single-image judgments and passive set review at their existing timing.
const META_TIMING = { comparison_pic_ms: 750, pic_ms: 500, fix_ms: 500, iti_ms: 500, review_ms: 500 };

const META_KEYS = { start: [" "], choice12: ["1","2"], conf1234: ["1","2","3","4"] };
const META_CONFIDENCE_LABELS = ["Very unconfident", "Unconfident", "Confident", "Very confident"];

function confidenceLabel(key) {
  const index = Number(key) - 1;
  return Number.isInteger(index) ? META_CONFIDENCE_LABELS[index] ?? "" : "";
}

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

export function parseCSV(text){
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
function instructionScreen(title, body, tag, action = "begin") {
  return {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: `<section class="emotion-instructions">
      <h2>${title}</h2>
      ${body}
      <p class="emotion-instructions-continue">Press <b>SPACE</b> to ${action}.</p>
    </section>`,
    choices: META_KEYS.start,
    data: { task: "metaemotion", event: tag }
  };
}

const META_RESPONSE_FORMAT_VERSION = "emotion-mouse-replay-v18-middle-level";
const FINAL_IMAGE_REPLAY_LIMIT = STUDY_RESPONSE_SETTINGS.finalImageReplayLimit ?? 3;
const PRACTICE_IMAGE_REPLAY_LIMIT = STUDY_RESPONSE_SETTINGS.practiceImageReplayLimit ?? 5;
const META_CONFIDENCE_GATES = Object.freeze({ minMs: 600, minMovePx: 100 });
const META_CHECK_GATES = Object.freeze({ minMs: 0, minMovePx: 0, trackMovement: true });
const FINAL_JUDGMENT_REMINDER_OPTIONS = Object.freeze({ reminderGroup: "final_judgment" });
const COMPARISON_OPTIONS_HTML = `<p class="emotion-comparison-options">Press <b>1</b> for the FIRST picture, <b>2</b> for the SECOND picture.</p>`;
const EMOTION_GUIDANCE = `<p>Focus on <b>your own emotional feeling</b>, not on whether the picture itself seems positive or negative. There is no correct answer; respond intuitively.</p>`;

function timedInstructionPages(pageDefinitions, minimumViewMs, tag, jsPsych, {
  pageClass = "", lastButtonLabel = "BEGIN PRACTICE >", lastReadyMessage = "You may now begin practice."
} = {}) {
  const pages = pageDefinitions.map(({ title, body }, index) => `<section class="emotion-instructions${pageClass ? ` ${pageClass}` : ''}" data-emotion-instruction-page="${index}">
    <h2>${title}</h2>
    ${body}
    <p class="emotion-instructions-lock-status" data-emotion-instruction-lock-status role="status" aria-live="polite"></p>
  </section>`);
  let cleanupInstructionLock = null;
  return {
    type: jsPsychInstructions,
    pages,
    show_clickable_nav: true,
    show_page_number: true,
    allow_keys: false,
    allow_backward: true,
    button_label_previous: "PREVIOUS",
    button_label_next: "NEXT",
    data: { task: "metaemotion", event: tag, instruction_min_view_ms: minimumViewMs },
    on_load: () => {
      if (cleanupInstructionLock) cleanupInstructionLock();
      const display = jsPsych.getDisplayElement();
      const viewedMs = pages.map(() => 0);
      let activePage = null;
      let activeSince = 0;
      let unlockTimeout = null;
      let countdownInterval = null;
      let finished = false;
      const clearTimers = () => {
        if (unlockTimeout !== null) window.clearTimeout(unlockTimeout);
        if (countdownInterval !== null) window.clearInterval(countdownInterval);
        unlockTimeout = null;
        countdownInterval = null;
      };
      const remainingMs = () => activePage === null ? 0 : Math.max(0,
        minimumViewMs[activePage] - viewedMs[activePage] - (performance.now() - activeSince));
      const refresh = () => {
        if (finished || activePage === null) return;
        const remaining = remainingMs();
        const next = display.querySelector("#jspsych-instructions-next");
        if (next) {
          next.disabled = remaining > 0;
          const label = activePage === pages.length - 1 ? lastButtonLabel : "NEXT >";
          if (next.textContent !== label) next.textContent = label;
        }
        const status = display.querySelector("[data-emotion-instruction-lock-status]");
        const seconds = Math.ceil(remaining / 1000);
        const text = remaining > 0
          ? `Please read this page. You may continue in ${seconds} second${seconds === 1 ? "" : "s"}.`
          : (activePage === pages.length - 1 ? lastReadyMessage : "You may now continue.");
        if (status && status.textContent !== text) status.textContent = text;
        if (remaining === 0) clearTimers();
      };
      const synchronizePage = () => {
        if (finished) return;
        const section = display.querySelector("[data-emotion-instruction-page]");
        if (!section) return;
        const index = Number(section.dataset.emotionInstructionPage);
        if (!Number.isInteger(index) || index < 0 || index >= pages.length) return;
        if (index !== activePage) {
          const now = performance.now();
          if (activePage !== null) viewedMs[activePage] += now - activeSince;
          activePage = index;
          activeSince = now;
          clearTimers();
          const remaining = remainingMs();
          if (remaining > 0) {
            countdownInterval = window.setInterval(refresh, 250);
            unlockTimeout = window.setTimeout(refresh, Math.ceil(remaining));
          }
        }
        refresh();
      };
      // Check the current DOM synchronously before the plugin handles a click.
      // This also catches a rapid second NEXT click before its observer callback.
      const guardForwardClick = event => {
        const next = event.target.closest?.("#jspsych-instructions-next");
        if (!next || !display.contains(next)) return;
        synchronizePage();
        if (activePage === null || remainingMs() > 0) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      };
      display.addEventListener("click", guardForwardClick, true);
      const observer = new MutationObserver(synchronizePage);
      observer.observe(display, { childList: true, subtree: true });
      synchronizePage();
      cleanupInstructionLock = () => {
        finished = true;
        clearTimers();
        observer.disconnect();
        display.removeEventListener("click", guardForwardClick, true);
        cleanupInstructionLock = null;
      };
    },
    on_finish: () => {
      if (cleanupInstructionLock) cleanupInstructionLock();
    }
  };
}

function comparisonInstructions(tag, practice = false, jsPsych) {
  return timedInstructionPages([
    {
      title: practice ? "Picture comparisons: practice" : "Picture comparisons",
      body: `<p>You will see two images, one after the other. After both images have appeared, choose which image made you feel <b>more positive</b>.</p>
        <p>Press <b>1</b> for the <b>first</b> image or <b>2</b> for the <b>second</b> image.</p>
        ${EMOTION_GUIDANCE}
        ${practice ? '<p>During the main trials, sets of image comparisons will alternate with the Metronome Task.</p>' : ''}
        <p>Occasionally, an additional response instruction will follow your comparison. Follow the instruction shown.</p>`
    },
    {
      title: "Viewing pictures again",
      body: `<p>If you need to view the images again, click the <b>View again</b> button in the bottom-right corner before submitting your comparison. Both images are shown again in the same order; this counts as one use.</p>
        <p>Only use the <b>View again</b> option when you absolutely need to: you did not see an image or cannot remember what one of the images was, so you cannot accurately make the comparison without seeing the images again.</p>
        <p>You may use it up to <b>${STUDY_RESPONSE_SETTINGS.imageReplayLimit} times during the main image comparison trials</b>. Practice uses <b>do not count</b>.</p>`
    }
  ], [20000, 10000], tag, jsPsych);
}

function finalJudgmentInstructions(jsPsych) {
  return timedInstructionPages([
    {
      title: "<u>Picture judgments: a new variation</u>",
      body: `<p>You are near the end of the tasks. There is one more very important part, which should take about <b>5–7 minutes</b>. Please do your best to <b>give your full attention and effort</b> to this final part.</p>
        <p>In this part, you will see <b><u>one picture at a time</u></b>.</p>
        <p>Judge whether the positive feeling this picture brings you is <b><u>higher</u></b> or <b><u>lower</u></b> than the <b><u>middle (median)</u></b> of the positive feelings you get from <b>each picture in the whole set</b>.</p>
        <p>Click <b>Higher</b> or <b>Lower</b> to answer.</p>
        ${EMOTION_GUIDANCE}`
    },
    {
      title: "<u>Confidence in your judgment</u>",
      body: `<p>After each judgment, you will be asked: <b>How confident are you in the decision you just made?</b></p>
        <p>Click one answer: <b>1 = Very unconfident</b>, <b>2 = Unconfident</b>, <b>3 = Confident</b>, or <b>4 = Very confident</b>.</p>
        <p>Remember to use the <b>full range of answer options</b> to indicate your level of confidence. <b>Move the mouse a noticeable distance, then click your answer.</b> Each confidence response requires a new mouse movement, and the choices become available after a brief pause.</p>
        <p>Occasionally, a <b>third question</b> will ask you to select a particular response. Follow the instruction shown.</p>`
    },
    {
      title: "<u>Viewing pictures again</u>",
      body: `<p>If you need to view the current picture again, click the <b>View again</b> button in the bottom-right corner <b>before submitting your judgment</b>. Only use the <b>View again</b> option when you missed or cannot remember the picture and cannot accurately judge without seeing it again.</p>
        <p>You may use it up to <b><u>${FINAL_IMAGE_REPLAY_LIMIT} times in this part</u></b>. These uses are <b>separate from the ${STUDY_RESPONSE_SETTINGS.imageReplayLimit} uses allowed during the main image comparisons</b>. <b>Practice uses do not count toward either limit.</b> The button shows your remaining uses. Viewing again is <b>unavailable during confidence</b>.</p>`
    },
    {
      title: "<u>Reviewing the whole picture set</u>",
      body: `<p><b>First, you will review the whole picture set again</b>. When you advance to the next screen, all of the images shown earlier will be displayed in one <b>fast moving</b> sequence. <b>No response is needed during that time.</b> During the review, keep in mind the emotional feelings the whole set brings you as the images are displayed (rather than just one or two images). After the review, you will begin the final one by one picture judgments.</p>`
    }
  ], [20000, 20000, 15000, 15000], "meta_instructions", jsPsych, {
    pageClass: "emotion-final-instructions",
    lastButtonLabel: "BEGIN PICTURE REVIEW >",
    lastReadyMessage: "You may now begin the picture review."
  });
}

function responseMetadata(phase = "calibration") {
  return {
    response_format_version: META_RESPONSE_FORMAT_VERSION,
    fast_threshold_ms: STUDY_RESPONSE_SETTINGS.fastThresholdMs,
    fast_streak_length: STUDY_RESPONSE_SETTINGS.fastStreakLength,
    speed_reminder_limit: STUDY_RESPONSE_SETTINGS.maxSpeedReminders,
    replay_limit: phase === "meta" ? FINAL_IMAGE_REPLAY_LIMIT
      : phase === "practice" ? PRACTICE_IMAGE_REPLAY_LIMIT : STUDY_RESPONSE_SETTINGS.imageReplayLimit,
    final_replay_limit: FINAL_IMAGE_REPLAY_LIMIT
  };
}

function phaseCheckpoints(total, count) {
  if (total <= 0 || count <= 0) return [];
  return [...new Set(Array.from({ length: count }, (_, index) => Math.ceil(total * (index + 1) / count)))].filter(position => position > 0);
}

function button(value, label) {
  return `<button type="button" class="study-response-button" data-study-response="${value}" tabindex="-1">${label}</button>`;
}

// Repeat only the viewing + first judgment sequence. Requests never create
// extra scored responses, and confidence cannot request a replay.
function withReplay(state, jsPsych, pictures, responseTrial, phase, chunk) {
  const trialId = ++state.nextImageTrialId;
  const isPractice = phase === "practice";
  if (state.practiceReplaysRemaining === undefined) state.practiceReplaysRemaining = PRACTICE_IMAGE_REPLAY_LIMIT;
  if (state.replaysRemaining === undefined) state.replaysRemaining = STUDY_RESPONSE_SETTINGS.imageReplayLimit;
  if (state.finalReplaysRemaining === undefined) state.finalReplaysRemaining = FINAL_IMAGE_REPLAY_LIMIT;
  const budget = isPractice ? "practice" : phase === "meta" ? "final" : "comparison";
  const poolKey = isPractice ? "practiceReplaysRemaining" : phase === "meta" ? "finalReplaysRemaining" : "replaysRemaining";
  const budgetRemaining = () => state[poolKey];
  const replaysAvailable = budgetRemaining;
  let firstOnset = null;
  let screenOnset = null;
  let replayRequested = false;
  let cleanup = () => {};
  let finished = false;
  const requests = [];
  const pictureDuration = phase === "practice" || phase === "calibration"
    ? META_TIMING.comparison_pic_ms
    : META_TIMING.pic_ms;
  const viewing = pictures.flatMap(pic => [
    passiveImg(pic, pictureDuration, { phase, chunk, image_trial_id: trialId }),
    fixation(META_TIMING.fix_ms)
  ]);
  const trial = {
    ...responseTrial,
    css_classes: ["emotion-replay-trial", ...(responseTrial.css_classes || [])],
    data: { ...responseTrial.data, image_trial_id: trialId, ...responseMetadata(phase) },
    on_start: current => {
      const remaining = replaysAvailable();
      current.stimulus = responseTrial.stimulus + `<div><button type="button" class="study-response-button replay-button" data-study-response="replay" tabindex="-1" ${remaining > 0 ? '' : 'disabled'}>View again (${remaining} remaining)</button></div>`;
    },
    on_load: () => {
      screenOnset = performance.now();
      if (firstOnset === null) firstOnset = screenOnset;
      finished = false;
      cleanup = StudyResponses.freshClicks(jsPsych.getDisplayElement(), response => {
        if (finished || (response === 'replay' && replaysAvailable() <= 0)) return;
        finished = true;
        cleanup();
        StudyResponses.finishMouseTrial(jsPsych, { response, rt: performance.now() - screenOnset });
      });
    },
    on_finish: data => {
      cleanup();
      replayRequested = data.response === 'replay';
      if (replayRequested) {
        state[poolKey]--;
        const request = {
          request_index: requests.length + 1, image_trial_id: trialId,
          elapsed_ms: performance.now() - firstOnset, screen_rt_ms: data.rt,
          remaining: budgetRemaining(), replays_remaining: budgetRemaining(), budget, pictures: [...pictures],
          final_replay_limit: FINAL_IMAGE_REPLAY_LIMIT,
          final_replays_remaining: state.finalReplaysRemaining
        };
        requests.push(request);
        data.event = 'replay_request';
        data.response = null;
        Object.assign(data, request);
      } else {
        Object.assign(data, {
          replay_count: requests.length, replay_requests: requests.slice(),
          replays_remaining: budgetRemaining(),
          final_replays_remaining: state.finalReplaysRemaining,
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

function twoIFC(state, jsPsych, pic1, pic2, cat, phase, chunk, schedule = {}, check = null) {
  const pic1_id = picIdFromFilename(pic1), pic2_id = picIdFromFilename(pic2);
  let result;
  const responseTrial = {
    type: jsPsychHtmlKeyboardResponse,
    css_classes: ["emotion-comparison-trial"],
    stimulus: `<section class="emotion-response-screen emotion-comparison-screen">
      <p class="emotion-comparison-question">Does the first or the second image bring you a more positive emotional feeling?</p>
      ${COMPARISON_OPTIONS_HTML}
    </section>`,
    choices: META_KEYS.choice12,
    data: { task:"metaemotion", event:"2ifc", phase, chunk, pic1, pic2, pic1_id, pic2_id, cat, ...state.scheduleMetadata, schedule_stage: phase, ...schedule },
    on_finish: data => {
      data.choice_key = data.response;
      data.chosen_id = data.response === "1" ? pic1_id : pic2_id;
      data.timestamp_s = getSecs();
      data.rt_s = data.rt / 1000;
      Object.assign(data, StudyResponses.recordSpeed(`emotion_${phase}_comparison`, data.rt));
      result = data;
    }
  };
  const checkTrials = [];
  if (check) {
    const expected = String((check.id - 1) % 2 + 1);
    checkTrials.push({
      type: jsPsychHtmlKeyboardResponse,
      css_classes: ["emotion-replay-trial", "emotion-comparison-trial"],
      stimulus: `<section class="emotion-response-screen emotion-comparison-screen">
        <p class="emotion-comparison-question">To ensure quality responses are being given, please select option <b>${expected}</b>.</p>
        ${COMPARISON_OPTIONS_HTML}
      </section>`,
      choices: META_KEYS.choice12,
      data: {
        task: "metaemotion", event: "calibration_instructed_response", phase: "calibration",
        chunk, check_id: check.id, after_calibration_trial: check.afterTrial,
        expected_response: expected, ...responseMetadata(phase)
      },
      on_finish: data => {
        data.instructed_response_correct = String(data.response ?? "") === expected;
        Object.assign(result, {
          cal_check_id: check.id,
          cal_check_after_trial: check.afterTrial,
          cal_check_expected: expected,
          cal_check_response: data.response,
          cal_check_correct: data.instructed_response_correct,
          cal_check_rt_ms: data.rt
        });
      }
    });
  }
  return { timeline: [
    withReplay(state, jsPsych, [pic1, pic2], responseTrial, phase, chunk),
    ...checkTrials,
    StudyResponses.reminderTrial(jsPsych, kinds => {
      result.speed_reminder_shown = true;
      result.speed_reminder_kinds = kinds.join('|');
    }),
    iti(META_TIMING.iti_ms)
  ] };
}

function metaTrial(state, jsPsych, pic, chunk, schedule, check = null) {
  const pic_id = picIdFromFilename(pic);
  let judgment;
  let confidence;
  const responseTrial = {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: `<section class="emotion-response-screen">
      <p>Compared with the <b>middle level</b> for the whole picture set, does this picture bring you a <b>higher</b> or <b>lower</b> level of positive emotion?</p>
      <div class="emotion-response-options">${button('1', 'Higher')}${button('2', 'Lower')}</div>
      <p>Click your answer.</p>
    </section>`,
    choices: "NO_KEYS",
    data: {task:"metaemotion", event:"meta_type1", chunk, pic, pic_id, ...state.scheduleMetadata, ...schedule, speed_reminder_group: FINAL_JUDGMENT_REMINDER_OPTIONS.reminderGroup},
    on_finish: data => {
      data.type1_key = data.response;
      data.type1_rt_s = data.rt / 1000;
      data.type1_time_s = getSecs();
      Object.assign(data, StudyResponses.recordSpeed('emotion_judgment', data.rt, FINAL_JUDGMENT_REMINDER_OPTIONS));
      judgment = data;
    }
  };
  const confidenceTrial = StudyResponses.mouseTrial(jsPsych, {
    stimulus: `<section class="emotion-response-screen emotion-confidence-screen">
      <p>How confident are you in the decision you just made?</p>
      <div class="emotion-response-options four">${META_CONFIDENCE_LABELS.map((label, i) => button(i + 1, `<span class="confidence-option-number">${i + 1}</span><span class="confidence-option-label">${label}</span>`)).join('')}</div>
      <p>Move the mouse a noticeable distance, then click your answer.</p>
    </section>`,
    data: {task:"metaemotion", event:"meta_conf", chunk, pic, pic_id, ...responseMetadata("meta"), speed_reminder_group: FINAL_JUDGMENT_REMINDER_OPTIONS.reminderGroup, certainty_min_ms: META_CONFIDENCE_GATES.minMs, certainty_min_move_px: META_CONFIDENCE_GATES.minMovePx},
    on_finish: data => {
      data.conf_key = data.response;
      data.confidence_label = confidenceLabel(data.response);
      data.conf_rt_s = data.rt / 1000;
      data.conf_time_s = getSecs();
      data.type1_key = judgment.type1_key;
      data.type1_rt_s = judgment.type1_rt_s;
      data.type1_time_s = judgment.type1_time_s;
      for (const key of SCHEDULE_FIELDS) if (judgment[key] !== undefined) data[key] = judgment[key];
      for (const key of ['image_trial_id', 'replay_count', 'replay_requests', 'replays_remaining', 'final_replay_limit', 'final_replays_remaining', 'total_response_rt_s', 'final_response_rt_s']) data[key] = judgment[key];
      data.type1_fast = judgment.fast_response;
      data.type1_fast_streak = judgment.fast_streak;
      Object.assign(data, StudyResponses.recordSpeed('emotion_confidence', data.rt, FINAL_JUDGMENT_REMINDER_OPTIONS));
      data.speed_reminder_shown = false;
      data.speed_reminder_kinds = '';
      confidence = data;
    }
  }, META_CONFIDENCE_GATES);
  const checkTrials = [];
  if (check) {
    const expected = String((check.id - 1) % META_CONFIDENCE_LABELS.length + 1);
    checkTrials.push(StudyResponses.mouseTrial(jsPsych, {
      stimulus: `<section class="emotion-response-screen emotion-confidence-screen emotion-instructed-response-screen">
        <p>To ensure quality responses are being given, please select option ${expected}.</p>
        <div class="emotion-response-options four">${META_CONFIDENCE_LABELS.map((label, i) => button(i + 1, `<span class="confidence-option-number">${i + 1}</span><span class="confidence-option-label">${label}</span>`)).join('')}</div>
        <p>Click your answer.</p>
      </section>`,
      data: {
        task: "metaemotion", event: "meta_instructed_response", check_id: check.id,
        after_meta_trial: check.afterTrial, presentation: "confidence_options", expected_response: expected,
        ...responseMetadata("meta"), certainty_min_ms: META_CHECK_GATES.minMs,
        certainty_min_move_px: META_CHECK_GATES.minMovePx
      },
      on_finish: data => {
        data.instructed_response_correct = String(data.response ?? "") === expected;
        Object.assign(confidence, {
          final_check_id: check.id,
          final_check_after_trial: check.afterTrial,
          final_check_presentation: "confidence_options",
          final_check_expected: expected,
          final_check_response: data.response,
          final_check_correct: data.instructed_response_correct,
          final_check_rt_ms: data.rt,
          final_check_min_ms: data.certainty_min_ms,
          final_check_min_move_px: data.certainty_min_move_px,
          final_check_max_move_px: data.certainty_max_move_px
        });
      }
    }, META_CHECK_GATES));
  }
  return { timeline: [
    withReplay(state, jsPsych, [pic], responseTrial, "meta", chunk),
    confidenceTrial,
    ...checkTrials,
    StudyResponses.reminderTrial(jsPsych, kinds => {
      confidence.speed_reminder_shown = true;
      confidence.speed_reminder_kinds = kinds.join('|');
    }, FINAL_JUDGMENT_REMINDER_OPTIONS),
    iti(META_TIMING.iti_ms)
  ] };
}

export async function initMetaEmotion(params){
  const practiceCSV = await loadCSV(META_PATHS.lists + "practice_pairs.csv");
  const calibrationCSV = await loadCSV(META_PATHS.lists + "calibration_pairs.csv");
  const reviewCSV = await loadCSV(META_PATHS.lists + "review_list.csv");
  const metaCSV = await loadCSV(META_PATHS.lists + "meta_list.csv");

  const practicePairs = parsePracticePairs(practiceCSV);
  const sourceCalibrationPairs = parsePairsWithCat(calibrationCSV);
  const sourceReviewList = parseSingle(reviewCSV);
  const sourceMetaList = parseSingle(metaCSV);
  assertSameImages(sourceCalibrationPairs, sourceReviewList, sourceMetaList);
  const seed = sessionSeed(params.imageScheduleSeed);
  const shuffleFollowups = params.shuffleFollowupStages ?? true;
  const calibrationPairs = createCalibrationSchedule(sourceCalibrationPairs, seed);
  const calibrationTargetCount = resolveTrialLimit(params.calibrationLimit, calibrationPairs.length);
  const reviewSchedule = shuffleFollowups
    ? createReviewSchedule(sourceReviewList, seed)
    : sourceReviewList.map((pic, i) => ({ pic, schedule: { schedule_stage: "review", schedule_position: i + 1, schedule_source_row: i + 1 } }));
  const metaSchedule = shuffleFollowups
    ? createMetaSchedule(sourceMetaList, seed, reviewSchedule.at(-1)?.pic)
    : sourceMetaList.map((pic, i) => ({ pic, schedule: { schedule_stage: "meta", schedule_position: i + 1, schedule_source_row: i + 1 } }));
  for (const [rows, source] of [[calibrationPairs, calibrationCSV], [reviewSchedule, reviewCSV], [metaSchedule, metaCSV]]) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
    const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
    rows.forEach(row => { row.schedule.schedule_source_sha256 = hash; });
  }

  const state = {
    subject: params.subject,
    jsPsych: params.jsPsych,
    nextImageTrialId: 0,
    practiceReplaysRemaining: PRACTICE_IMAGE_REPLAY_LIMIT,
    replaysRemaining: STUDY_RESPONSE_SETTINGS.imageReplayLimit,
    finalReplaysRemaining: FINAL_IMAGE_REPLAY_LIMIT,
    practicePairs,
    sourceCalibrationPairs,
    sourceReviewList,
    sourceMetaList,
    scheduleMetadata: { schedule_version: IMAGE_SCHEDULE_VERSION, schedule_seed: seed, schedule_followup_shuffle: shuffleFollowups },
    calibrationPairs,
    calibrationTargetCount,
    reviewSchedule,
    metaSchedule,
    reviewList: reviewSchedule.map(row => row.pic),
    metaList: metaSchedule.map(row => row.pic),
    caliCursor: 0
  };
  return state;
}

export function buildMetaEmotionPractice(state){
  const tl = [];
  tl.push(comparisonInstructions("practice_instructions", true, state.jsPsych));
  for(const t of state.practicePairs){
    tl.push(twoIFC(state, state.jsPsych, META_PATHS.practice + t.p1, META_PATHS.practice + t.p2, t.cat, "practice", 0));
  }
  tl.push(instructionScreen("Practice complete", `<p>You have finished the practice image comparisons.</p><p>You may use <b>View again</b> up to <b>${STUDY_RESPONSE_SETTINGS.imageReplayLimit} times during the main image comparison trials</b>. Practice uses <b>do not count</b>.</p><p>The main trials will alternate between image comparisons and the Metronome Task.</p>`, "practice_end", "begin the first set of image comparisons"));
  return tl;
}

export function buildMetaEmotionCalibrationChunk(state, nTrials, chunkIndex){
  const tl = [];
  const start = state.caliCursor;
  const target = state.calibrationTargetCount ?? state.calibrationPairs.length;
  const end = Math.min(target, start + nTrials);
  if (start >= end) return tl;
  const checkpoints = phaseCheckpoints(target, 4);

  for(let i=start; i<end; i++){
    const t = state.calibrationPairs[i];
    const afterTrial = i + 1;
    const checkpointIndex = checkpoints.indexOf(afterTrial);
    const check = checkpointIndex >= 0 ? { id: checkpointIndex + 1, afterTrial } : null;
    tl.push(twoIFC(state, state.jsPsych, META_PATHS.formal + t.p1, META_PATHS.formal + t.p2, t.cat, "calibration", chunkIndex, t.schedule, check));
  }
  state.caliCursor = end;
  return tl;
}

export function buildMetaEmotionReview(state, nItems=20){
  const tl = [];
  // Teach the whole new variation before reviewing its reference picture set.
  tl.push(finalJudgmentInstructions(state.jsPsych));
  // Review keeps its own source list and does not depend on completing calibration.
  state.reviewPresented = state.reviewSchedule.slice(0, nItems).map(row => row.pic);
  state.reviewSchedule.slice(0,nItems).forEach(row=>{
    tl.push(passiveImg(META_PATHS.formal + row.pic, META_TIMING.review_ms, {phase:"review", ...state.scheduleMetadata, ...row.schedule}));
  });
  tl.push(instructionScreen("Final picture judgments", "<p>Keep in mind the feeling you have from seeing the whole picture set.</p>", "review_to_judgment_transition", "begin the final picture judgments"));
  return tl;
}

export function buildMetaEmotionMetaJ(state, nTrials=60){
  const tl = [];
  // Final judgments retain their own stimulus multiset in shortened calibration tests.
  const judgments = state.metaSchedule.slice(0,nTrials);
  const checkpoints = phaseCheckpoints(judgments.length, 3);
  judgments.forEach((row, i)=>{
    const afterTrial = i + 1;
    const checkpointIndex = checkpoints.indexOf(afterTrial);
    const check = checkpointIndex >= 0 ? { id: checkpointIndex + 1, afterTrial } : null;
    tl.push(metaTrial(state, state.jsPsych, META_PATHS.formal + row.pic, 0, {
      ...row.schedule, schedule_review_order: i === 0 ? JSON.stringify(state.reviewPresented || []) : ""
    }, check));
  });
  return tl;
}

export function exportMetaEmotion(state, jsPsych, metadata = {}){
  const subj = state.subject;
  const csvCell = value => {
    const text = value === undefined || value === null || (typeof value === "number" && !Number.isFinite(value))
      ? "" : String(value);
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  };
  // Exact names assigned by Lee's pre/post metaEmotion.R scripts.
  const comparisonHeaders = ["subject", "systemtime", "pic1", "pic2", "category", "rawchoice", "picchoice", "RT"];
  const metaHeaders = ["subject", "systemtime", "pic", "higherlower", "firstRT", "confidence", "secondRT"];
  const detailHeaders = [
    "response_format_version", "image_trial_id", "replay_count", "replays_remaining",
    "total_response_rt_s", "final_response_rt_s", "replay_requests",
    "fast_response", "fast_streak", "type1_fast", "type1_fast_streak",
    "speed_reminder_shown", "speed_reminder_kinds",
    "fast_threshold_ms", "fast_streak_length", "speed_reminder_limit", "replay_limit",
    ...SCHEDULE_FIELDS
  ];
  const stableHeaders = ["row_index", "phase", "chunk", "trial_index", "time_elapsed_ms", "pair_key", "confidence_label", "response_time_s"];
  const metadataKeys = Object.keys(metadata);
  const finalControlHeaders = [
    "final_replay_limit", "final_replays_remaining",
    "certainty_min_ms", "certainty_min_move_px", "certainty_max_move_px",
    "final_check_id", "final_check_after_trial", "final_check_presentation",
    "final_check_expected", "final_check_response", "final_check_correct",
    "final_check_rt_ms", "final_check_min_ms", "final_check_min_move_px", "final_check_max_move_px",
    "cal_check_id", "cal_check_after_trial", "cal_check_expected", "cal_check_response", "cal_check_correct", "cal_check_rt_ms",
    "speed_reminder_group"
  ];
  // Add new controls after all established columns, including session metadata.
  const headers = core => [...core, ...detailHeaders, ...stableHeaders, ...metadataKeys, ...finalControlHeaders];
  const schemas = { practice: headers(comparisonHeaders), calibration: headers(comparisonHeaders), meta: headers(metaHeaders) };
  const rowsToCSV = (schema, rows) => {
    if (new Set(schema).size !== schema.length) throw new Error("Meta-emotion CSV headers must be unique; metadata keys must not duplicate existing fields.");
    rows.forEach((row, i) => {
      if (row.length !== schema.length) throw new Error(`Meta-emotion CSV row ${i + 1} has ${row.length} values for ${schema.length} columns.`);
    });
    return [schema, ...rows].map(row => row.map(csvCell).join(",")).join("\n") + "\n";
  };
  // Append provenance without changing the original response/RT column positions.
  const details = d => [
    d.response_format_version??"", d.image_trial_id??"", d.replay_count??"", d.replays_remaining??"",
    d.total_response_rt_s??"", d.final_response_rt_s??"", d.replay_requests ? JSON.stringify(d.replay_requests) : "",
    d.fast_response??"", d.fast_streak??"", d.type1_fast??"", d.type1_fast_streak??"",
    d.speed_reminder_shown??"", d.speed_reminder_kinds??"",
    d.fast_threshold_ms??"", d.fast_streak_length??"", d.speed_reminder_limit??"", d.replay_limit??"",
    ...SCHEDULE_FIELDS.map(key => d[key] ?? "")
  ];
  const numericImageId = value => value === undefined || value === null || String(value).trim() === ""
    ? NaN : Number(value);
  const unorderedPairKey = d => {
    const ids = [numericImageId(d.pic1_id), numericImageId(d.pic2_id)];
    return ids.every(Number.isFinite) ? ids.sort((a, b) => a - b).join("_") : "";
  };
  const stableDetails = (d, index, phase) => [
    index + 1, phase, d.chunk, d.trial_index, d.time_elapsed,
    phase === "meta" ? "" : unorderedPairKey(d),
    phase === "meta" ? confidenceLabel(d.conf_key) : "",
    phase === "meta" ? (d.type1_time_s ?? d.conf_time_s) : d.timestamp_s,
    ...metadataKeys.map(key => metadata[key])
  ];
  const finalControlDetails = d => finalControlHeaders.map(key => d[key] ?? "");
  const comparisonRows = phase => jsPsych.data.get().filter({task:"metaemotion", event:"2ifc", phase}).values()
    .map((d, i) => [
      subj, d.timestamp_s, d.pic1_id, d.pic2_id,
      // The source's optional pair code is not an emotion category.
      Number.isFinite(d.cat) ? d.cat : "", d.choice_key, d.chosen_id, d.rt_s,
      ...details(d), ...stableDetails(d, i, phase), ...finalControlDetails(d)
    ]);
  const prac = comparisonRows("practice");
  const cali = comparisonRows("calibration");
  const meta = jsPsych.data.get().filter({task:"metaemotion", event:"meta_conf"}).values()
    .map((d, i) => [
      subj, d.type1_time_s ?? d.conf_time_s, d.pic_id, d.type1_key, d.type1_rt_s, d.conf_key, d.conf_rt_s,
      ...details(d), ...stableDetails(d, i, "meta"), ...finalControlDetails(d)
    ]);

  return {
    pracCsvText: rowsToCSV(schemas.practice, prac),
    caliCsvText: rowsToCSV(schemas.calibration, cali),
    metaJCsvText: rowsToCSV(schemas.meta, meta),
    schemas,
    counts: { practice: prac.length, calibration: cali.length, meta: meta.length },
    stamp: matlabTimestamp(new Date())
  };
}
