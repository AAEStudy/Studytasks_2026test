// main.js (ES module)
// Orchestrates interleaving MRT and Meta-Emotion calibration while producing ONE file per task.
//
// Data saving sends five text files to Drive via DataPipe, with Qualtrics fallback.

import { initMetaEmotion, buildMetaEmotionPractice, buildMetaEmotionCalibrationChunk, buildMetaEmotionReview, buildMetaEmotionMetaJ, exportMetaEmotion } from "./metaemotion.js?v=20261018-middle-level";
import { splitStudyExports } from "./js/analysis-exports.mjs?v=20261020-full-schedule";
import { resolveStudyConfig, createMrtIntervalSchedule } from "./js/study-schedule.mjs?v=20261020-drive-files";
import { buildSectionBreak } from "./js/study-breaks.mjs?v=20261020-full-schedule";
import { createSessionZip } from "./js/session-bundle.mjs?v=20261019-bundle";
import { createQualtricsCodec, postQualtricsBundle } from "./js/qualtrics-bundle.mjs?v=20261019-save-tab";
import { stageQualtricsSession, listPendingQualtricsSessions, completeQualtricsReturn } from "./js/qualtrics-outbox.mjs?v=20261019-save-tab";
import { openQualtricsSaveTab, waitForQualtricsTabReceipt } from "./js/qualtrics-tab-handoff.mjs?v=20261019-save-tab";

// ===================== QUICK TEST CONTROLS =====================
// Redirect-only check: uncomment REDIRECT_TEST_ONLY = true below to skip tasks/saves.
// Comment it out again to restore the task flow. You can also append
// &redirectTest=1 to the GitHub URL after arriving from Qualtrics.
let REDIRECT_TEST_ONLY = false;
// REDIRECT_TEST_ONLY = true;
// Short mode is the temporary default for the Drive save test. Append ?mode=full
// (or &mode=full after existing parameters) to run the preserved full schedule.
// The default for all launches is one switch in js/study-schedule.mjs.
const STUDY_CONFIG = resolveStudyConfig(window.location.search);
const META_CALIBRATION_COMPARISONS = STUDY_CONFIG.calibrationComparisons;
const MRT_TOTAL_BLOCKS = STUDY_CONFIG.mrtProbeIntervals;

// null = a fresh reproducible image order each session; use an integer for a fixed test order.
const IMAGE_SCHEDULE_SEED = null;
const SHUFFLE_REVIEW_AND_META_JUDGMENTS = true;

// Participant file downloads are disabled in both full and short test modes.
// This switch does not control remote saves or the Qualtrics recovery outbox.
const DOWNLOAD_RESULTS_AT_END = false;
const SAVE_TO_DATA_PIPE = true;
const DATA_PIPE_EXPERIMENT_ID = "ThTYlS6YRHym";
const REDIRECT_TO_QUALTRICS = true;
const DEFAULT_QUALTRICS_RETURN_URL = "https://usf.az1.qualtrics.com/jfe/form/SV_8wijLZLkAmgskVE";
const QUALTRICS_RETURN_PARAM = "return";
// Normal Drive saves use Qualtrics only if any file is not confirmed stored.
// Explicit saveTo=both, datapipe, or qualtrics remains available for testing.
const DEFAULT_DATA_SAVE_TARGET = "drive";
const QUALTRICS_RECEIVER_URL = "https://usf.az1.qualtrics.com/jfe/form/SV_b7rI1T6DVd3u0dw";

// Qualtrics-provided participant identifiers.
const urlParams = new URLSearchParams(window.location.search);

function getParam(name){ return urlParams.get(name); }
const requestedSaveTarget = getParam("saveTo");
const DATA_SAVE_TARGET = ["drive", "both", "datapipe", "qualtrics"].includes(requestedSaveTarget)
  ? requestedSaveTarget : DEFAULT_DATA_SAVE_TARGET;
const ACTIVE_SAVE_TO_DATA_PIPE = SAVE_TO_DATA_PIPE && ["drive", "both", "datapipe"].includes(DATA_SAVE_TARGET);
const SAVE_TO_QUALTRICS = ["drive", "both", "qualtrics"].includes(DATA_SAVE_TARGET);

let subjectID = urlParams.get("subjectID");
let numericID = urlParams.get("id");

if (!subjectID) {
  subjectID = "random" + Math.floor(10000 + Math.random() * 90000);
}

