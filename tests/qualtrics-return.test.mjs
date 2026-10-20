import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import * as schedule from "../js/image-schedule.mjs";
import { splitStudyExports } from "../js/analysis-exports.mjs";
import { createSessionZip, zipToBase64 } from "../js/session-bundle.mjs";
import { createQualtricsCodec } from "../js/qualtrics-bundle.mjs";
import { resolveStudyConfig, createMrtIntervalSchedule } from "../js/study-schedule.mjs";
import { buildSectionBreak } from "../js/study-breaks.mjs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const defaultReturn = "https://usf.az1.qualtrics.com/jfe/form/SV_8wijLZLkAmgskVE";
const testNonce = 'a'.repeat(48);

function stagedPacket(input) {
  const callback = new URL(input.receiptBase);
  callback.searchParams.set('session', input.fields.fae_session_id);
  callback.searchParams.set('nonce', testNonce);
  callback.searchParams.set('tab', '1');
  return { fields: { ...input.fields, fae_return_url: callback.href }, returnUrl: input.returnUrl,
    backupRetained: true, returnMode: 'receipt' };
}

async function flush() { await new Promise(resolve => setImmediate(resolve)); }
async function until(predicate) {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'the handoff did not reach its expected state');
    await new Promise(resolve => setTimeout(resolve, 2));
  }
}

function collection(rows = []) {
  return { values: () => rows,
    filter: criteria => collection(rows.filter(row => Object.entries(criteria).every(([key, value]) => row[key] === value))) };
}

