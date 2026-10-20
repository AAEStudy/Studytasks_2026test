import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import * as images from "../js/image-schedule.mjs";
import { resolveStudyConfig, createMrtIntervalSchedule, sectionProgressMessage } from "../js/study-schedule.mjs";
import { buildSectionBreak } from "../js/study-breaks.mjs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));
const flatten = timeline => Array.from(timeline).flatMap(item => [item, ...(item.timeline ? flatten(item.timeline) : [])]);

test("mode switch defaults to full and retains the exact legacy short counts", () => {
  assert.equal(resolveStudyConfig().mode, "full");
  assert.equal(resolveStudyConfig("?mode=unknown").mode, "full");
  assert.equal(resolveStudyConfig("?mode=full", "test").mode, "full");
  const short = resolveStudyConfig("?subjectID=CHECK&id=123&mode=test&saveTo=both");
  assert.deepEqual([short.calibrationComparisons, short.mrtProbeIntervals, short.mrtMeanSeconds,
    short.reviewImages, short.finalJudgments], [6, 1, 40, 20, 60]);
  assert.deepEqual(createMrtIntervalSchedule(short).map(row => row.tappingTrials), [31]);
  assert.equal(short.sections[0].break, null);
});

test("every full schedule has equal sustained blocks and retains bounded interval jitter", () => {
  const config = resolveStudyConfig();
  assert.deepEqual(config.sections.map(section => section.comparisons), [90, 100, 90, 100]);
  assert.deepEqual(config.sections.map(section => [section.break.kind, section.break.durationMs]),
    [["optional", 120000], ["mandatory", 180000], ["optional", 120000], ["mandatory", 300000]]);
  for (let seed = 0; seed < 100; seed++) {
    let state = seed + 1;
    const random = () => ((state = (1664525 * state + 1013904223) >>> 0) / 2 ** 32);
    const schedule = createMrtIntervalSchedule(config, random);
    assert.equal(schedule.length, 48);
    assert.ok(Object.isFrozen(schedule) && Object.isFrozen(schedule[0]));
    for (let section = 1; section <= 4; section++) {
      const rows = schedule.filter(row => row.section === section);
      assert.equal(rows.length, 12);
      assert.equal(rows.reduce((sum, row) => sum + row.tappingMs, 0), 504400);
      assert.ok(Math.abs(rows.reduce((sum, row) => sum + row.targetSeconds, 0) - 504) < 1e-8);
      rows.forEach((row, index) => {
        assert.equal(row.probeInSection, index + 1);
        assert.ok(row.targetSeconds >= 27 && row.targetSeconds <= 57);
        assert.ok(Math.abs(row.tappingMs - row.targetSeconds * 1000) < 1300);
      });
    }
    assert.ok(new Set(schedule.map(row => row.tappingTrials)).size > 1);
  }
});

async function assembled(mode) {
  let timeline, trialStarted;
  const banners = [];
  const psych = { data: { addProperties() {}, get: () => ({ values: () => [] }) },
    run: value => { timeline = value; trialStarted(); } };
  const context = vm.createContext({ ...images, resolveStudyConfig, createMrtIntervalSchedule, buildSectionBreak,
    console, performance, URL, URLSearchParams, TextEncoder, crypto: webcrypto,
    window: { location: { search: `?mode=${mode}&subjectID=CHECK` }, addEventListener() {}, removeEventListener() {} },
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => banners[0], createElement: () => ({}), body: { appendChild: node => banners.push(node) } },
    fetch: async path => {
      assert.match(path, /^lists\/[\w_]+\.csv$/);
      return { ok: true, text: async () => read(path) };
    },
    Audio: class {}, initJsPsych: options => { trialStarted = options.on_trial_start; return psych; },
    jsPsychHtmlKeyboardResponse: {}, jsPsychImageKeyboardResponse: {},
    jsPsychInstructions: {}, jsPsychPipe: {}, jsPsychPreload: {} });
  const meta = read("metaemotion.js").replace(/^import .*\n/gm, "").replace(/^export /gm, "");
  vm.runInContext(read("js/response-controls.js") + "\n" + read("mrt.js") + "\n" + meta, context);
  const main = read("main.js").replace(/^import .*\n/gm, "")
    .replace(/start\(\);\s*$/, "globalThis.qa = { start, sharedState, STUDY_CONFIG };");
  vm.runInContext(main, context);
  await context.qa.start();
  return { context, timeline, flat: flatten(timeline), banners, state: context.qa.sharedState };
}