// Keep participant matching separate from any survey-specific resume parameters.
function buildQualtricsReturnUrl(baseUrl, fullSubjectID, suppliedId){
  const destination = new URL(baseUrl);
  if (destination.protocol !== "https:" || !destination.hostname.endsWith(".qualtrics.com")
      || destination.username || destination.password) {
    throw new TypeError("The return destination must be an HTTPS Qualtrics URL.");
  }
  // Match the original Tasks/Metronome return: do not add subjectID to the survey URL.
  // Qualtrics already holds it as Embedded Data; task exports retain the full ID.
  const legacyId = /^ID(\d+)$/.exec(String(fullSubjectID || ""))?.[1];
  const returnId = destination.searchParams.get("id")?.trim();
  const participantId = String(suppliedId ?? "").trim() || returnId || legacyId;
  if (participantId) destination.searchParams.set("id", participantId);
  else destination.searchParams.delete("id");
  return destination.toString();
}

function getQualtricsReturnUrl(){
  const requestedReturn = getParam(QUALTRICS_RETURN_PARAM) || DEFAULT_QUALTRICS_RETURN_URL;
  try {
    return buildQualtricsReturnUrl(requestedReturn, subjectID, numericID);
  } catch (error) {
    console.warn("Invalid Qualtrics return URL; using the configured survey destination.");
    return buildQualtricsReturnUrl(DEFAULT_QUALTRICS_RETURN_URL, subjectID, numericID);
  }
}

function sessionStamp(d=new Date()){
  return d.toISOString().replace("T", "_").replace(/:/g, ".");
}
function safeFilenamePart(value){
  return String(value || "NA").replace(/[^A-Za-z0-9._-]+/g, "_");
}

const EXPORT_SCHEMA_VERSION = "fae-export-v3";
const STUDY_VERSION = "FAE-2026-10-20-drive-files";
const SESSION_STARTED_AT_UTC = new Date().toISOString();
const SESSION_STAMP = sessionStamp(new Date(SESSION_STARTED_AT_UTC));
const SESSION_RANDOM_ID = globalThis.crypto?.randomUUID?.()
  ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const SESSION_ID = `${SESSION_STAMP}_${SESSION_RANDOM_ID}`;
const RUN_MODE = STUDY_CONFIG.mode;
const SAFE_SUBJECT_ID = safeFilenamePart(subjectID);

const RESULT_FILENAMES = {
  mrt: `MRT_${RUN_MODE}_${SAFE_SUBJECT_ID}_${SESSION_ID}.tsv`,
  metaPractice: `Meta_emotion_practice_${RUN_MODE}_${SAFE_SUBJECT_ID}_${SESSION_ID}.csv`,
  metaCalibration: `Meta_emotion_cali_${RUN_MODE}_${SAFE_SUBJECT_ID}_${SESSION_ID}.csv`,
  metaJudgment: `Meta_emotion_metaJ_${RUN_MODE}_${SAFE_SUBJECT_ID}_${SESSION_ID}.csv`,
  diagnostics: `Diagnostics_${RUN_MODE}_${SAFE_SUBJECT_ID}_${SESSION_ID}.json`
};
// Real Drive subfolders when DataPipe Psych-DS metadata is off.
// The optional Qualtrics fallback ZIP retains the same paths and file bytes.
const RESULT_FOLDERS = Object.freeze({
  mrt: "MRT",
  metaPractice: "Image_practice",
  metaCalibration: "Calibration",
  metaJudgment: "Final_judgments",
  diagnostics: "Diagnostics"
});

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
  const plannedBreaks = STUDY_CONFIG.sections.filter(section => section.break);
  const breaksComplete = plannedBreaks.every(section => sharedState.scheduledBreaks.some(
    record => record.section === section.number && record.minimum_met === true));
  return {
    export_schema_version: EXPORT_SCHEMA_VERSION,
    study_version: STUDY_VERSION,
    session_id: SESSION_ID,
    session_started_at_utc: SESSION_STARTED_AT_UTC,
    run_mode: RUN_MODE,
    study_schedule_version: STUDY_CONFIG.scheduleVersion,
    scheduled_breaks_planned: plannedBreaks.length,
    scheduled_breaks_completed: sharedState.scheduledBreaks.length,
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
    full_protocol_complete: RUN_MODE === "full" && configuredComplete && breaksComplete
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

  const outputs = splitStudyExports({
    mrtTsv,
    pracCsvText: metaOut.pracCsvText,
    caliCsvText: metaOut.caliCsvText,
    metaJCsvText: metaOut.metaJCsvText
  }, metadata, RESULT_FILENAMES);
  const diagnostics = JSON.parse(outputs.diagnosticsJsonText);
  diagnostics.study_timing = {
    schedule_version: STUDY_CONFIG.scheduleVersion,
    sections: STUDY_CONFIG.sections,
    mrt_interval_schedule: sharedState.mrtIntervalSchedule || [],
    scheduled_breaks: sharedState.scheduledBreaks,
    progress_events: jsPsych.data.get().values().filter(row =>
      row.task === "system" && ["study_overview", "section_start", "scheduled_break"].includes(row.event))
  };
  outputs.diagnosticsJsonText = JSON.stringify(diagnostics);
  sharedState.resultExports = Object.freeze(outputs);
  return sharedState.resultExports;
}

