import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import * as schedule from "../js/image-schedule.mjs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const defaultReturn = "https://usf.az1.qualtrics.com/jfe/form/SV_8wijLZLkAmgskVE";

function collection(rows = []) {
  return { values: () => rows,
    filter: criteria => collection(rows.filter(row => Object.entries(criteria).every(([key, value]) => row[key] === value))) };
}

function runtime(parameters = { subjectID: "ID0007" }) {
  let now = 0, timerId = 0, initOptions, timeline;
  const timers = new Map(), listeners = new Map(), navigations = [], downloads = [], events = [], warnings = [];
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
    set innerHTML(value) { this._html = value; events.push({ type: "display", at: now }); }
  };
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
  Object.defineProperty(location, "href", { set() { assert.fail("completion must use location.replace"); } });
  const window = {
    location, setTimeout, clearTimeout: id => timers.delete(id),
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); }
  };
  const psych = { data: { addProperties() {}, get: () => collection() },
    getDisplayElement: () => display, run: built => { timeline = built; } };
  const context = vm.createContext({ ...schedule, document, window, URL: BrowserURL, URLSearchParams,
    Blob, TextEncoder, crypto: webcrypto, performance: { now: () => now },
    setTimeout, clearTimeout: id => timers.delete(id),
    console: { warn: message => warnings.push(message) },
    fetch: async path => {
      assert.match(path, /^lists\/[\w_]+\.csv$/, "the test harness permits only local CSV reads");
      return { ok: true, text: async () => read(path) };
    },
    Audio: class { play() { return Promise.resolve(); } pause() {} },
    initJsPsych: options => { initOptions = options; return psych; },
    jsPsychHtmlKeyboardResponse: {}, jsPsychImageKeyboardResponse: {},
    jsPsychInstructions: {}, jsPsychPipe: {}, jsPsychPreload: {} });
  const meta = read("metaemotion.js").replace(/^import .*\n/m, "").replace(/^export /gm, "");
  vm.runInContext(read("js/response-controls.js") + "\n" + read("mrt.js") + "\n" + meta, context);
  const main = read("main.js").replace(/^import .*\n/m, "").replace(/start\(\);\s*$/, `
    globalThis.qa = { buildQualtricsReturnUrl, getQualtricsReturnUrl, finishStudy,
      sharedState, start, buildPipeSaveTrials, getResultFiles, REDIRECT_TO_QUALTRICS,
      DEFAULT_QUALTRICS_RETURN_URL };
  `);
  vm.runInContext(main, context);
  return { context, qa: context.qa, psych, display, navigations, downloads, events, warnings, advance,
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
    assert.equal(result.searchParams.get("subjectID"), subject);
    assert.equal(result.searchParams.get("id"), expected, JSON.stringify({ subject, supplied, existing }));
    assert.equal(result.searchParams.has("id"), expected !== null, "empty IDs must be removed");
  }
  assert.equal(run.navigations.length, 0);
  assert.equal(run.qa.sharedState.studyCompleted, false);
});

test("return URL construction preserves query/hash and safely round-trips full encoded identifiers", () => {
  const run = runtime();
  const subject = 'SID <&" / 測試 + 007', participant = 'launch +&=/?#% "';
  const base = "https://USF.AZ1.QUALTRICS.COM/jfe/form/SV_custom?Q_CHL=qr&token=a%2Bb%26c&subjectID=old&id=old#section-2";
  const result = new URL(run.qa.buildQualtricsReturnUrl(base, subject, `  ${participant}  `));
  assert.equal(result.protocol, "https:");
  assert.equal(result.hostname, "usf.az1.qualtrics.com");
  assert.equal(result.pathname, "/jfe/form/SV_custom");
  assert.equal(result.searchParams.get("Q_CHL"), "qr");
  assert.equal(result.searchParams.get("token"), "a+b&c");
  assert.equal(result.searchParams.get("subjectID"), subject);
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
    assert.equal(result.searchParams.get("subjectID"), parameters.subjectID);
    assert.equal(result.searchParams.get("id"), parameters.id?.trim() || "007");
    assert.equal(launched.navigations.length, 0);
  }
});

test("valid custom survey return parameters win while subjectID always matches the full launch identifier", () => {
  const base = "https://usf.az1.qualtrics.com/jfe/form/SV_custom?Q_CHL=qr&id=retained#resume";
  const run = runtime({ subjectID: "SID77", return: base });
  const result = new URL(run.qa.getQualtricsReturnUrl());
  assert.equal(result.pathname, "/jfe/form/SV_custom");
  assert.equal(result.hash, "#resume");
  assert.equal(result.searchParams.get("subjectID"), "SID77");
  assert.equal(result.searchParams.get("id"), "retained");
  const explicit = runtime({ subjectID: "ID77", id: "launch", return: base });
  assert.equal(new URL(explicit.qa.getQualtricsReturnUrl()).searchParams.get("id"), "launch");
});

test("building the study and save payloads cannot navigate or mark study completion", async () => {
  const run = runtime();
  await run.qa.start();
  const timeline = run.timeline();
  assert.ok(timeline.length > 0);
  assert.deepEqual(Array.from(timeline.slice(-5), trial => trial.data.event),
    ["pipe_save", "pipe_save", "pipe_save", "pipe_save", "end_download"],
    "the completion gesture must follow all four configured save trials");
  const saves = run.qa.buildPipeSaveTrials(run.psych);
  assert.equal(saves.length, 4);
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

test("the final SPACE gesture starts the existing four backups before completion redirects", async () => {
  const run = runtime();
  await run.qa.start();
  const end = run.timeline().at(-1);
  end.on_finish({ response: " " });
  assert.equal(run.downloads.length, 4);
  assert.equal(new Set(run.downloads.map(file => file.filename)).size, 4);
  assert.equal(run.qa.sharedState.studyCompleted, false);
  assert.equal(run.navigations.length, 0);
  await run.onFinish();
  assert.equal(run.qa.sharedState.studyCompleted, true);
  run.advance(499);
  assert.equal(run.navigations.length, 0);
  run.advance(1);
  assert.equal(run.navigations.length, 1);
  assert.ok(run.events.findLastIndex(event => event.type === "download") < run.events.findIndex(event => event.type === "display"));
  assert.ok(run.events.findIndex(event => event.type === "display") < run.events.findIndex(event => event.type === "navigation"));
});