function runtime(parameters = { subjectID: "ID0007" }, { redirectTestOnly = false, transport = {}, useDefaultSaveTargets = false, popupBlockedAttempts = 0 } = {}) {
  // Existing direct-return checks isolate DataPipe. Dual-save checks opt into
  // the actual production defaults, without adding a saveTo URL override.
  parameters = { ...parameters };
  if (!useDefaultSaveTargets && parameters.saveTo === undefined) parameters.saveTo = "datapipe";
  let now = 0, timerId = 0, initOptions, timeline;
  const timers = new Map(), listeners = new Map(), navigations = [], downloads = [], events = [], warnings = [];
  const fetches = [], builderCalls = [], audioPlays = [];
  const tabs = [], waiters = [], posts = [], completions = [];
  let dataReads = 0;
  const setTimeout = (callback, delay) => {
    const id = ++timerId;
    timers.set(id, { callback, at: now + delay });
    return id;
  };
  const advance = elapsed => {
    const until = now + elapsed;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= until)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      const [id, timer] = next;
      timers.delete(id);
      now = timer.at;
      timer.callback();
    }
    now = until;
  };
  const display = {
    _html: "",
    get innerHTML() { return this._html; },
    set innerHTML(value) { this._html = value; events.push({ type: "display", at: now }); },
    querySelector(selector) { return { addEventListener(type, callback, options) {
      let used = false;
      buttons.set(selector, (...args) => {
        if (options?.once && used) return;
        used = true;
        return callback(...args);
      });
    } }; }
  };
  const buttons = new Map();
  class BrowserURL extends URL {
    static createObjectURL() { return `blob:qa-${downloads.length + 1}`; }
    static revokeObjectURL() {}
  }
  const document = {
    addEventListener() {}, removeEventListener() {},
    body: { appendChild() {} },
    createElement(tag) {
      assert.equal(tag, "a");
      return { href: "", download: "", remove() {}, click() {
        downloads.push({ filename: this.download, at: now });
        events.push({ type: "download", at: now });
      } };
    }
  };
  const location = {
    search: `?${new URLSearchParams(parameters)}`,
    replace(url) { navigations.push({ url, at: now }); events.push({ type: "navigation", at: now }); }
  };
  location.origin = 'https://aaestudy.github.io';
  Object.defineProperty(location, "href", { get() { return location.origin + '/Studytasks_2026test/' + location.search; }, set() { assert.fail("completion must use location.replace"); } });
  const window = {
    location, setTimeout, clearTimeout: id => timers.delete(id),
    focus() { events.push({ type: 'parent-focus', at: now }); },
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); }
  };
  const psych = { data: { addProperties() {}, get: () => { dataReads++; return collection(); } },
    getDisplayElement: () => display, run: built => { timeline = built; } };
  const handoff = {
    openQualtricsSaveTab(suppliedWindow) {
      assert.equal(suppliedWindow, window);
      const blocked = tabs.length < popupBlockedAttempts;
      const tab = { targetName: 'fae_save_test_' + (tabs.length + 1), blocked, closeCount: 0,
        windowRef: blocked ? null : { focus() { events.push({ type: 'child-focus', at: now }); } },
        close() { this.closeCount++; events.push({ type: 'child-close', at: now }); } };
      tabs.push(tab); events.push({ type: 'open', blocked, at: now });
      return tab;
    },
    async stageQualtricsSession(input, environment) {
      events.push({ type: 'stage', at: now });
      return transport.stageQualtricsSession ? transport.stageQualtricsSession(input, environment) : stagedPacket(input);
    },
    waitForQualtricsTabReceipt({ fields, tab }) {
      assert.ok(!tab.blocked);
      const callback = new URL(fields.fae_return_url);
      assert.equal(callback.origin, location.origin);
      assert.equal(callback.searchParams.get('session'), fields.fae_session_id);
      assert.match(callback.searchParams.get('nonce'), /^[a-f0-9]{48}$/);
      assert.equal(callback.searchParams.get('tab'), '1');
      let resolveReceipt, rejectReceipt, resolved = false;
      const waiter = { fields, tab, acknowledged: false, disposed: false,
        promise: new Promise((resolve, reject) => { resolveReceipt = resolve; rejectReceipt = reject; }),
        receive(receipt) {
          if (resolved || this.disposed || receipt.sessionId !== fields.fae_session_id || receipt.nonce !== callback.searchParams.get('nonce')) return;
          resolved = true;
          events.push({ type: 'receipt', at: now });
          resolveReceipt(receipt);
        },
        acknowledge() {
          assert.ok(resolved, 'only an authenticated receipt may be acknowledged');
          if (this.acknowledged) return false;
          this.acknowledged = true;
          events.push({ type: 'ack', at: now }); tab.close(); window.focus();
          return true;
        },
        dispose() { this.disposed = true; if (!resolved) rejectReceipt(new Error('Cancelled')); }
      };
      waiters.push(waiter); events.push({ type: 'listen', at: now });
      return waiter;
    },
    async postQualtricsBundle(fields, receiver, documentObject, options) {
      assert.equal(documentObject, document);
      assert.equal(options.target, tabs.at(-1).targetName);
      assert.equal(waiters.at(-1).tab, tabs.at(-1), 'register the child receipt listener before submitting');
      posts.push({ fields, receiver, options }); events.push({ type: 'post', at: now });
      if (transport.postQualtricsBundle) return transport.postQualtricsBundle(fields, receiver, documentObject, options);
    },
    async completeQualtricsReturn(receipt, environment) {
      completions.push(receipt); events.push({ type: 'complete-backup', at: now });
      return transport.completeQualtricsReturn ? transport.completeQualtricsReturn(receipt, environment)
        : context.qa.sharedState.qualtricsTransfer.returnUrl;
    },
    listPendingQualtricsSessions: transport.listPendingQualtricsSessions || (async () => [])
  };
  const context = vm.createContext({ ...schedule, resolveStudyConfig, createMrtIntervalSchedule, buildSectionBreak, splitStudyExports, createSessionZip, zipToBase64,
    createQualtricsCodec: () => {
      const codec = createQualtricsCodec(), build = codec.build;
      codec.build = (...args) => { events.push({ type: 'hash', at: now }); return build(...args); };
      return codec;
    },
    ...handoff, document, window, URL: BrowserURL, URLSearchParams,
    Blob, TextEncoder, crypto: webcrypto, performance: { now: () => now },
    setTimeout, clearTimeout: id => timers.delete(id),
    console: { warn: message => warnings.push(message) },
    fetch: async path => {
      fetches.push(path);
      assert.match(path, /^lists\/[\w_]+\.csv$/, "the test harness permits only local CSV reads");
      return { ok: true, text: async () => read(path) };
    },
    Audio: class { play() { audioPlays.push(now); return Promise.resolve(); } pause() {} },
    initJsPsych: options => { initOptions = options; return psych; },
    jsPsychHtmlKeyboardResponse: {}, jsPsychImageKeyboardResponse: {},
    jsPsychInstructions: {}, jsPsychPipe: {}, jsPsychPreload: {} });
  const meta = read("metaemotion.js").replace(/^import .*\n/gm, "").replace(/^export /gm, "");
  vm.runInContext(read("js/response-controls.js") + "\n" + read("mrt.js") + "\n" + meta, context);
  for (const name of ["initMetaEmotion", "buildMRTPractice", "buildMRTChunk", "buildMetaEmotionPractice",
    "buildMetaEmotionCalibrationChunk", "buildMetaEmotionReview", "buildMetaEmotionMetaJ", "exportMetaEmotion"]) {
    const original = context[name];
    assert.equal(typeof original, "function", `the harness must track ${name}`);
    context[name] = (...args) => { builderCalls.push(name); return original(...args); };
  }
  let main = read("main.js").replace(/^import .*\n/gm, "").replace(/start\(\);\s*$/, `
    globalThis.qa = { buildQualtricsReturnUrl, getQualtricsReturnUrl, finishStudy,
      sharedState, start, buildPipeSaveTrials, getResultFiles, REDIRECT_TO_QUALTRICS,
      DEFAULT_QUALTRICS_RETURN_URL, getSessionBundleBytes, DATA_SAVE_TARGET,
      ACTIVE_SAVE_TO_DATA_PIPE, SAVE_TO_QUALTRICS };
  `);
  if (redirectTestOnly) {
    assert.match(main, /^let REDIRECT_TEST_ONLY = false;/m, "the local override must exercise the real mode switch");
    main = main.replace(/^let REDIRECT_TEST_ONLY = false;/m, "let REDIRECT_TEST_ONLY = true;");
  }
  vm.runInContext(main, context);
  return { context, qa: context.qa, psych, display, buttons, navigations, downloads, events, warnings, advance,
    tabs, waiters, posts, completions,
    receiveReceipt(overrides = {}, index = waiters.length - 1) {
      const waiter = waiters[index];
      const callback = new URL(waiter.fields.fae_return_url);
      waiter.receive({ sessionId: callback.searchParams.get('session'), nonce: callback.searchParams.get('nonce'), ...overrides });
    },
    dispatch(type, event) { for (const listener of listeners.get(type) || []) listener(event); },
    fetches, builderCalls, audioPlays, dataReads: () => dataReads,
    onFinish: () => initOptions.on_finish(), timeline: () => timeline,
    guardCount: () => listeners.get("beforeunload")?.size || 0,
    beforeUnload() {
      const event = { calls: 0, preventDefault() { this.calls++; } };
      for (const callback of [...(listeners.get("beforeunload") || [])]) callback(event);
      return event;
    }
  };
}