function getResultFiles(jsPsych){
  const out = getResultExports(jsPsych);
  return [
    { filename: RESULT_FILENAMES.mrt, text: out.mrtTsv, mime: "text/tab-separated-values" },
    { filename: RESULT_FILENAMES.metaPractice, text: out.pracCsvText, mime: "text/csv" },
    { filename: RESULT_FILENAMES.metaCalibration, text: out.caliCsvText, mime: "text/csv" },
    { filename: RESULT_FILENAMES.metaJudgment, text: out.metaJCsvText, mime: "text/csv" },
    { filename: RESULT_FILENAMES.diagnostics, text: out.diagnosticsJsonText, mime: "application/json" }
  ].filter(file => String(file.text || "").length > 0);
}

function getPipeResultFiles(jsPsych){
  const fields = { mrt: "mrtTsv", metaPractice: "pracCsvText", metaCalibration: "caliCsvText",
    metaJudgment: "metaJCsvText", diagnostics: "diagnosticsJsonText" };
  return Object.entries(RESULT_FILENAMES).map(([key, filename]) => ({
    key, filename: `${RESULT_FOLDERS[key]}/${filename}`,
    // Resolve only when saving begins, after all task responses are collected.
    get text(){ return getResultExports(jsPsych)[fields[key]]; }
  }));
}

function getSessionBundleBytes(jsPsych){
  if (!sharedState.bundleBytes) {
    const files = getResultFiles(jsPsych).map(file => {
      const key = Object.keys(RESULT_FILENAMES).find(key => RESULT_FILENAMES[key] === file.filename);
      return { ...file, filename: `${RESULT_FOLDERS[key]}/${file.filename}` };
    });
    sharedState.bundleBytes = createSessionZip(files);
  }
  return sharedState.bundleBytes;
}

function qualtricsStorageEnvironment(){
  const environment = { crypto: globalThis.crypto, location: window.location };
  for (const name of ['indexedDB', 'sessionStorage']) {
    try { environment[name] = window[name]; }
    catch { environment[name] = undefined; }
  }
  return environment;
}

