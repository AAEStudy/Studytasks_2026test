import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import * as schedule from "../js/image-schedule.mjs";
import { splitStudyExports } from "../js/analysis-exports.mjs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));
const collection = rows => ({ values: () => rows,
  filter: criteria => collection(rows.filter(row => Object.entries(criteria).every(([key, value]) => row[key] === value))) });

function runtime({ download = false, blockedStorage = false } = {}) {
  const storage = new Map(), downloads = [], navigations = [], timers = [], warnings = [];
  let timeline, finish;
  const display = { innerHTML: "" };
  const setTimeout = (callback, delay) => { timers.push({ callback, delay }); return timers.length; };
  class BrowserURL extends URL {
    static createObjectURL() { return "blob:test-backup"; }
    static revokeObjectURL() {}
  }
  const window = {
    location: { search: "?subjectID=SID4187372347&id=", replace: url => navigations.push(url) },
    setTimeout, clearTimeout() {}, addEventListener() {}, removeEventListener() {},
    localStorage: { setItem(key, value) {
      if (blockedStorage) throw new Error("storage blocked");
      storage.set(key, value);
    } }
  };
  const document = { addEventListener() {}, removeEventListener() {}, body: { appendChild() {} },
    createElement: () => ({ href: "", download: "", remove() {}, click() { downloads.push(this.download); } }) };
  const psych = { data: { addProperties() {}, get: () => collection([]) },
    getDisplayElement: () => display, run: built => { timeline = built; } };
  const context = vm.createContext({ ...schedule, splitStudyExports, window, document, URL: BrowserURL, URLSearchParams,
    Blob, TextEncoder, crypto: webcrypto, performance: { now: () => 0 }, setTimeout, clearTimeout() {},
    console: { warn: (...args) => warnings.push(args) },
    fetch: async path => {
      assert.match(path, /^lists\/[\w_]+\.csv$/, "no external requests are permitted");
      return { ok: true, text: async () => read(path) };
    },
    Audio: class { play() { return Promise.resolve(); } pause() {} },
    initJsPsych: options => { finish = options.on_finish; return psych; },
    jsPsychHtmlKeyboardResponse: {}, jsPsychImageKeyboardResponse: {},
    jsPsychInstructions: {}, jsPsychPipe: {}, jsPsychPreload: {} });
  const meta = read("metaemotion.js").replace(/^import .*\n/gm, "").replace(/^export /gm, "");
  vm.runInContext(read("js/response-controls.js") + "\n" + read("mrt.js") + "\n" + meta, context);
  const main = read("main.js").replace(/^import .*\n/gm, "")
    .replace(/const DOWNLOAD_RESULTS_AT_END = (?:true|false);/, `const DOWNLOAD_RESULTS_AT_END = ${download};`)
    .replace(/start\(\);\s*$/, `globalThis.qa = { start, sharedState, buildPipeSaveTrials,
      recordPipeSave, hasUnconfirmedSaves, shouldDownloadResults, completionPromptHtml, finishStudy };`);
  vm.runInContext(main, context);
  return { context, qa: context.qa, psych, storage, downloads, navigations, timers, warnings,
    timeline: () => timeline, finish: () => finish(), display };
}

function save(trial, result, extra = {}) {
  const data = { ...trial.data, result, success: true, ...extra };
  trial.on_finish(data);
  return data;
}

test("building one binary save trial neither claims success nor starts transport or backups", () => {
  const run = runtime();
  const trials = run.qa.buildPipeSaveTrials(run.psych);
  assert.deepEqual(Array.from(trials, trial => trial.data.file), ["bundle"]);
  assert.equal(trials[0].action, "saveBase64");
  assert.deepEqual(Array.from(trials, trial => trial.post_trial_gap), [0]);
  assert.match(trials[0].filename, /^FAE_.*\.zip$/);
  assert.equal(run.qa.hasUnconfirmedSaves(), false, "future save trials are not recorded failures");
  assert.equal(run.qa.shouldDownloadResults(), false);
  assert.equal(run.qa.sharedState.uploadStatuses.length, 0);
  assert.equal(run.context.window.__FAEUploadStatus, undefined);
  assert.equal(run.storage.size, 0);
  assert.equal(run.downloads.length + run.navigations.length + run.timers.length, 0);
});