test("Qualtrics return IDs follow launch ID, existing return ID, then exact ID-prefix fallback", () => {
  const run = runtime();
  const cases = [
    { subject: "ID0007", supplied: " launch-id ", existing: "return-id", expected: "launch-id" },
    { subject: "ID0007", supplied: "  ", existing: " return-id ", expected: "return-id" },
    { subject: "ID0007", supplied: null, existing: "  ", expected: "0007" },
    { subject: "ID0000", supplied: undefined, existing: undefined, expected: "0000" },
    { subject: "ID19", supplied: 0, existing: "old", expected: "0" },
    { subject: "SID19", supplied: undefined, existing: "", expected: null },
    { subject: "UID19", supplied: undefined, existing: undefined, expected: null },
    { subject: "prefixID19", supplied: undefined, existing: undefined, expected: null },
    { subject: "ID19suffix", supplied: undefined, existing: undefined, expected: null },
    { subject: "id19", supplied: undefined, existing: "  ", expected: null },
    { subject: "SID19", supplied: "explicit", existing: undefined, expected: "explicit" },
    { subject: "UID19", supplied: "", existing: "kept", expected: "kept" }
  ];
  for (const { subject, supplied, existing, expected } of cases) {
    const base = new URL(defaultReturn);
    if (existing !== undefined) base.searchParams.set("id", existing);
    const result = new URL(run.qa.buildQualtricsReturnUrl(base.href, subject, supplied));
    assert.equal(result.searchParams.get("subjectID"), null);
    assert.equal(result.searchParams.get("id"), expected, JSON.stringify({ subject, supplied, existing }));
    assert.equal(result.searchParams.has("id"), expected !== null, "empty IDs must be removed");
  }
  assert.equal(run.navigations.length, 0);
  assert.equal(run.qa.sharedState.studyCompleted, false);
});

test('both storage destinations are enabled by default and isolated test URLs disable only the other destination', async () => {
  for (const [saveTo, expectedTarget, expectedPipe, expectedQualtrics] of [
    [undefined, 'both', true, true],
    ['', 'both', true, true],
    ['unrecognized', 'both', true, true],
    ['both', 'both', true, true],
    ['datapipe', 'datapipe', true, false],
    ['qualtrics', 'qualtrics', false, true]
  ]) {
    const parameters = { subjectID: 'ID0007' };
    if (saveTo !== undefined) parameters.saveTo = saveTo;
    const run = runtime(parameters, { useDefaultSaveTargets: true });
    assert.equal(run.qa.DATA_SAVE_TARGET, expectedTarget);
    assert.equal(run.qa.ACTIVE_SAVE_TO_DATA_PIPE, expectedPipe);
    assert.equal(run.qa.SAVE_TO_QUALTRICS, expectedQualtrics);
    await run.qa.start();
    const events = Array.from(run.timeline(), trial => trial.data?.event);
    assert.equal(events.filter(event => event === 'pipe_save').length, expectedPipe ? 1 : 0);
    assert.equal(events.at(-1), 'end_download');
    if (expectedPipe) assert.equal(events.at(-2), 'pipe_save');
    assert.equal(run.qa.sharedState.qualtricsTransfer, undefined, 'Qualtrics never starts while tasks or DataPipe are running');
  }
});

test('the default flow attempts DataPipe first then sends the identical frozen ZIP to Qualtrics for stored, queued and failed outcomes', async () => {
  for (const mode of ['full', 'test']) for (const result of [
    { http_status: 201, save_state: 'stored', error: null },
    { http_status: 202, save_state: 'queued', error: null },
    { http_status: 403, save_state: 'rejected', error: 'Provider rejected upload' },
    { http_status: null, save_state: 'unconfirmed', error: 'DataPipe timed out' }
  ]) {
    const calls = [];
    let submitted;
    const run = runtime({ subjectID: 'ID0007', id: '0042', mode }, { useDefaultSaveTargets: true, transport: {
      stageQualtricsSession: async input => {
        calls.push('qualtrics-stage');
        assert.equal(input.returnUrl, defaultReturn + '?id=0042');
        assert.equal(input.returnViaOpener, true);
        return { ...stagedPacket(input), backupRetained: false };
      },
      postQualtricsBundle: async fields => { calls.push('qualtrics-post'); submitted = fields; }
    } });
    await run.qa.start();
    const timeline = run.timeline();
    const pipe = timeline.at(-2);
    assert.equal(pipe.data.event, 'pipe_save');
    const encoded = pipe.data_string();
    calls.push('datapipe-attempt');
    assert.deepEqual(calls, ['datapipe-attempt']);
    assert.equal(submitted, undefined);
    pipe.on_finish({ ...pipe.data, result });
    calls.push('datapipe-finished');
    assert.equal(run.qa.sharedState.uploadStatuses[0].save_state, result.save_state);
    if (result.save_state === 'queued') {
      assert.equal(run.context.window.__FAEUploadStatus.files[0].save_state, 'queued', 'queue acceptance cannot become a confirmed Dataverse save');
    }
    // Any attempt to rebuild the completed export or ZIP would now fail. Both
    // destinations must retain the snapshot made before the DataPipe response.
    run.context.createSessionZip = () => assert.fail('The completed ZIP must be reused');
    run.context.exportMetaEmotion = () => assert.fail('The completed exports must be reused');
    timeline.at(-1).on_finish({ response: ' ' });
    assert.equal(run.downloads.length, 0, 'no upload outcome can enable participant downloads');
    assert.doesNotMatch(timeline.at(-1).stimulus(), /download|backup files/i);
    assert.equal(run.tabs.length, 1, 'the save tab opens synchronously in the final gesture');
    assert.equal(run.events.some(event => event.type === 'download'), false);
    await run.onFinish();
    assert.deepEqual(calls, ['datapipe-attempt', 'datapipe-finished', 'qualtrics-stage', 'qualtrics-post']);
    assert.equal(submitted.fae_filename, pipe.filename);
    assert.equal(submitted.fae_subject_id, 'ID0007');
    const bytes = await createQualtricsCodec().verify(submitted);
    assert.deepEqual(Buffer.from(bytes), Buffer.from(encoded, 'base64'));
    assert.equal(zipToBase64(run.qa.getSessionBundleBytes(run.psych)), encoded);
    await run.onFinish();
    run.advance(10000);
    assert.equal(calls.filter(call => call === 'datapipe-attempt').length, 1);
    assert.equal(calls.filter(call => call === 'qualtrics-post').length, 1);
    assert.deepEqual(run.navigations, [], 'the original tab waits for the post-submit receipt');
    assert.equal(run.qa.sharedState.studyCompleted, false);
    run.receiveReceipt();
    await until(() => run.qa.sharedState.qualtricsReceiptConfirmed && run.completions.length === 1);
    await flush();
    assert.equal(run.tabs[0].closeCount, 1);
    assert.equal(run.waiters[0].acknowledged, true);
    run.advance(149); assert.deepEqual(run.navigations, []);
    run.advance(1);
    assert.equal(run.navigations[0].url, defaultReturn + '?id=0042');
    assert.equal(run.downloads.length, 0);
  }
});

