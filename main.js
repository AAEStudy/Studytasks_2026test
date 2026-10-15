// main.js (ES module)
// Orchestrates interleaving MRT and Meta-Emotion calibration while producing ONE file per task.
//
// Data saving uses DataPipe and local downloads; Qualtrics redirect is optional.

import { initMetaEmotion, buildMetaEmotionPractice, buildMetaEmotionCalibrationChunk, buildMetaEmotionReview, buildMetaEmotionMetaJ, exportMetaEmotion } from "./metaemotion.js?v=20261015-final-check-clicks";

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
const STUDY_VERSION = "FAE-2026-10-15-final-check-clicks";
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

// Give participants a replayable sample of the actual task sound before practice.
function metronomeSoundCheckTrial(){
  let cleanup = () => {};
  let onset = 0;
  let previewRequests = 0;
  let previewSuccesses = 0;
  let playbackFailures = 0;
  let ticksPlayed = 0;
  return {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: `<section class="mrt-sound-check-screen">
      <h2>Metronome Task</h2>
      <p>Please note that this part of the experiment requires your <b>audio to be on</b>. Please use <b>headphones</b> if you have them available. If not, you may use your <b>speakers</b>.</p>
      <p>Before you begin, check your volume.</p>
      <p>Play the metronome sound, then adjust your volume to a level that is clearly audible and comfortable to listen to for a while.</p>
      <button type="button" id="metronome-sound-check-toggle" class="mrt-sound-check-button" aria-pressed="false">Play metronome sound</button>
      <p id="metronome-sound-check-status" class="mrt-sound-check-status" role="status" aria-live="polite">The sample plays five sounds and then stops. You can play it again if needed.</p>
      <p class="mrt-sound-check-continue">Press <b>SPACE</b> to begin the instructions.</p>
    </section>`,
    choices: "NO_KEYS",
    data: { task: "system", event: "audio_unlock", next: "mrt", sound_check_available: true },
    on_load: () => {
      cleanup();
      onset = performance.now();
      const display = jsPsych.getDisplayElement();
      const button = display.querySelector("#metronome-sound-check-toggle");
      const status = display.querySelector("#metronome-sound-check-status");
      let active = false;
      let finished = false;
      let generation = 0;
      let sampleTimer = null;
      const pauseSound = () => {
        metronomeAudio.pause();
        try { metronomeAudio.currentTime = 0; } catch(e) {}
      };
      const setStatus = text => { if (status) status.textContent = text; };
      const stopSample = message => {
        generation++;
        active = false;
        if (sampleTimer !== null) window.clearTimeout(sampleTimer);
        sampleTimer = null;
        pauseSound();
        button.textContent = "Play metronome sound";
        button.setAttribute("aria-pressed", "false");
        if (message) setStatus(message);
      };
      const startSample = () => {
        stopSample();
        active = true;
        const token = generation;
        let runTicks = 0;
        previewRequests++;
        button.textContent = "Stop sound";
        button.setAttribute("aria-pressed", "true");
        setStatus("Adjust your volume while the sample plays.");
        const current = () => !finished && active && token === generation;
        const failed = () => {
          if (!current()) return;
          playbackFailures++;
          stopSample("The sound could not play. Please try the sample again.");
        };
        const tick = () => {
          if (!current()) return;
          let playResult;
          try {
            metronomeAudio.currentTime = 0;
            playResult = metronomeAudio.play();
          } catch(e) {
            failed();
            return;
          }
          Promise.resolve(playResult).then(() => {
            // A stale completion must never schedule more ticks or pause audio
            // that a newer preview or subsequent MRT trial now owns.
            if (!current()) return;
            if (runTicks === 0) previewSuccesses++;
            runTicks++;
            ticksPlayed++;
            sampleTimer = window.setTimeout(() => {
              if (!current()) return;
              sampleTimer = null;
              if (runTicks < 5) tick();
              else stopSample("Sound check complete. You can replay the sample if needed.");
            }, 1300);
          }, failed);
        };
        tick();
      };
      const toggleSample = () => {
        if (finished) return;
        if (active) stopSample("Sample stopped. You can play it again if needed.");
        else startSample();
      };
      const stopOnBlur = () => {
        if (active) stopSample("Sample stopped. You can play it again if needed.");
      };
      const stopWhenHidden = () => { if (document.hidden) stopOnBlur(); };
      const continueToInstructions = event => {
        if (finished || event.repeat || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
        if (event.code !== "Space" && event.key !== " " && event.key !== "Spacebar") return;
        event.preventDefault();
        event.stopImmediatePropagation();
        finished = true;
        cleanup();
        if (previewSuccesses === 0) {
          // Preserve per-element media authorization when the optional sample
          // was skipped. Pause synchronously so no sample follows this screen.
          try {
            const unlock = metronomeAudio.play();
            if (unlock && typeof unlock.catch === "function") unlock.catch(() => {});
          } catch(e) {}
          pauseSound();
        }
        jsPsych.finishTrial({ response: " ", rt: performance.now() - onset });
      };
      button.addEventListener("click", toggleSample);
      document.addEventListener("keydown", continueToInstructions, true);
      window.addEventListener("blur", stopOnBlur);
      document.addEventListener("visibilitychange", stopWhenHidden);
      cleanup = () => {
        finished = true;
        stopSample();
        button.removeEventListener("click", toggleSample);
        document.removeEventListener("keydown", continueToInstructions, true);
        window.removeEventListener("blur", stopOnBlur);
        document.removeEventListener("visibilitychange", stopWhenHidden);
      };
    },
    on_finish: data => {
      cleanup();
      Object.assign(data, {
        sound_check_preview_requests: previewRequests,
        sound_check_preview_successes: previewSuccesses,
        sound_check_play_failures: playbackFailures,
        sound_check_ticks_played: ticksPlayed
      });
    }
  };
}

// Later task-switch screens retain their existing audio-enable gesture.
function audioUnlockTrial(nextSet = false){
  if (!nextSet) return metronomeSoundCheckTrial();
  return {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: `<div class="center" style="font-size:22px; line-height:1.35;">
      <p><b>Metronome Task</b></p>
      <p>You will now have some metronome tapping trials.</p>
      <p>Press <b>SPACE</b> to continue to the next set of Metronome Task trials.</p>
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
    data: {task:"system", event:"task_switch", next:"mrt"}
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

  timeline.push(transitionScreen(`<p><b>Image Comparison Task</b></p>
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
  while (metaState.caliCursor < metaState.calibrationTargetCount || sharedState.mrtCursor < MRT_TOTAL_BLOCKS) {
    if (metaState.caliCursor < metaState.calibrationTargetCount) {
      if (calibrationChunkIndex > 1) {
        timeline.push(transitionScreen(`<p><b>Image Comparison Task</b></p><p>You will now have some image comparison trials.</p><p>Press <b>SPACE</b> to continue to the next set of image comparisons.</p>`, {event:"task_switch", next:"calibration"}));
      }
      timeline.push(...buildMetaEmotionCalibrationChunk(metaState, calibrationChunkSize, calibrationChunkIndex));
      calibrationChunkIndex++;
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
        if (!firstMrtSet) timeline.push(audioUnlockTrial(true));
        timeline.push(...mrtChunk);
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