test("the pinned jsPsych engine records the bundle result before advancing, including queued and failed saves", () => {
  const source = read("js/external/jspsych.js");
  const start = source.indexOf("        finishTrial(data = {}) {");
  const end = source.indexOf("        endExperiment(", start);
  assert.ok(start >= 0 && end > start, "exercise the study's actual jsPsych completion method");
  for (const result of [
    { http_status: 201, save_state: "stored", error: null },
    { http_status: 202, save_state: "queued", error: null },
    { http_status: 403, save_state: "rejected", error: "Forbidden" }
  ]) {
    const run = runtime(), trials = run.qa.buildPipeSaveTrials(run.psych);
    let now = 0, nextCount = 0, pending;
    const finishTrial = vm.runInNewContext(`({${source.slice(start, end)}}).finishTrial`, {
      setTimeout(callback, delay) { assert.equal(pending, undefined); pending = { callback, due: now + delay }; }
    });
    for (let index = 0; index < trials.length; index++) {
      const trial = trials[index];
      const trialData = { ...trial.data, result };
      const engine = {
        current_trial_finished: false, current_trial: trial, global_trial_index: index,
        data: { write() {}, get: () => ({ filter: () => ({ values: () => [trialData] }) }) },
        internal: {}, opts: { on_trial_finish() {}, on_data_update() {}, default_iti: 0 },
        nextTrial: () => { nextCount++; }
      };
      finishTrial.call(engine, trialData);
      assert.equal(run.context.window.__FAEUploadStatus.files.length, index + 1,
        "the upload result is retained before waiting for the next attempt");
      if (index < trials.length - 1) {
        assert.equal(nextCount, index, "no subsequent attempt starts immediately");
        assert.equal(pending.due - now, 2000);
        assert.match(run.display.innerHTML, /Saving your responses/);
        now += 1999;
        assert.ok(now < pending.due);
        assert.equal(nextCount, index);
        now++;
        const timer = pending; pending = undefined; timer.callback();
      } else {
        assert.equal(pending, undefined, "no extra wait follows the final diagnostic upload");
      }
      assert.equal(nextCount, index + 1);
    }
    assert.equal(now, 0);
    assert.equal(run.navigations.length + run.downloads.length, 0,
      "upload completion and pacing cannot start downloads or redirect early");
    assert.equal(run.qa.hasUnconfirmedSaves(), result.save_state === "rejected");
  }
});

test("a bundle failure forces a visible backup warning", async () => {
  const run = runtime();
  await run.qa.start();
  const trials = run.timeline().filter(trial => trial.data?.event === "pipe_save");
  const failed = save(trials[0], { http_status: 502, save_state: "failed", error: "Storage provider unavailable", code: "provider_error" });
  assert.equal(failed.success, false, "the adapter's incoming success flag cannot hide failure");
  for (const trial of trials.slice(1)) assert.equal(save(trial, { http_status: 200, save_state: "stored" }).success, true);
  assert.equal(run.qa.hasUnconfirmedSaves(), true);
  assert.equal(run.qa.shouldDownloadResults(), true, "failure forces backups even when the configured download flag is false");
  const end = run.timeline().at(-1);
  const html = typeof end.stimulus === "function" ? end.stimulus() : end.stimulus;
  assert.match(html, /could not be confirmed as saved online/i);
  assert.match(html, /keep the backup files/i);
  assert.doesNotMatch(html, /all (?:files|responses|data).*saved successfully/i);
  end.on_finish({ response: " " });
  assert.equal(run.downloads.length, 5);
  assert.equal(new Set(run.downloads).size, 5);
  assert.equal(run.navigations.length, 0);
  run.finish();
  const redirect = run.timers.find(timer => timer.delay === 500);
  assert.ok(redirect);
  assert.equal(run.context.window.__FAEUploadStatus.files[0].save_state, "failed");
  assert.ok(run.storage.has("FAE:last-upload-status"), "the manifest exists before the return navigation");
  redirect.callback();
  assert.equal(run.navigations[0], "https://usf.az1.qualtrics.com/jfe/form/SV_8wijLZLkAmgskVE");
  assert.equal(run.context.window.__FAEUploadStatus.subjectID, "SID4187372347");
});