test('a failed Qualtrics handoff retries its retained fields without replaying the completed DataPipe attempt', async () => {
  let pipeAttempts = 0, posts = 0, stages = 0, retained;
  const run = runtime({ subjectID: 'ID0007' }, { useDefaultSaveTargets: true, transport: {
    stageQualtricsSession: async input => {
      stages++;
      return { ...stagedPacket(input), backupRetained: false };
    },
    postQualtricsBundle: async fields => {
      posts++;
      if (posts === 1) { retained = fields; throw new Error('Transfer could not start'); }
      assert.equal(fields, retained);
    }
  } });
  await run.qa.start();
  const pipe = run.timeline().at(-2);
  const encoded = pipe.data_string(); pipeAttempts++;
  pipe.on_finish({ ...pipe.data, result: { http_status: 202, save_state: 'queued', error: null } });
  run.context.buildPipeSaveTrials = () => assert.fail('Qualtrics retries must not construct another DataPipe attempt');
  run.psych.run = () => assert.fail('Qualtrics retries must not replay the study or its DataPipe timeline');
  run.timeline().at(-1).on_finish({ response: ' ' });
  await run.onFinish();
  assert.equal(posts, 1); assert.equal(stages, 1);
  assert.match(run.display.innerHTML, /final task data submission could not be confirmed/);
  run.buttons.get('#retry-qualtrics-save')();
  run.buttons.get('#retry-qualtrics-save')();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(posts, 2, 'the in-flight guard prevents overlapping retry submissions');
  assert.equal(stages, 1, 'retry does not rebuild or restage the frozen payload');
  assert.equal(run.tabs.length, 2, 'the explicit retry opens exactly one fresh save tab');
  assert.equal(run.posts[0].options.target, run.tabs[0].targetName);
  assert.equal(run.posts[1].options.target, run.tabs[1].targetName);
  assert.equal(pipeAttempts, 1);
  assert.equal(pipe.data_string(), encoded);
  assert.equal(run.qa.sharedState.uploadStatuses.length, 1);
  assert.equal(run.qa.sharedState.uploadStatuses[0].save_state, 'queued');
});

test('redirect-only mode bypasses both default destinations, their exports and backup recovery', async () => {
  const run = runtime({ subjectID: 'ID0007', redirectTest: '1', resumeSave: '1' }, { useDefaultSaveTargets: true });
  await run.qa.start(); await run.onFinish(); run.advance(500);
  assert.equal(run.qa.ACTIVE_SAVE_TO_DATA_PIPE, true);
  assert.equal(run.qa.SAVE_TO_QUALTRICS, true);
  assert.equal(run.timeline().length, 1);
  assert.equal(run.timeline()[0].data.event, 'redirect_test');
  assert.deepEqual(run.builderCalls, []);
  assert.equal(run.dataReads(), 0);
  assert.equal(run.navigations[0].url, defaultReturn + '?id=0007');
});

