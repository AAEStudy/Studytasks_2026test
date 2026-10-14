// main.js (ES module)
// Orchestrates interleaving MRT and Meta-Emotion calibration while producing ONE file per task.
//
// Data saving uses DataPipe and local downloads; Qualtrics redirect is optional.

import { initMetaEmotion, buildMetaEmotionPractice, buildMetaEmotionCalibrationChunk, buildMetaEmotionReview, buildMetaEmotionMetaJ, exportMetaEmotion } from "./metaemotion.js?v=20261014-image-instructions";

// ===================== QUICK TEST CONTROLS =====================
// Full study: const META_CALIBRATION_COMPARISONS = "ALL";
const META_CALIBRATION_COMPARISONS = 6;

// Full study: const MRT_TOTAL_BLOCKS = 35;
const MRT_TOTAL_BLOCKS = 1;

// These can usually stay as-is. They only control how the shortened/long task is split.
const META_CALIBRATION_COMPARISONS_PER_CHUNK = 10;
const MRT_BLOCKS_PER_CHUNK = 2;

// null = a fresh reproducible image order each session; use an integer for a fixed test order.
const IMAGE_SCHEDULE_SEED = null;
const SHUFFLE_REVIEW_AND_META_JUDGMENTS = true;

// Keep local downloads during testing as a backup for the DataPipe saves.
const DOWNLOAD_RESULTS_AT_END = true;
const SAVE_TO_DATA_PIPE = true;
const DATA_PIPE_EXPERIMENT_ID = "9XShb2sstH1d";
const REDIRECT_TO_QUALTRICS = false;
const QUALTRICS_RETURN_PARAM = "return";

// Qualtrics-provided participant identifiers.
const urlParams = new URLSearchParams(window.location.search);

function getParam(name){ return urlParams.get(name); }

let subjectID = urlParams.get("subjectID");
let numericID = urlParams.get("id");

if (!subjectID) {
  subjectID = "random" + Math.floor(10000 + Math.random() * 90000);
}

// Qualtrics return link (edit key if needed)
const qualtricsReturn = getParam(QUALTRICS_RETURN_PARAM) || null;

function sessionStamp(d=new Date()){
  return d.toISOString().replace("T", "_").replace(/:/g, ".");
}
function safeFilenamePart(value){
  return String(value || "NA").replace(/[^A-Za-z0-9._-]+/g, "_");
}

const EXPORT_SCHEMA_VERSION = "fae-export-v2";
const STUDY_VERSION = "FAE-2026-10-14-data-v2";
const SESSION_STARTED_AT_UTC = new Date().toISOString();
const SESSION_STAMP = sessionStamp(new Date(SESSION_STARTED_AT_UTC));
const SESSION_RANDOM_ID = globalThis.crypto?.randomUUID?.()
  ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const SESSION_ID = `${SESSION_STAMP}_${SESSION_RANDOM_ID}`;
const RUN_MODE = MRT_TOTAL_BLOCKS === 35 && (META_CALIBRATION_COMPARISONS === "ALL" || META_CALIBRATION_COMPARISONS === 380)
  ? "full" : "test";
const SAFE_SUBJECT_ID = safeFilenamePart(subjectID);

const RESULT_FILENAMES = {
  mrt: `MRT_${RUN_MODE}_${SAFE_SUBJECT_ID}_${SESSION_ID}.tsv`,
  metaPractice: `Meta_emotion_practice_${RUN_MODE}_${SAFE_SUBJECT_ID}_${SESSION_ID}.csv`,
  metaCalibration: `Meta_emotion_cali_${RUN_MODE}_${SAFE_SUBJECT_ID}_${SESSION_ID}.csv`,
  metaJudgment: `Meta_emotion_metaJ_${RUN_MODE}_${SAFE_SUBJECT_ID}_${SESSION_ID}.csv`
};