async function sendResultsToQualtrics(pending){
  if (sharedState.qualtricsTransferInProgress) return;
  const tab = sharedState.qualtricsSaveTab;
  if (!tab || tab.blocked) {
    showQualtricsOpenButton(pending);
    return;
  }
  sharedState.qualtricsTransferInProgress = true;
  const display = jsPsych.getDisplayElement();
  display.innerHTML = '<div class="center"><p>Saving your task data. Please keep this window open…</p></div>';
  try {
    if (!pending) {
      if (!sharedState.qualtricsTransfer) {
        const fields = await createQualtricsCodec().build(getSessionBundleBytes(jsPsych), {
          filename: `FAE_${RUN_MODE}_${SAFE_SUBJECT_ID}_${SESSION_ID}.zip`,
          sessionId: SESSION_ID, subjectId: subjectID, runMode: RUN_MODE
        });
        const returnUrl = getQualtricsReturnUrl();
        const staged = await stageQualtricsSession({ fields, returnUrl,
          receiptBase: new URL('./qualtrics/saved.html', window.location.href).href,
          returnViaOpener: true
        }, qualtricsStorageEnvironment());
        sharedState.qualtricsTransfer = { ...staged, returnUrl };
      }
      pending = sharedState.qualtricsTransfer;
    }
    // Retained sessions from the earlier same-tab route use the same nonce and
    // ZIP, but must ask the receipt page to notify this original tab now.
    const callback = new URL(pending.fields.fae_return_url);
    if (callback.searchParams.has('session') && callback.searchParams.has('nonce') && callback.searchParams.get('tab') !== '1') {
      callback.searchParams.set('tab', '1');
      pending = { ...pending, fields: { ...pending.fields, fae_return_url: callback.href } };
    }
    sharedState.qualtricsTransfer = pending;
    const waiter = waitForQualtricsTabReceipt({ fields: pending.fields, tab }, { window });
    sharedState.qualtricsTabWaiter = waiter;
    void waiter.promise.then(async receipt => {
      if (sharedState.qualtricsTabWaiter !== waiter) return;
      const original = new URL(pending.returnUrl);
      if (original.protocol !== 'https:' || !original.hostname.endsWith('.qualtrics.com') || original.username || original.password) {
        throw new Error('The questionnaire return destination is unavailable.');
      }
      let destination = original.href;
      // Acknowledge promptly after validating the post-submit receipt. Storage
      // cleanup may take longer than the child's message handshake.
      sharedState.qualtricsReceiptConfirmed = true;
      sharedState.qualtricsReturnDestination = destination;
      sharedState.studyCompleted = true;
      waiter.acknowledge();
      showQualtricsCompleted(destination);
      try {
        destination = await completeQualtricsReturn(receipt, qualtricsStorageEnvironment());
      } catch (error) {
        // An authenticated post-submit receipt still permits the original tab
        // to continue when storage was blocked or a backup was already cleared.
        console.warn('The completed browser backup could not be cleared:', error);
      }
      if (sharedState.qualtricsTabWaiter !== waiter) return;
      sharedState.qualtricsReturnDestination = destination;
      showQualtricsCompleted(destination);
      // Give the receiver time to process its acknowledgement and close itself.
      window.setTimeout(() => window.location.replace(destination), 150);
    }).catch(error => {
      if (sharedState.qualtricsTabWaiter !== waiter) return;
      console.warn('Submission return could not finish:', error);
      showQualtricsRetry(pending);
    });
    // Keep the original task tab and its leave-page guards in place. Only the
    // child navigates to Qualtrics; a matching receipt authorizes our return.
    await postQualtricsBundle(pending.fields, QUALTRICS_RECEIVER_URL, document, { target: tab.targetName });
    if (!sharedState.qualtricsReceiptConfirmed) showQualtricsWaiting();
  } catch (error) {
    console.warn('Qualtrics transfer could not start:', error);
    showQualtricsRetry(pending);
  }
}

function showQualtricsOpenButton(pending){
  sharedState.qualtricsTransferInProgress = false;
  const display = jsPsych.getDisplayElement();
  display.innerHTML = '<div class="center"><p>To finish saving, please open the submission window. Keep this task window open.</p><button id="open-qualtrics-save" type="button">Open submission window</button></div>';
  display.querySelector('#open-qualtrics-save').addEventListener('click', () => {
    sharedState.qualtricsSaveTab = openQualtricsSaveTab(window);
    void sendResultsToQualtrics(pending);
  }, { once: true });
}

function showQualtricsWaiting(){
  const display = jsPsych.getDisplayElement();
  display.innerHTML = '<div class="center"><p>Waiting for the submission window to finish saving. Please keep both windows open.</p><p>You will continue to the questionnaires here when it finishes.</p><button id="view-qualtrics-save" type="button">View submission window</button></div>';
  display.querySelector('#view-qualtrics-save').addEventListener('click', () => {
    try { sharedState.qualtricsSaveTab?.windowRef?.focus(); } catch {}
  });
}

function showQualtricsCompleted(destination){
  const href = destination.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  jsPsych.getDisplayElement().innerHTML = `<div class="center"><p>Your task data was submitted.</p><p><a href="${href}">Continue to the questionnaires</a>.</p></div>`;
}