test('Qualtrics task handoff stages the exact five-file bundle before POST and never starts DataPipe or an early return', async () => {
  const calls = [];
  let releaseStage, submitted;
  const staged = new Promise(resolve => { releaseStage = resolve; });
  const run = runtime({ subjectID: 'ID0007', id: '0042', saveTo: 'qualtrics' }, { transport: {
    stageQualtricsSession: async input => {
      calls.push('stage');
      assert.equal(input.returnUrl, defaultReturn + '?id=0042');
      assert.equal(input.receiptBase, 'https://aaestudy.github.io/Studytasks_2026test/qualtrics/saved.html');
      await staged;
      return stagedPacket(input);
    },
    postQualtricsBundle: async (fields, receiver) => {
      calls.push('post'); submitted = fields;
      assert.equal(receiver, 'https://usf.az1.qualtrics.com/jfe/form/SV_b7rI1T6DVd3u0dw');
      assert.deepEqual(await createQualtricsCodec().verify(fields), run.qa.getSessionBundleBytes(run.psych));
    }
  } });
  await run.qa.start();
  assert.equal(run.timeline().filter(trial => trial.data?.event === 'pipe_save').length, 0);
  assert.match(run.timeline().at(-1).stimulus(), /save your task data/);
  run.timeline().at(-1).on_finish({ response: ' ' });
  assert.equal(run.tabs.length, 1);
  assert.deepEqual(calls, [], 'opening the tab does not hash, stage or submit data');
  assert.equal(run.downloads.length, 0);
  const finish = run.onFinish();
  while (!calls.length) await new Promise(resolve => setImmediate(resolve));
  assert.equal(run.qa.sharedState.studyCompleted, false, 'leave-page guards must remain active until staging completes');
  assert.ok(run.beforeUnload().calls > 0);
  await run.onFinish();
  assert.deepEqual(calls, ['stage'], 'repeated completion cannot stage overlapping submissions');
  releaseStage(); await finish;
  assert.deepEqual(calls, ['stage','post']);
  assert.equal(submitted.fae_subject_id, 'ID0007');
  assert.equal(submitted.fae_run_mode, 'full');
  assert.equal(run.qa.sharedState.studyCompleted, false, 'submission start is not a post-submit receipt');
  assert.ok(run.beforeUnload().calls > 0);
  assert.equal(run.posts[0].options.target, run.tabs[0].targetName);
  assert.ok(run.events.findIndex(event => event.type === 'open') < run.events.findIndex(event => event.type === 'hash'));
  assert.ok(run.events.findIndex(event => event.type === 'listen') < run.events.findIndex(event => event.type === 'post'));
  run.advance(10000);
  assert.deepEqual(run.navigations, []);
  run.dispatch('pageshow', { persisted: true });
  assert.match(run.display.innerHTML, /Waiting for the submission window/);
  assert.doesNotMatch(run.display.innerHTML, /could not be confirmed|Try saving again/);
  assert.deepEqual(calls, ['stage','post'], 'Back restoration must not resend automatically');
  run.receiveReceipt({ nonce: 'b'.repeat(48) }); await flush();
  assert.equal(run.qa.sharedState.studyCompleted, false);
  assert.equal(run.waiters[0].acknowledged, false);
  run.receiveReceipt();
  await until(() => run.completions.length === 1);
  await flush();
  assert.equal(run.qa.sharedState.studyCompleted, true);
  assert.equal(run.beforeUnload().calls, 0);
  assert.equal(run.waiters[0].acknowledged, true);
  assert.equal(run.tabs[0].closeCount, 1);
  run.advance(149); assert.deepEqual(run.navigations, []);
  run.advance(1);
  assert.equal(run.navigations[0].url, defaultReturn + '?id=0042');
  run.dispatch('pageshow', { persisted: true });
  assert.match(run.display.innerHTML, /Your task data was submitted/);
  assert.doesNotMatch(run.display.innerHTML, /could not be confirmed|Try saving again/);
  assert.deepEqual(calls, ['stage','post']);
});

test('blocked storage access still reaches primary Qualtrics transport; construction errors offer one explicit retry', async () => {
  let posts = 0, stages = 0, previous;
  const run = runtime({ subjectID: 'ID0007', saveTo: 'qualtrics' }, { transport: {
    stageQualtricsSession: async (input, environment) => {
      stages++;
      assert.equal(environment.indexedDB, undefined);
      assert.equal(environment.sessionStorage, undefined);
      return { ...stagedPacket(input), backupRetained: false };
    },
    postQualtricsBundle: async fields => {
      posts++;
      if (posts === 1) { previous = fields; throw new Error('Construction failed'); }
      assert.equal(fields, previous);
    }
  } });
  for (const key of ['indexedDB','sessionStorage']) Object.defineProperty(run.context.window, key, { get() { throw new Error('SecurityError'); } });
  await run.qa.start(); run.timeline().at(-1).on_finish({ response: ' ' }); await run.onFinish();
  assert.equal(posts, 1); assert.equal(stages, 1);
  assert.equal(run.qa.sharedState.studyCompleted, false);
  assert.match(run.display.innerHTML, /could not be confirmed/);
  run.buttons.get('#retry-qualtrics-save')();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(posts, 2); assert.equal(stages, 1);
});