for (const mode of ["full", "test"]) test(`${mode}: actual orchestration has all trials in order and saves after final judgments`, async () => {
  const run = await assembled(mode);
  const full = mode === "full";
  const pairs = run.flat.filter(trial => trial.data?.event === "2ifc");
  assert.equal(pairs.filter(trial => trial.data.phase === "practice").length, 12);
  assert.equal(pairs.filter(trial => trial.data.phase === "calibration").length, full ? 380 : 6);
  assert.equal(run.flat.filter(trial => trial.data?.event === "meta_conf").length, 60);
  assert.equal(run.flat.filter(trial => trial.data?.event === "image" && trial.data.phase === "review").length, 20);
  const intervals = run.timeline.filter(trial => trial.on_timeline_start && trial.data?.mrt_interval);
  assert.equal(intervals.length, full ? 48 : 1);
  assert.equal(run.state.mrtCursor, full ? 48 : 1);
  let previous = -1;
  for (const section of run.context.qa.STUDY_CONFIG.sections) {
    const nodes = intervals.filter(trial => trial.data.mrt_section === section.number);
    const first = run.timeline.indexOf(nodes[0]), last = run.timeline.indexOf(nodes.at(-1));
    assert.equal(last - first + 1, section.probes, "MRT intervals must be consecutive within their section");
    const comparisons = flatten(run.timeline.slice(previous + 1, first)).filter(trial => trial.data?.event === "2ifc" && trial.data.phase === "calibration");
    assert.equal(comparisons.length, section.comparisons);
    assert.equal(nodes.reduce((sum, node) => sum + node.timeline.filter(child => child.timeline?.[0]?.trial_duration === 1300).length, 0), full ? 388 : 31);
    if (full) {
      assert.equal(run.timeline[last + 1].data.event, "scheduled_break");
      assert.equal(run.timeline[last + 1].data.section, section.number);
    }
    previous = last;
  }
  const breaks = run.flat.filter(trial => trial.data?.event === "scheduled_break");
  assert.equal(breaks.length, full ? 4 : 0);
  assert.equal(run.flat.filter(trial => trial.data?.event === "study_overview").length, full ? 1 : 0);
  assert.equal(run.banners.length, full ? 0 : 1);
  const lastInterval = run.timeline.indexOf(intervals.at(-1));
  assert.equal(run.timeline[lastInterval + (full ? 2 : 1)].data.event, "meta_instructions");
  assert.equal(run.timeline.at(-2).action, "saveBase64");
  assert.equal(run.timeline.at(-1).data.event, "end_download");
  const saved = run.state.mrtIntervalSchedule;
  run.context.buildMRTChunk({ jsPsych: {}, subjectID: "CHECK", metronomeAudio: {}, _state: run.state,
    numBlocks: full ? 48 : 1, blocksToTake: 1, includeMidBreak: false });
  assert.equal(run.state.mrtIntervalSchedule, saved, "building a later chunk must not regenerate the schedule");
  assert.deepEqual(plain(intervals.map(node => node.data.mrt_interval)), Array.from({length: full ? 48 : 1}, (_, i) => i + 1));
  if (full) {
    const final = intervals.at(-1);
    final.on_timeline_start();
    const resume = flatten(final.timeline).find(trial => trial.data?.event === "probe_resume");
    const live = { ...resume, data: { ...resume.data } };
    resume.on_start(live);
    assert.match(live.stimulus, /next break/);
    const tapping = final.timeline.find(child => child.timeline?.[0]?.trial_duration === 1300);
    tapping.timeline[0].on_finish({ response: " ", rt: 650 });
    tapping.timeline[1].timeline[0].on_finish({ response: null });
    assert.equal(run.state.customData.mrt_section.at(-1), 4);
    assert.equal(run.state.customData.mrt_interval.at(-1), 48);
    assert.equal(run.state.customData.mrt_probe_in_section.at(-1), 12);
  }
});