function showQualtricsRetry(pending){
  const waiter = sharedState.qualtricsTabWaiter;
  sharedState.qualtricsTabWaiter = null;
  if (waiter) waiter.dispose();
  try { sharedState.qualtricsSaveTab?.close(); } catch {}
  sharedState.studyCompleted = false;
  sharedState.qualtricsTransferInProgress = false;
  const display = jsPsych.getDisplayElement();
  display.innerHTML = '<div class="center"><p>Your final task data submission could not be confirmed.</p><p>Please keep this window open.</p><button id="retry-qualtrics-save" type="button">Try saving again</button></div>';
  display.querySelector('#retry-qualtrics-save').addEventListener('click', () => {
    sharedState.qualtricsSaveTab = openQualtricsSaveTab(window);
    void sendResultsToQualtrics(pending);
  }, { once: true });
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

function recordPipeSave(file, data){
  const result = data.result || {};
  const acceptedStates = ["stored", "queued", "accepted"];
  const saveState = typeof result.save_state === "string" ? result.save_state : "unconfirmed";
  data.success = acceptedStates.includes(saveState) && !result.error;
  data.pipe_http_status = typeof result.http_status === "number" ? result.http_status : null;
  const entry = {
    file: file.key, filename: file.filename,
    http_status: data.pipe_http_status, save_state: data.success ? saveState : (acceptedStates.includes(saveState) ? "unconfirmed" : saveState),
    error: result.error ? String(result.error) : (data.success ? null : "The upload could not be confirmed."),
    error_code: result.code || null
  };
  data.pipe_save_state = entry.save_state;
  sharedState.uploadStatuses = sharedState.uploadStatuses.filter(saved => saved.file !== file.key);
  sharedState.uploadStatuses.push(entry);
  const manifest = {
    subjectID, session_id: SESSION_ID,
    files: sharedState.uploadStatuses.map(saved => ({ ...saved }))
  };
  window.__FAEUploadStatus = manifest;
  try {
    // Status only, never trial responses. Retain it across the Qualtrics redirect.
    window.localStorage?.setItem("FAE:last-upload-status", JSON.stringify(manifest));
  } catch (error) {
    console.warn("Upload status could not be retained in this browser.");
  }
  if (!data.success) console.warn("An experiment upload was not confirmed:", entry);
}

function hasUnconfirmedSaves(){
  return sharedState.uploadStatuses.some(saved => !["stored", "queued", "accepted"].includes(saved.save_state));
}

function shouldDownloadResults(){
  // A failed or unconfirmed DataPipe attempt must not enable file downloads.
  return DOWNLOAD_RESULTS_AT_END;
}

function shouldSaveToQualtrics(){
  if (!SAVE_TO_QUALTRICS) return false;
  if (DATA_SAVE_TARGET !== "drive") return true;
  // A queued/accepted upload is retained by DataPipe but is not yet a Drive
  // save confirmation. Missing results and failures also keep the fallback.
  return Object.keys(RESULT_FILENAMES).some(key => !sharedState.uploadStatuses.some(saved =>
    saved.file === key && saved.filename === `${RESULT_FOLDERS[key]}/${RESULT_FILENAMES[key]}`
      && saved.save_state === "stored" && !saved.error));
}

function completionPromptHtml(){
  if (shouldSaveToQualtrics()) {
    return '<div class="center" style="font-size:24px;line-height:1.35;"><p>The tasks are complete.</p><p>Press <b>SPACE</b> to save your task data and continue to the questionnaires.</p></div>';
  }
  const unconfirmed = hasUnconfirmedSaves();
  const action = shouldDownloadResults()
    ? (unconfirmed ? "download backup files" : "download your result files")
    : "finish";
  return `<div class="center" style="font-size:24px; line-height:1.35;">
    <p>Done.</p>
    ${unconfirmed ? `<p>Some responses could not be confirmed as saved online. ${shouldDownloadResults() ? "Please keep the backup files and let the researcher know." : "Please let the researcher know."}</p>` : ""}
    <p>Press <b>SPACE</b> to ${action}${REDIRECT_TO_QUALTRICS ? " and continue to the questionnaires" : ""}.</p>
  </div>`;
}

function buildPipeSaveTrials(jsPsych){
  const files = getPipeResultFiles(jsPsych);
  return files.map((file, index) => ({
      type: jsPsychPipe,
      action: "save",
      experiment_id: DATA_PIPE_EXPERIMENT_ID,
      filename: file.filename,
      data_string: () => file.text,
      post_trial_gap: index < files.length - 1 ? 1000 : 0,
      data: { task: "system", event: "pipe_save", file: file.key },
      on_finish: data => {
        recordPipeSave(file, data);
        if (index < files.length - 1) jsPsych.getDisplayElement().innerHTML =
          `<div class="center"><p>Saving your task data (${index + 1} of ${files.length}). Please keep this window open…</p></div>`;
      }
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
const sharedState = { mrtCursor: 0, mrtInitialized: false, mrtMainStarted: false, trialNum: 0, probeBlockCounter: 0, studyCompleted: false, uploadStatuses: [], scheduledBreaks: [] };

function finishStudy(){
  if (sharedState.studyCompleted) return;
  if (shouldSaveToQualtrics() && !REDIRECT_TEST_ONLY && getParam('redirectTest') !== '1') {
    return sendResultsToQualtrics();
  }
  sharedState.studyCompleted = true;
  const display = jsPsych.getDisplayElement();
  if (REDIRECT_TO_QUALTRICS) {
    const destination = getQualtricsReturnUrl();
    const href = destination.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    // The final keyboard trial clears its screen; keep a usable link after it ends.
    display.innerHTML = `<div class="center" style="font-size:24px; line-height:1.35;">
      <p>The tasks are complete. Continuing to the questionnaires…</p>
      <p>If you are not taken there automatically, <a href="${href}" style="color:inherit; text-decoration:underline;">continue to the questionnaires</a>.</p>
    </div>`;
    // Briefly display the completion message before returning to the questionnaires.
    window.setTimeout(() => window.location.replace(destination), 500);
  } else {
    display.innerHTML = '<p>The tasks are complete. Thank you.</p>';
  }
}

const jsPsych = initJsPsych({
  // jsPsych prepares the page at run time, so install the banner only after its
  // display exists. Keep it outside the trial container so it survives trials.
  on_trial_start: () => {
    if (RUN_MODE !== "test" || document.querySelector(".study-test-banner")) return;
    const banner = document.createElement("div");
    banner.className = "study-test-banner";
    banner.textContent = "SHORT TEST MODE · 6 image comparisons · 1 MRT interval";
    document.body.appendChild(banner);
  },
  on_finish: finishStudy
});

jsPsych.data.addProperties({ subject: subjectID });

// Make jsPsych available for MRT builder (it expects params.jsPsych)
window.__jsPsychInstance = jsPsych;

// Restoring a task page is not evidence that a save failed. Preserve the known
// completion state and never trigger another upload merely because of Back.
if (SAVE_TO_QUALTRICS) window.addEventListener('pageshow', event => {
  if (event.persisted && sharedState.qualtricsTransfer) {
    if (sharedState.qualtricsReceiptConfirmed) showQualtricsCompleted(sharedState.qualtricsReturnDestination);
    else showQualtricsWaiting();
  }
});

async function start(){
  if (REDIRECT_TEST_ONLY || getParam("redirectTest") === "1") {
    const destination = getQualtricsReturnUrl();
    const escapedDestination = destination.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    // Exercise the real completion callback without running tasks or saving result files.
    jsPsych.run([{
      type: jsPsychHtmlKeyboardResponse,
      stimulus: `<div class="center" style="font-size:24px; line-height:1.35;">
        <p><b>Redirect test mode</b></p>
        <p>Tasks, uploads, and file downloads are skipped.</p>
        <p>Return destination:</p>
        <p style="overflow-wrap:anywhere;">${escapedDestination}</p>
        <p>Press <b>SPACE</b> to return to Qualtrics.</p>
      </div>`,
      choices: [" "],
      data: {task:"system", event:"redirect_test"}
    }]);
    return;
  }

  // Recovery is explicit and sends one retained session at a time. It never
  // launches a batch of overlapping retries or silently replays an old session.
  if (SAVE_TO_QUALTRICS && getParam('resumeSave') === '1') {
    const pending = await listPendingQualtricsSessions(subjectID, qualtricsStorageEnvironment());
    const display = jsPsych.getDisplayElement();
    if (!pending.length) {
      display.innerHTML = '<div class="center"><p>No completed task data awaiting submission was found for this participant in this browser.</p><p>Please contact the researcher before restarting the tasks.</p></div>';
      return;
    }
    display.innerHTML = '<div class="center"><p>Your completed task data is ready to submit.</p><p>Please keep this window open.</p><button id="resume-qualtrics-save" type="button">Submit completed task data</button></div>';
    display.querySelector('#resume-qualtrics-save').addEventListener('click', () => {
      sharedState.qualtricsSaveTab = openQualtricsSaveTab(window);
      void sendResultsToQualtrics(pending[0]);
    }, { once: true });
    return;
  }

  // Init Meta-Emotion lists
  const metaState = await initMetaEmotion({
    subject: subjectID, calibrationLimit: META_CALIBRATION_COMPARISONS, jsPsych,
    imageScheduleSeed: IMAGE_SCHEDULE_SEED, shuffleFollowupStages: SHUFFLE_REVIEW_AND_META_JUDGMENTS
  });
  window.__metaState = metaState;

  if (metaState.calibrationTargetCount !== META_CALIBRATION_COMPARISONS) {
    throw new Error("The image list does not contain the scheduled comparison count.");
  }
  sharedState.mrtIntervalSchedule = createMrtIntervalSchedule(STUDY_CONFIG);

  const timeline = [];

  if (RUN_MODE === "full") {
    timeline.push(transitionScreen(`<h2>Study Tasks Overview</h2>
      <p>After practicing both tasks, you will complete <b>four sections</b>. Each section contains picture comparisons followed by metronome tapping.</p>
      <p>Progress messages will let you know when you are one-quarter, halfway, and three-quarters through these primary tasks.</p>
      <p>You may take a <b>2-minute break</b> after the first and third sections. There is a required <b>3-minute break halfway through</b> and a required <b>5-minute break after the fourth section</b>.</p>
      <p>After those sections, you will complete the final picture judgments and return to the questionnaires.</p>
      <p>Press <b>SPACE</b> to begin.</p>`, {event: "study_overview"}));
  }

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

  // One sustained MRT block follows each picture set. The short preset has one
  // six-comparison set and one MRT interval, with no new screens or timed breaks.
  for (const section of STUDY_CONFIG.sections) {
    if (section.number > 1) {
      timeline.push(transitionScreen(`<p><b>Image Comparison Task</b></p><p>You will now begin the next section with image comparisons, followed by metronome tapping.</p><p>Press <b>SPACE</b> when you are ready.</p>`, {event:"section_start", section: section.number, next:"calibration"}));
    }
    timeline.push(...buildMetaEmotionCalibrationChunk(metaState, section.comparisons, section.number));

    const firstMrtSet = !sharedState.mrtMainStarted;
    const mrtChunk = buildMRTChunk({
      jsPsych, subjectID, metronomeAudio, _state: sharedState,
      includeMidBreak: false, numBlocks: MRT_TOTAL_BLOCKS,
      blocksToTake: section.probes, sectionBreaks: RUN_MODE === "full"
    }).timeline;

    if (mrtChunk.length > 0) {
      // The first set already has its own audio-enable transition and countdown.
      if (!firstMrtSet) timeline.push(audioUnlockTrial(true));
      timeline.push(...mrtChunk);
    }
    if (section.break) {
      timeline.push(buildSectionBreak({ jsPsych, trialType: jsPsychHtmlKeyboardResponse, section: section.number,
        breakSpec: section.break, onRecord: record => sharedState.scheduledBreaks.push(record) }));
    }
  }

  // Review and meta-judgment always use their own lists, even in shortened calibration tests.
  timeline.push(...buildMetaEmotionReview(metaState, 20));
  timeline.push(...buildMetaEmotionMetaJ(metaState, 60));

  // Save each file in order. Normal Drive success returns in the same tab;
  // queued, failed or missing confirmations retain the Qualtrics fallback.
  if (ACTIVE_SAVE_TO_DATA_PIPE) {
    timeline.push(...buildPipeSaveTrials(jsPsych));
  }

  // End screen. SPACE supplies the user gesture needed to open the submission tab.
  timeline.push({
    type: jsPsychHtmlKeyboardResponse,
    stimulus: completionPromptHtml,
    choices: [" "],
    on_finish: () => {
      // Open synchronously within the final SPACE gesture, before hashing or
      // storage work consumes the browser's permission to open a new tab.
      if (shouldSaveToQualtrics()) sharedState.qualtricsSaveTab = openQualtricsSaveTab(window);
      if (shouldDownloadResults()) downloadAllResults(jsPsych);
    },
    // Preserve the legacy event name for diagnostic compatibility.
    data: {task:"system", event:"end_download"}
  });

  jsPsych.run(timeline);
}

start();