function getSessionMetadata(jsPsych){
  const state = window.__metaState;
  const rows = jsPsych.data.get().values();
  const count = predicate => rows.filter(predicate).length;
  const practiceCompleted = count(d => d.task === "metaemotion" && d.event === "2ifc" && d.phase === "practice");
  const calibrationCompleted = count(d => d.task === "metaemotion" && d.event === "2ifc" && d.phase === "calibration");
  const metaCompleted = count(d => d.task === "metaemotion" && d.event === "meta_conf");
  const reviewCompleted = count(d => d.task === "metaemotion" && d.event === "image" && d.phase === "review");
  const mrtCompleted = (sharedState.customData?.task || []).filter(task => task === "thought_probe").length;
  const configuredComplete = practiceCompleted === state.practicePairs.length
    && calibrationCompleted === state.calibrationTargetCount
    && metaCompleted === 60 && reviewCompleted === 20 && mrtCompleted === MRT_TOTAL_BLOCKS;
  return {
    export_schema_version: EXPORT_SCHEMA_VERSION,
    study_version: STUDY_VERSION,
    session_id: SESSION_ID,
    session_started_at_utc: SESSION_STARTED_AT_UTC,
    run_mode: RUN_MODE,
    practice_trials_planned: state.practicePairs.length,
    practice_trials_completed: practiceCompleted,
    calibration_trials_planned: state.calibrationTargetCount,
    calibration_trials_completed: calibrationCompleted,
    calibration_trials_full: state.calibrationPairs.length,
    meta_trials_planned: 60,
    meta_trials_completed: metaCompleted,
    review_images_planned: 20,
    review_images_completed: reviewCompleted,
    mrt_blocks_planned: MRT_TOTAL_BLOCKS,
    mrt_blocks_completed: mrtCompleted,
    configured_tasks_complete: configuredComplete,
    full_protocol_complete: RUN_MODE === "full" && configuredComplete
  };
}

function getResultExports(jsPsych){
  // Freeze one completed-task snapshot so downloads and uploads use identical bytes.
  if (sharedState.resultExports) return sharedState.resultExports;
  const metadata = getSessionMetadata(jsPsych);
  const metaOut = exportMetaEmotion(window.__metaState, jsPsych, metadata);
  const mrtTsv = (sharedState.convertToCSV && sharedState.customData)
    ? sharedState.convertToCSV(sharedState.customData, metadata)
    : "";

  sharedState.resultExports = {
    mrtTsv,
    pracCsvText: metaOut.pracCsvText,
    caliCsvText: metaOut.caliCsvText,
    metaJCsvText: metaOut.metaJCsvText
  };
  return sharedState.resultExports;
}

function getResultFiles(jsPsych){
  const out = getResultExports(jsPsych);
  return [
    { filename: RESULT_FILENAMES.mrt, text: out.mrtTsv, mime: "text/tab-separated-values" },
    { filename: RESULT_FILENAMES.metaPractice, text: out.pracCsvText, mime: "text/csv" },
    { filename: RESULT_FILENAMES.metaCalibration, text: out.caliCsvText, mime: "text/csv" },
    { filename: RESULT_FILENAMES.metaJudgment, text: out.metaJCsvText, mime: "text/csv" }
  ].filter(file => String(file.text || "").length > 0);
}