function breakHarness(kind, durationMs) {
  let now = 0, refresh, cleared = false;
  const records = [], finished = [];
  const element = () => {
    const handlers = new Map();
    return { disabled: false, hidden: false, textContent: "",
      addEventListener: (event, callback) => handlers.set(event, callback),
      removeEventListener: event => handlers.delete(event),
      click: () => handlers.get("click")?.() };
  };
  const take = element(), next = element(), status = element();
  const display = { querySelector: selector => selector.includes('"take"') ? take : selector.includes('"continue"') ? next : status };
  const jsPsych = { getDisplayElement: () => display, finishTrial: data => { finished.push(data); trial.on_finish(data); } };
  const trial = buildSectionBreak({ jsPsych, trialType: {}, section: kind === "mandatory" ? 2 : 1,
    breakSpec: {kind, durationMs}, onRecord: data => records.push(data), clock: () => now,
    wallClock: () => new Date(now).toISOString(),
    timers: { setInterval: callback => { refresh = callback; return 1; }, clearInterval: () => { cleared = true; } } });
  trial.on_load();
  return { trial, take, next, status, records, finished, setTime: value => { now = value; },
    tick: () => refresh(), cleared: () => cleared };
}

for (const minimum of [180000, 300000]) test(`mandatory break enforces ${minimum} ms and never auto-resumes`, () => {
  const run = breakHarness("mandatory", minimum);
  assert.equal(run.trial.choices, "NO_KEYS");
  assert.equal(run.next.disabled, true);
  run.next.click();
  run.setTime(minimum - 1); run.next.click();
  assert.equal(run.finished.length, 0, "even a dispatched click cannot bypass the minimum");
  run.setTime(minimum); run.tick();
  assert.equal(run.next.disabled, false);
  assert.equal(run.finished.length, 0, "timeout unlocks Continue, without finishing");
  run.setTime(minimum + 10000); run.next.click(); run.next.click();
  assert.equal(run.records.length, 1);
  assert.equal(run.records[0].break_duration_ms, minimum + 10000);
  assert.equal(run.records[0].minimum_met, true);
  assert.equal(run.records[0].skipped, false);
  assert.equal(run.cleared(), true);
});

test("optional breaks distinguish skipped, shortened and completed breaks", () => {
  const skip = breakHarness("optional", 120000);
  skip.setTime(5000); skip.next.click();
  assert.equal(skip.records[0].skipped, true);
  assert.equal(skip.records[0].break_duration_ms, 0);
  assert.equal(skip.records[0].decision_duration_ms, 5000);
  const short = breakHarness("optional", 120000);
  short.setTime(4000); short.take.click();
  short.setTime(34000); short.next.click();
  assert.equal(short.records[0].break_duration_ms, 30000);
  assert.equal(short.records[0].ended_early, true);
  assert.equal(short.records[0].skipped, false);
  const full = breakHarness("optional", 120000);
  full.take.click(); full.setTime(125000); full.tick();
  assert.equal(full.finished.length, 0);
  full.next.click();
  assert.equal(full.records[0].ended_early, false);
  assert.equal(full.cleared(), true);
});

test("progress wording distinguishes primary tasks from the remaining study", () => {
  assert.match(sectionProgressMessage(1), /one-quarter of the primary tasks/);
  assert.match(sectionProgressMessage(2), /halfway through the primary tasks/);
  assert.match(sectionProgressMessage(3), /three-quarters of the primary tasks/);
  const final = buildSectionBreak({ jsPsych: {}, trialType: {}, section: 4, breakSpec: {kind:"mandatory", durationMs:300000} });
  assert.match(final.stimulus, /final picture judgments/);
  assert.match(final.stimulus, /questionnaires/);
  assert.doesNotMatch(final.stimulus, /completed.*(?:whole|entire) study/);
});