test('popup denial waits for one explicit new-tab gesture and the original tab preserves its full custom return after the receipt', async () => {
  const custom = 'https://usf.az1.qualtrics.com/jfe/form/SV_custom?Q_CHL=qr&token=a%2Bb%26c#resume';
  const expected = new URL(custom); expected.searchParams.set('id', 'credit +&=007');
  const run = runtime({ subjectID: 'ID0007', id: 'credit +&=007', saveTo: 'qualtrics', return: custom }, {
    popupBlockedAttempts: 1,
    transport: { completeQualtricsReturn: async () => { throw new Error('Browser storage is unavailable'); } }
  });
  await run.qa.start();
  run.timeline().at(-1).on_finish({ response: ' ' });
  assert.equal(run.tabs.length, 1);
  assert.equal(run.tabs[0].blocked, true);
  assert.equal(run.downloads.length, 0);
  await run.onFinish();
  assert.match(run.display.innerHTML, /Open submission window/);
  assert.equal(run.posts.length, 0);
  assert.equal(run.events.some(event => event.type === 'hash' || event.type === 'stage'), false,
    'a blocked window must not start asynchronous preparation or a save in the original tab');
  run.buttons.get('#open-qualtrics-save')();
  assert.equal(run.tabs.length, 2, 'the explicit button opens synchronously before asynchronous saving');
  run.buttons.get('#open-qualtrics-save')();
  assert.equal(run.tabs.length, 2, 'one gesture cannot open duplicate submission windows');
  await until(() => run.posts.length === 1);
  assert.equal(run.posts[0].options.target, run.tabs[1].targetName);
  assert.equal(run.navigations.length, 0);
  assert.equal(run.qa.sharedState.studyCompleted, false);
  run.receiveReceipt({ sessionId: 'wrong-session' }); await flush();
  assert.equal(run.waiters[0].acknowledged, false);
  run.receiveReceipt();
  await until(() => run.completions.length === 1); await flush();
  assert.equal(run.waiters[0].acknowledged, true);
  assert.equal(run.tabs[1].closeCount, 1);
  assert.match(run.display.innerHTML, /Your task data was submitted/);
  run.advance(149); assert.equal(run.navigations.length, 0);
  run.advance(1);
  assert.equal(run.navigations[0].url, expected.href,
    'an authenticated receipt permits the trusted in-memory return even when cleanup storage is blocked');
  assert.equal(run.posts.length, 1);
});

test('explicit recovery submits one retained session without rebuilding tasks or overwriting its stored return', async () => {
  const fields = { fae_session_id: 'original-session', fae_subject_id: 'ID0007', fae_zip_0001: 'ORIGINAL-ZIP',
    fae_return_url: 'https://aaestudy.github.io/Studytasks_2026test/qualtrics/saved.html?session=original-session&nonce=' + testNonce };
  const returnUrl = defaultReturn + '?id=original-credit#original-resume';
  const sent = [];
  const run = runtime({ subjectID: 'ID0007', saveTo: 'qualtrics', resumeSave: '1' }, { transport: {
    listPendingQualtricsSessions: async subject => { assert.equal(subject, 'ID0007'); return [{ fields, returnUrl }, { fields: { ...fields, fae_session_id: 'second' }, returnUrl }]; },
    postQualtricsBundle: async value => { sent.push(value); }
  } });
  await run.qa.start();
  assert.deepEqual(run.builderCalls, []); assert.deepEqual(run.fetches, []);
  assert.equal(sent.length, 0);
  run.buttons.get('#resume-qualtrics-save')();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].fae_zip_0001, fields.fae_zip_0001);
  assert.equal(sent[0].fae_session_id, fields.fae_session_id);
  assert.equal(new URL(sent[0].fae_return_url).searchParams.get('tab'), '1');
  assert.equal(run.qa.sharedState.resultExports, undefined);
  run.receiveReceipt(); await until(() => run.completions.length === 1); await flush(); run.advance(150);
  assert.equal(run.navigations[0].url, returnUrl);
  const missing = runtime({ subjectID: 'ID0007', saveTo: 'qualtrics', resumeSave: '1' }, { transport: { listPendingQualtricsSessions: async () => [] } });
  await missing.qa.start();
  assert.match(missing.display.innerHTML, /No completed task data/);
  assert.equal(missing.timeline(), undefined);
});

test('redirect-only mode skips Qualtrics transport and backup recovery even when both options are requested', async () => {
  const run = runtime({ subjectID: 'ID0007', saveTo: 'qualtrics', redirectTest: '1', resumeSave: '1' });
  await run.qa.start(); await run.onFinish(); run.advance(500);
  assert.equal(run.navigations[0].url, defaultReturn + '?id=0007');
  assert.deepEqual(run.builderCalls, []);
  assert.equal(run.dataReads(), 0);
});

test("return URL construction preserves explicit query/hash and safely encodes a supplied credit ID", () => {
  const run = runtime();
  const subject = 'SID <&" / 測試 + 007', participant = 'launch +&=/?#% "';
  const base = "https://USF.AZ1.QUALTRICS.COM/jfe/form/SV_custom?Q_CHL=qr&token=a%2Bb%26c&subjectID=old&id=old#section-2";
  const result = new URL(run.qa.buildQualtricsReturnUrl(base, subject, `  ${participant}  `));
  assert.equal(result.protocol, "https:");
  assert.equal(result.hostname, "usf.az1.qualtrics.com");
  assert.equal(result.pathname, "/jfe/form/SV_custom");
  assert.equal(result.searchParams.get("Q_CHL"), "qr");
  assert.equal(result.searchParams.get("token"), "a+b&c");
  assert.equal(result.searchParams.get("subjectID"), "old");
  assert.equal(result.searchParams.getAll("subjectID").length, 1);
  assert.equal(result.searchParams.get("id"), participant);
  assert.equal(result.hash, "#section-2");
});