function downloadTextFile(filename, text, mime){
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadAllResults(jsPsych){
  getResultFiles(jsPsych).forEach(file => downloadTextFile(file.filename, file.text, file.mime));
}

function buildPipeSaveTrials(jsPsych){
  const fileDefs = [
    { key: "mrt", filename: RESULT_FILENAMES.mrt, getText: () => getResultExports(jsPsych).mrtTsv },
    { key: "metaPractice", filename: RESULT_FILENAMES.metaPractice, getText: () => getResultExports(jsPsych).pracCsvText },
    { key: "metaCalibration", filename: RESULT_FILENAMES.metaCalibration, getText: () => getResultExports(jsPsych).caliCsvText },
    { key: "metaJudgment", filename: RESULT_FILENAMES.metaJudgment, getText: () => getResultExports(jsPsych).metaJCsvText }
  ];

  return fileDefs.map(file => ({
    type: jsPsychPipe,
    action: "save",
    experiment_id: DATA_PIPE_EXPERIMENT_ID,
    filename: file.filename,
    data_string: file.getText,
    data: { task: "system", event: "pipe_save", file: file.key }
  }));
}

// Prepare audio for MRT (uses same filenames as your MRT task; adjust if your repo differs)
const metronomeAudio = new Audio("sounds/metronomeMono.mp3");

// Transition screen helper (SPACE to continue)
function transitionScreen(html, dataExtra={}){
  return {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: `<div class="center" style="font-size:22px; line-height:1.35; max-width:900px; margin:0 auto;">${html}</div>`,
    choices: [" "],
    data: {task:"system", event:"transition", ...dataExtra}
  };
}

// Unlock audio on user gesture (required by browsers)
function audioUnlockTrial(nextSet = false, switching = true){
  return {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: `<div class="center" style="font-size:22px; line-height:1.35;">
      <p><b>${nextSet && switching ? "Switch to the Metronome Task" : "Metronome Task"}</b></p>
      <p>Press <b>SPACE</b> to ${nextSet ? "begin the next set of Metronome Task trials" : "continue (this enables audio)"}.</p>
    </div>`,
    choices: [" "],
    on_finish: async () => {
      try {
        metronomeAudio.currentTime = 0;
        await metronomeAudio.play();
        metronomeAudio.pause();
        metronomeAudio.currentTime = 0;
      } catch(e) {}
      try {
        bellAudio.currentTime = 0;
        await bellAudio.play();
        bellAudio.pause();
        bellAudio.currentTime = 0;
      } catch(e) {}
    },
    data: {task:"system", event:nextSet ? "task_switch" : "audio_unlock", next:"mrt"}
  };
}


// Global shared state for interleaving
const sharedState = { mrtCursor: 0, mrtInitialized: false, mrtMainStarted: false, trialNum: 0, probeBlockCounter: 0 };

const jsPsych = initJsPsych({
  on_finish: async () => {
    if (REDIRECT_TO_QUALTRICS && qualtricsReturn) {
      window.location.href = qualtricsReturn;
    }
  }
});

jsPsych.data.addProperties({ subject: subjectID });

// Make jsPsych available for MRT builder (it expects params.jsPsych)
window.__jsPsychInstance = jsPsych;

async function start(){
  // Init Meta-Emotion lists
  const metaState = await initMetaEmotion({
    subject: subjectID, calibrationLimit: META_CALIBRATION_COMPARISONS, jsPsych,
    imageScheduleSeed: IMAGE_SCHEDULE_SEED, shuffleFollowupStages: SHUFFLE_REVIEW_AND_META_JUDGMENTS
  });
  window.__metaState = metaState;

  const timeline = [];
  const calibrationChunkSize = Math.max(1, Math.min(META_CALIBRATION_COMPARISONS_PER_CHUNK, metaState.calibrationTargetCount));
  const mrtBlocksPerChunk = Math.max(1, Math.min(MRT_BLOCKS_PER_CHUNK, MRT_TOTAL_BLOCKS));

  // ---- Preload Meta-Emotion images to prevent uneven display / blank frames ----
  const metaPreload = [];
  // practice images
  for (const t of metaState.practicePairs){ metaPreload.push("stimuli/practice/" + t.p1); metaPreload.push("stimuli/practice/" + t.p2); }
  // calibration images (pairs requested for this run)
  for (const t of metaState.calibrationPairs.slice(0, metaState.calibrationTargetCount)){ metaPreload.push("stimuli/formal/" + t.p1); metaPreload.push("stimuli/formal/" + t.p2); }
  // review + meta lists
  for (const fn of metaState.reviewList){ metaPreload.push("stimuli/formal/" + fn); }
  for (const fn of metaState.metaList){ metaPreload.push("stimuli/formal/" + fn); }

  // Start with MRT immediately; its SPACE gesture unlocks audio for practice.
  timeline.push(audioUnlockTrial());
  timeline.push(...buildMRTPractice({
    jsPsych,
    subjectID,
    metronomeAudio,
    _state: sharedState,
    includeMidBreak: false,
    numBlocks: MRT_TOTAL_BLOCKS
  }).timeline);

  timeline.push(transitionScreen(`<p><b>Image comparison task</b></p>
    <p>Next, we will explain the image comparison task and give you some practice trials.</p>
    <p>Press <b>SPACE</b> to continue.</p>`, {event:"image_practice_transition", next:"image_practice"}));

  // Load picture assets after MRT practice so they cannot delay the first task.
  timeline.push({
    type: jsPsychPreload,
    images: [...new Set(metaPreload)],
    show_progress_bar: true
  });

  // Picture instructions and practice follow the completed MRT practice.
  timeline.push(...buildMetaEmotionPractice(metaState));

  // -------- Interleaving plan --------
  let calibrationChunkIndex = 1;
  let lastMainTask = null;
  while (metaState.caliCursor < metaState.calibrationTargetCount || sharedState.mrtCursor < MRT_TOTAL_BLOCKS) {
    if (metaState.caliCursor < metaState.calibrationTargetCount) {
      if (calibrationChunkIndex > 1) {
        timeline.push(transitionScreen(`<p><b>${lastMainTask === "mrt" ? "Switch to image comparisons" : "Image comparisons"}</b></p><p>Press <b>SPACE</b> to continue to the next set of image comparisons.</p>`, {event:"task_switch", next:"calibration"}));
      }
      timeline.push(...buildMetaEmotionCalibrationChunk(metaState, calibrationChunkSize, calibrationChunkIndex));
      calibrationChunkIndex++;
      lastMainTask = "calibration";
    }

    if (sharedState.mrtCursor < MRT_TOTAL_BLOCKS) {
      const firstMrtSet = !sharedState.mrtMainStarted;
      const mrtChunk = buildMRTChunk({
        jsPsych,
        subjectID,
        metronomeAudio,
        _state: sharedState,
        includeMidBreak: false,
        numBlocks: MRT_TOTAL_BLOCKS,
        blocksToTake: mrtBlocksPerChunk
      }).timeline;

      if (mrtChunk.length > 0) {
        // The first set already has its own audio-enable transition and countdown.
        if (!firstMrtSet) timeline.push(audioUnlockTrial(true, lastMainTask !== "mrt"));
        timeline.push(...mrtChunk);
        lastMainTask = "mrt";
      }
    }
  }

  // Review and meta-judgment always use their own lists, even in shortened calibration tests.
  timeline.push(...buildMetaEmotionReview(metaState, 20));
  timeline.push(...buildMetaEmotionMetaJ(metaState, 60));

  if (SAVE_TO_DATA_PIPE) {
    timeline.push(...buildPipeSaveTrials(jsPsych));
  }

  // End screen. Local downloads happen here because the SPACE press counts as a user gesture.
  timeline.push({
    type: jsPsychHtmlKeyboardResponse,
    stimulus: `<div class="center" style="font-size:24px; line-height:1.35;">
      <p>Done.</p>
      <p>Press <b>SPACE</b> to ${DOWNLOAD_RESULTS_AT_END ? "download your result files" : "finish"}.</p>
    </div>`,
    choices: [" "],
    on_finish: () => {
      if (DOWNLOAD_RESULTS_AT_END) downloadAllResults(jsPsych);
    },
    data: {task:"system", event:"end_download"}
  });

  jsPsych.run(timeline);
}

start();