test("a failed bundle offers all five original backups before redirect without resubmitting", async () => {
  const run = runtime();
  await run.qa.start();
  const trials = run.timeline().filter(trial => trial.data?.event === "pipe_save");
  assert.equal(trials.length, 1);
  const diagnostics = trials[0];
  assert.equal(diagnostics.data.file, "bundle");
  assert.equal(save(diagnostics, { http_status: 503, save_state: "failed", error: "Provider unavailable" }).success, false);
  const manifest = plain(run.context.window.__FAEUploadStatus);
  assert.equal(manifest.files.length, 1);
  assert.equal(manifest.files.at(-1).file, "bundle");
  assert.equal(manifest.files.at(-1).save_state, "failed");
  assert.deepEqual(JSON.parse(run.storage.get("FAE:last-upload-status")), manifest);
  assert.equal(run.qa.hasUnconfirmedSaves(), true);
  assert.equal(run.qa.shouldDownloadResults(), true);
  assert.match(run.qa.completionPromptHtml(), /keep the backup files/i);
  assert.equal(run.downloads.length, 0);
  assert.equal(run.navigations.length, 0);
  assert.equal(run.timers.length, 0, "a failed upload does not add retry or early-redirect timers");
  run.timeline().at(-1).on_finish({ response: " " });
  assert.equal(run.downloads.length, 5);
  assert.equal(run.navigations.length, 0, "backups begin before the Qualtrics return");
  assert.equal(run.timeline().filter(trial => trial.data?.event === "pipe_save").length, 1, "failure adds no duplicate uploads");
  run.finish();
  const redirects = run.timers.filter(timer => timer.delay === 500);
  assert.equal(redirects.length, 1);
  redirects[0].callback();
  assert.deepEqual(run.navigations, ["https://usf.az1.qualtrics.com/jfe/form/SV_8wijLZLkAmgskVE"]);
  assert.deepEqual(plain(run.context.window.__FAEUploadStatus.files.slice(0, 4)), manifest.files.slice(0, 4),
    "the completion flow must leave confirmed analysis statuses intact");
});

test("the persisted bundle manifest preserves full SID and upload status without task or provider payloads", () => {
  const run = runtime();
  const trials = run.qa.buildPipeSaveTrials(run.psych);
  const privateData = "PRIVATE_TRIAL_DATA_123";
  for (const trial of trials) save(trial, {
    http_status: 200, save_state: "stored", response: { data: privateData }, data: privateData
  }, { data_string: privateData, response: privateData });
  const manifest = plain(run.context.window.__FAEUploadStatus);
  assert.equal(manifest.subjectID, "SID4187372347");
  assert.equal(typeof manifest.session_id, "string");
  assert.ok(manifest.session_id.length > 20);
  assert.deepEqual(manifest.files.map(file => file.file), ["bundle"]);
  for (let index = 0; index < trials.length; index++) {
    const file = manifest.files[index];
    assert.equal(file.filename, trials[index].filename);
    assert.match(file.filename, /SID4187372347/);
    assert.equal(file.http_status, 200);
    assert.equal(file.save_state, "stored");
    assert.deepEqual(Object.keys(file).sort(), ["error", "error_code", "file", "filename", "http_status", "save_state"]);
  }
  const persisted = run.storage.get("FAE:last-upload-status");
  assert.deepEqual(JSON.parse(persisted), manifest);
  assert.ok(!persisted.includes(privateData));
  assert.ok(!JSON.stringify(run.qa.sharedState.uploadStatuses).includes(privateData));
});