test("invalid return destinations throw and invalid custom launches fall back to the configured survey", () => {
  const run = runtime();
  for (const url of ["not a URL", "http://usf.az1.qualtrics.com/form", "javascript:alert(1)",
    "//usf.az1.qualtrics.com/form", "https://qualtrics.com/form", "https://evilqualtrics.com/form",
    "https://usf.az1.qualtrics.com.evil.example/form", "https://usf.az1.qualtrics.com@evil.example/form",
    "https://user:password@usf.az1.qualtrics.com/form"]) {
    assert.throws(() => run.qa.buildQualtricsReturnUrl(url, "ID007", null), undefined, url);
  }
  assert.equal(run.qa.DEFAULT_QUALTRICS_RETURN_URL, defaultReturn);
  assert.equal(run.qa.REDIRECT_TO_QUALTRICS, true);
  for (const parameters of [
    { subjectID: "ID007" },
    { subjectID: "ID007", return: "" },
    { subjectID: "UID007", id: " explicit ", return: "https://evil.example/survey" }
  ]) {
    const launched = runtime(parameters);
    const result = new URL(launched.qa.getQualtricsReturnUrl());
    assert.equal(result.origin + result.pathname, defaultReturn);
    assert.equal(result.searchParams.get("subjectID"), null);
    assert.equal(result.searchParams.get("id"), parameters.id?.trim() || "007");
    assert.equal(launched.navigations.length, 0);
  }
});

test("valid custom survey return parameters are preserved without adding a subjectID", () => {
  const base = "https://usf.az1.qualtrics.com/jfe/form/SV_custom?Q_CHL=qr&id=retained#resume";
  const run = runtime({ subjectID: "SID77", return: base });
  const result = new URL(run.qa.getQualtricsReturnUrl());
  assert.equal(result.pathname, "/jfe/form/SV_custom");
  assert.equal(result.hash, "#resume");
  assert.equal(result.searchParams.get("subjectID"), null);
  assert.equal(result.searchParams.get("id"), "retained");
  const explicit = runtime({ subjectID: "ID77", id: "launch", return: base });
  assert.equal(new URL(explicit.qa.getQualtricsReturnUrl()).searchParams.get("id"), "launch");
});

test("building the study and save payloads cannot navigate or mark study completion", async () => {
  const run = runtime();
  await run.qa.start();
  const timeline = run.timeline();
  assert.ok(timeline.length > 0);
  assert.deepEqual(Array.from(timeline.slice(-2), trial => trial.data.event),
    ["pipe_save", "end_download"],
    "the completion gesture must follow the bundled save");
  const saves = run.qa.buildPipeSaveTrials(run.psych);
  assert.equal(saves.length, 1);
  assert.deepEqual(Array.from(saves, trial => trial.data.file),
    ["bundle"]);
  assert.ok(saves.every(trial => trial.data_string().length > 0));
  assert.equal(run.navigations.length, 0);
  assert.equal(run.downloads.length, 0);
  assert.equal(run.qa.sharedState.studyCompleted, false);
  run.advance(10000);
  assert.equal(run.navigations.length, 0);
  const end = timeline.at(-1);
  assert.equal(end.data.event, "end_download");
  assert.deepEqual(Array.from(end.choices), [" "]);
  assert.match(typeof end.stimulus === "function" ? end.stimulus() : end.stimulus, /continue to the questionnaires/i);
});

test("completion renders a usable fallback before one delayed location.replace navigation", async () => {
  const custom = "https://usf.az1.qualtrics.com/jfe/form/SV_custom?Q_CHL=qr&track=a%26b#resume";
  const run = runtime({ subjectID: 'UID <&" 007', id: " external-id ", return: custom });
  assert.equal(run.qa.sharedState.studyCompleted, false);
  await run.onFinish();
  assert.equal(run.qa.sharedState.studyCompleted, true);
  assert.match(run.display.innerHTML, /tasks are complete/i);
  assert.match(run.display.innerHTML, /continue to the questionnaires/i);
  const href = run.display.innerHTML.match(/<a\b[^>]*href="([^"]+)"/)?.[1];
  assert.ok(href, "completion must leave a clickable return link");
  assert.equal(href.replace(/&amp;/g, "&"), run.qa.getQualtricsReturnUrl());
  assert.equal(run.navigations.length, 0);
  run.advance(499);
  assert.equal(run.navigations.length, 0);
  run.qa.finishStudy();
  await run.onFinish();
  run.advance(1);
  assert.equal(run.navigations.length, 1);
  assert.equal(run.navigations[0].at, 500);
  assert.equal(run.navigations[0].url, run.qa.getQualtricsReturnUrl());
  run.advance(2000);
  assert.equal(run.navigations.length, 1, "repeat completion calls cannot schedule duplicate redirects");
});

test("all MRT unload guards remain active before completion and yield for the completed return", async () => {
  const run = runtime();
  await run.qa.start();
  for (let index = 0; index < 2; index++) run.context.buildMRTPractice({ jsPsych: run.psych,
    subjectID: "ID007", metronomeAudio: {}, _state: run.qa.sharedState, numBlocks: 1 });
  assert.ok(run.guardCount() >= 4, "repeated MRT builders install multiple guards");
  const before = run.beforeUnload();
  assert.equal(before.calls, run.guardCount());
  assert.equal(before.returnValue, "");
  await run.onFinish();
  const after = run.beforeUnload();
  assert.equal(after.calls, 0);
  assert.equal(after.returnValue, undefined);
  run.context.buildMRTPractice({ jsPsych: run.psych, subjectID: "ID007", metronomeAudio: {}, _state: run.qa.sharedState, numBlocks: 1 });
  assert.equal(run.beforeUnload().calls, 0, "guards added against the same completed state also yield");
  run.advance(500);
  assert.equal(run.navigations.length, 1);
});

