// main.js (ES module)
// Orchestrates interleaving MRT and Meta-Emotion calibration while producing ONE file per task.
//
// Data saving uses local downloads by default; OSF Pipe + Qualtrics switches are below.

import { initMetaEmotion, buildMetaEmotionPractice, buildMetaEmotionCalibrationChunk, buildMetaEmotionReview, buildMetaEmotionMetaJ, exportMetaEmotion } from "./metaemotion.js";

// ===================== QUICK TEST CONTROLS =====================
// Full study: const META_CALIBRATION_COMPARISONS = "ALL";
const META_CALIBRATION_COMPARISONS = 6;

// Full study: const MRT_TOTAL_BLOCKS = 35;
const MRT_TOTAL_BLOCKS = 1;

// These can usually stay as-is. They only control how the shortened/long task is split.
const META_CALIBRATION_COMPARISONS_PER_CHUNK = 10;
const MRT_BLOCKS_PER_CHUNK = 2;

// Local testing downloads result files at the end. For OSF/Qualtrics, switch these.
const DOWNLOAD_RESULTS_AT_END = true;
const SAVE_TO_OSF_PIPE = false;
const OSF_PIPE_EXPERIMENT_ID = "YOUR_OSF_ID";
const REDIRECT_TO_QUALTRICS = false;
const QUALTRICS_RETURN_PARAM = "return";

// Helper: URL param
function getParam(name){ return new URLSearchParams(window.location.search).get(name); }

// Qualtrics-provided participant ID (edit key if needed)
const subjectID = getParam("id") || getParam("PROLIFIC_PID") || "NA";

// Qualtrics return link (edit key if needed)
const qualtricsReturn = getParam(QUALTRICS_RETURN_PARAM) || null;

function pad2(n){ return String(n).padStart(2, "0"); }
function sessionStamp(d=new Date()){
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}_${pad2(d.getHours())}.${pad2(d.getMinutes())}`;
}
function safeFilenamePart(value){
  return String(value || "NA").replace(/[^A-Za-z0-9._-]+/g, "_");
}

const SESSION_STAMP = sessionStamp();
const SAFE_SUBJECT_ID = safeFilenamePart(subjectID);

const RESULT_FILENAMES = {
  mrt: `MRT_${SAFE_SUBJECT_ID}_${SESSION_STAMP}.tsv`,
  metaPractice: `Meta_emotion_practice_${SAFE_SUBJECT_ID}_${SESSION_STAMP}.csv`,
  metaCalibration: `Meta_emotion_cali_${SAFE_SUBJECT_ID}_${SESSION_STAMP}.csv`,
  metaJudgment: `Meta_emotion_metaJ_${SAFE_SUBJECT_ID}_${SESSION_STAMP}.csv`
};

function getResultExports(jsPsych){
  const metaOut = exportMetaEmotion(window.__metaState, jsPsych);
  const mrtTsv = (sharedState.convertToCSV && sharedState.customData)
    ? sharedState.convertToCSV(sharedState.customData)
    : "";

  return {
    mrtTsv,
    pracCsvText: metaOut.pracCsvText,
    caliCsvText: metaOut.caliCsvText,
    metaJCsvText: metaOut.metaJCsvText
  };
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
    experiment_id: OSF_PIPE_EXPERIMENT_ID,
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
function audioUnlockTrial(){
  return {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: `<div class="center" style="font-size:22px; line-height:1.35;">
      <p><b>Metronome Task</b></p>
      <p>Press <b>SPACE</b> to continue (this enables audio).</p>
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
    data: {task:"system", event:"audio_unlock"}
  };
}


// Global shared state for interleaving
const sharedState = { mrtCursor: 0, mrtInitialized: false, trialNum: 0, probeBlockCounter: 0 };

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
  const metaState = await initMetaEmotion({ subject: subjectID, calibrationLimit: META_CALIBRATION_COMPARISONS });
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
  // instruction images
  metaPreload.push("assets/instruction.jpg","assets/endx_prac.jpg","assets/restx.jpg","assets/instruction2.jpg");

  timeline.push({
    type: jsPsychPreload,
    images: [...new Set(metaPreload)],
    show_progress_bar: true
  });


  // Start screen
  timeline.push({
    type: jsPsychHtmlKeyboardResponse,
    stimulus: `<div class="center" style="font-size:24px; line-height:1.35;">
      <p><b>Session</b></p>
      <p>Press <b>SPACE</b> to begin.</p>
    </div>`,
    choices: [" "],
    data: {task:"system", event:"start"}
  });

  // Optional: Meta-Emotion practice
  timeline.push(...buildMetaEmotionPractice(metaState));

  // -------- Interleaving plan --------
  let calibrationChunkIndex = 1;
  while (metaState.caliCursor < metaState.calibrationTargetCount || sharedState.mrtCursor < MRT_TOTAL_BLOCKS) {
    if (metaState.caliCursor < metaState.calibrationTargetCount) {
      if (calibrationChunkIndex > 1) {
        timeline.push(transitionScreen("<p><b>Meta-Emotion Calibration</b></p><p>Press <b>SPACE</b> to continue.</p>", {next:"calibration"}));
      }
      timeline.push(...buildMetaEmotionCalibrationChunk(metaState, calibrationChunkSize, calibrationChunkIndex));
      calibrationChunkIndex++;
    }

    if (sharedState.mrtCursor < MRT_TOTAL_BLOCKS) {
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
        timeline.push(audioUnlockTrial());
        timeline.push(...mrtChunk);
      }
    }
  }

  // Review and meta-judgment always use their own lists, even in shortened calibration tests.
  timeline.push(...buildMetaEmotionReview(metaState, 20));
  timeline.push(...buildMetaEmotionMetaJ(metaState, 60));

  if (SAVE_TO_OSF_PIPE) {
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