test("202 queued and accepted saves are confirmed once without warnings, forced backups or retry trials", async () => {
  const run = runtime();
  await run.qa.start();
  const trials = run.timeline().filter(trial => trial.data?.event === "pipe_save");
  for (let index = 0; index < trials.length; index++) {
    const state = index % 2 ? "accepted" : "queued";
    const data = save(trials[index], { http_status: 202, save_state: state });
    assert.equal(data.success, true);
    assert.equal(data.pipe_save_state, state);
    assert.equal(data.pipe_http_status, 202);
  }
  assert.equal(run.qa.hasUnconfirmedSaves(), false);
  assert.equal(run.qa.shouldDownloadResults(), false);
  assert.doesNotMatch(run.qa.completionPromptHtml(), /could not be confirmed|backup files/i);
  run.timeline().at(-1).on_finish({ response: " " });
  assert.equal(run.downloads.length, 0);
  assert.equal(run.warnings.length, 0);
  assert.equal(run.timeline().filter(trial => trial.data?.event === "pipe_save").length, 1);
  assert.equal(run.timers.length, 0);
});

test("unknown results and contradictory accepted-with-error results cannot retain a success flag", () => {
  for (const result of [{}, { http_status: 200 }, { save_state: "stored", error: "provider rejected" },
    { save_state: "accepted", error: "validation failed", code: "invalid_request" }]) {
    const run = runtime();
    const trial = run.qa.buildPipeSaveTrials(run.psych)[0];
    const data = save(trial, result);
    assert.equal(data.success, false, JSON.stringify(result));
    assert.equal(run.qa.hasUnconfirmedSaves(), true);
    assert.equal(run.qa.shouldDownloadResults(), true);
    const entry = run.context.window.__FAEUploadStatus.files[0];
    assert.equal(entry.save_state, "unconfirmed");
    assert.equal(entry.error_code, result.code || null);
    assert.ok(entry.error);
  }
});

test("a later result replaces the bundle status without duplicating it", () => {
  const run = runtime();
  const trials = run.qa.buildPipeSaveTrials(run.psych);
  save(trials[0], { save_state: "failed", error: "offline" });
  save(trials[0], { http_status: 200, save_state: "stored" });
  const files = run.context.window.__FAEUploadStatus.files;
  assert.equal(files.length, 1);
  assert.equal(files[0].file, "bundle");
  assert.equal(files[0].error, null);
  assert.equal(run.qa.hasUnconfirmedSaves(), false);
});

test("blocked browser storage cannot prevent status handling, backups or the Qualtrics return", async () => {
  const run = runtime({ blockedStorage: true });
  await run.qa.start();
  const trial = run.qa.buildPipeSaveTrials(run.psych)[0];
  assert.doesNotThrow(() => save(trial, { http_status: 0, save_state: "failed", error: "offline" }));
  assert.equal(run.context.window.__FAEUploadStatus.files.length, 1);
  assert.equal(run.qa.hasUnconfirmedSaves(), true);
  assert.equal(run.storage.size, 0);
  assert.doesNotThrow(() => run.timeline().at(-1).on_finish({ response: " " }));
  assert.equal(run.downloads.length, 5);
  assert.doesNotThrow(() => run.finish());
  run.timers.find(timer => timer.delay === 500).callback();
  assert.equal(run.navigations.length, 1);
});

test("configured backups remain enabled even when every recorded upload is stored", () => {
  const run = runtime({ download: true });
  for (const trial of run.qa.buildPipeSaveTrials(run.psych)) save(trial, { http_status: 200, save_state: "stored" });
  assert.equal(run.qa.hasUnconfirmedSaves(), false);
  assert.equal(run.qa.shouldDownloadResults(), true);
  assert.match(run.qa.completionPromptHtml(), /download your result files/i);
  assert.doesNotMatch(run.qa.completionPromptHtml(), /could not be confirmed/i);
});