test("the final SPACE gesture preserves the completion redirect without file downloads", async () => {
  const run = runtime();
  await run.qa.start();
  const end = run.timeline().at(-1);
  end.on_finish({ response: " " });
  assert.equal(run.downloads.length, 0);
  assert.doesNotMatch(end.stimulus(), /download|backup files/i);
  assert.equal(run.qa.sharedState.studyCompleted, false);
  assert.equal(run.navigations.length, 0);
  await run.onFinish();
  assert.equal(run.qa.sharedState.studyCompleted, true);
  run.advance(499);
  assert.equal(run.navigations.length, 0);
  run.advance(1);
  assert.equal(run.navigations.length, 1);
  assert.equal(run.events.some(event => event.type === "download"), false);
  assert.ok(run.events.findIndex(event => event.type === "display") < run.events.findIndex(event => event.type === "navigation"));
});


test("original Tasks and Metronome routing is retained for SID, UID and ID launches", async () => {
  // Both original repositories append only the ID-prefix numeric suffix;
  // SID/UID/random participants return to the plain survey address.
  for (const [subjectID, expected] of [
    ["SID6092410435", defaultReturn],
    ["SID4187372347", defaultReturn],
    ["UID12345", defaultReturn],
    ["random12345", defaultReturn],
    ["ID0007", `${defaultReturn}?id=0007`]
  ]) {
    const run = runtime({ subjectID, id: "" });
    assert.equal(run.qa.getQualtricsReturnUrl(), expected);
    await run.onFinish();
    run.advance(500);
    assert.equal(run.navigations[0].url, expected);
  }
  const supplied = runtime({ subjectID: "SID12345", id: "00042" });
  assert.equal(supplied.qa.getQualtricsReturnUrl(), `${defaultReturn}?id=00042`);
});

test("redirect-only URL mode skips every task and export and uses the unchanged participant return path", async () => {
  for (const [parameters, expected] of [
    [{ subjectID: "SID6092410435", redirectTest: "1" }, defaultReturn],
    [{ subjectID: "SID6092410435", id: "", redirectTest: "1" }, defaultReturn],
    [{ subjectID: "SID6092410435", id: "00042", redirectTest: "1" }, `${defaultReturn}?id=00042`],
    [{ subjectID: "ID0007", redirectTest: "1" }, `${defaultReturn}?id=0007`]
  ]) {
    const run = runtime(parameters);
    await run.qa.start();
    const timeline = run.timeline();
    assert.equal(timeline.length, 1, "a routing check must contain just its SPACE confirmation");
    const only = timeline[0];
    assert.equal(only.type, run.context.jsPsychHtmlKeyboardResponse);
    assert.equal(only.data.event, "redirect_test");
    assert.deepEqual(Array.from(only.choices), [" "]);
    assert.equal(only.on_finish, undefined, "the confirmation must not invoke save or download callbacks");
    assert.equal(run.qa.sharedState.studyCompleted, false);
    assert.equal(run.navigations.length, 0);
    run.advance(10000);
    assert.equal(run.navigations.length, 0, "the test must wait for the participant's SPACE confirmation");
    assert.equal(run.guardCount(), 0, "no MRT unload guard should be installed");
    await run.onFinish();
    assert.equal(run.qa.sharedState.studyCompleted, true);
    run.advance(499);
    assert.equal(run.navigations.length, 0);
    run.advance(1);
    assert.equal(run.navigations.length, 1);
    assert.equal(run.navigations[0].url, expected);
    assert.equal(run.navigations[0].at, 10500);
    assert.deepEqual(run.fetches, [], "no stimulus lists or remote upload endpoints may be fetched");
    assert.deepEqual(run.builderCalls, [], "no task initialization, task building, or image exports may run");
    assert.deepEqual(run.downloads, [], "routing tests must not create task-data downloads");
    assert.deepEqual(run.audioPlays, [], "routing tests must not play task audio");
    assert.equal(run.dataReads(), 0, "routing tests must never read responses to fabricate exports");
    assert.equal(run.qa.sharedState.resultExports, undefined);
    assert.equal(run.context.window.__metaState, undefined);
    assert.deepEqual(Array.from(run.qa.sharedState.uploadStatuses), []);
  }
});

test("the local redirect-only switch bypasses tasks without requiring a URL parameter", async () => {
  const run = runtime({ subjectID: "SID12345", id: "return-id" }, { redirectTestOnly: true });
  await run.qa.start();
  assert.equal(run.timeline().length, 1);
  assert.equal(run.timeline()[0].data.event, "redirect_test");
  assert.deepEqual(run.fetches, []);
  assert.deepEqual(run.builderCalls, []);
  await run.onFinish();
  run.advance(500);
  assert.equal(run.navigations[0].url, `${defaultReturn}?id=return-id`);
  assert.deepEqual(run.downloads, []);
  assert.equal(run.dataReads(), 0);
  assert.equal(run.qa.sharedState.resultExports, undefined);
});

test("redirect-only mode stays off by default and requires the explicit URL value 1", async () => {
  for (const redirectTest of [undefined, "0", "true"]) {
    const parameters = { subjectID: "SID12345" };
    if (redirectTest !== undefined) parameters.redirectTest = redirectTest;
    const run = runtime(parameters);
    await run.qa.start();
    assert.ok(run.timeline().length > 1);
    assert.equal(run.timeline().at(-1).data.event, "end_download");
    assert.ok(run.fetches.length > 0, "ordinary runs still initialize their stimulus lists");
    assert.ok(run.builderCalls.includes("initMetaEmotion"));
    assert.ok(run.builderCalls.includes("buildMRTPractice"));
    assert.equal(run.navigations.length, 0);
  }
});
