import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const confidenceQuestion = "How confident are you that the level of focus to the task you indicated was accurate?";

function clock() {
  let now = 0, sequence = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(callback, milliseconds) {
      const id = ++sequence;
      timers.set(id, { callback, at: now + milliseconds });
      return id;
    },
    clearTimeout: id => timers.delete(id),
    advance(milliseconds) {
      const until = now + milliseconds;
      while (true) {
        const due = [...timers].filter(([, timer]) => timer.at <= until)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        const [id, timer] = due;
        timers.delete(id);
        now = timer.at;
        timer.callback();
      }
      now = until;
    }
  };
}

function flatten(items) {
  return Array.from(items).flatMap(item => [item, ...(item.timeline ? flatten(item.timeline) : [])]);
}

function runtime(phase) {
  const time = clock(), keyboard = {}, audio = { currentTime: 0, ticks: 0, play() { this.ticks++; } };
  const context = vm.createContext({
    document: { addEventListener() {}, removeEventListener() {} },
    window: { addEventListener() {}, removeEventListener() {}, setTimeout: time.setTimeout, clearTimeout: time.clearTimeout },
    performance: { now: time.now }, setTimeout: time.setTimeout, clearTimeout: time.clearTimeout,
    jsPsychHtmlKeyboardResponse: keyboard, jsPsychInstructions: {}
  });
  vm.runInContext(read("js/response-controls.js") + "\n" + read("mrt.js"), context);
  const state = { mrtInitialized: phase === "main", mrtMainStarted: phase === "main", mrtCursor: 0, probeBlockCounter: 0, trialNum: 0 };
  const options = { subjectID: "CHECK", jsPsych: {}, metronomeAudio: audio, _state: state, numBlocks: 1, blocksToTake: 1, includeMidBreak: false };
  const built = phase === "practice" ? context.buildMRTPractice(options) : context.buildMRTChunk(options);
  const tapping = flatten(built.timeline).find(item => item.timeline?.length === 3
    && item.timeline[0]?.trial_duration === 1300 && item.timeline[0].choices?.includes("p"));
  assert.ok(tapping, `${phase} tapping timeline exists`);
  const [response, pauseNode, padNode] = tapping.timeline;
  const pad = padNode.timeline[0], pauseTrial = pauseNode.timeline[0];
  const task = phase === "practice" ? "practice trial" : "metronome";
  const rows = () => Array.from(state.customData.task, (value, index) => value === task ? {
    task: value, rt: state.customData.RT_from_metronome[index], omission: state.customData.omission[index], trial: state.customData.trial[index]
  } : null).filter(Boolean);
  return { context, state, time, audio, keyboard, built, response, pauseNode, pauseTrial, padNode, pad, rows };
}

function value(property) { return typeof property === "function" ? property() : property; }

// Model the keyboard plugin's accepted-key and timeout behavior, then execute
// the real task callbacks and padding timeline. Mouse input cannot end this plugin.
function cycle(run, { key = null, rt = 1300, mouse = false } = {}) {
  const start = run.time.now();
  assert.equal(run.response.type, run.keyboard);
  run.response.on_start?.();
  const accepted = !mouse && Array.from(run.response.choices).includes(key);
  const elapsed = accepted ? rt : value(run.response.trial_duration);
  run.time.advance(elapsed);
  run.response.on_finish({ response: accepted ? key : null, rt: accepted ? rt : null });
  assert.equal(run.pauseNode.conditional_function(), false, "ordinary tapping does not enter a pause");
  assert.equal(run.padNode.conditional_function(), true);
  const stimulus = value(run.pad.stimulus), padding = value(run.pad.trial_duration);
  run.time.advance(padding);
  run.pad.on_finish({});
  return { stimulus, padding, elapsed: run.time.now() - start };
}

for (const phase of ["practice", "main"]) {
  test(`${phase}: omissions stay blank, save once, and take exactly one 1300ms cycle`, () => {
    const run = runtime(phase);
    const result = cycle(run);
    assert.equal(result.stimulus, "");
    assert.equal(result.padding, 0, "an omission cannot add another 650ms of feedback time");
    assert.equal(result.elapsed, 1300);
    assert.equal(run.audio.ticks, 1);
    assert.equal(run.rows().length, 1);
    assert.equal(run.rows()[0].rt, "");
    assert.equal(run.rows()[0].omission, "TRUE");
  });

  test(`${phase}: accepted SPACE gives feedback and the correct signed score without changing cycle length`, () => {
    const run = runtime(phase);
    for (const rt of [0, 300, 650, 900, 1299]) {
      const before = run.rows().length;
      const result = cycle(run, { key: " ", rt });
      assert.match(result.stimulus, />\+<\/div>/);
      assert.equal(result.padding, 1300 - rt);
      assert.equal(result.elapsed, 1300);
      assert.equal(run.rows().length, before + 1);
      assert.equal(run.rows().at(-1).rt, rt - 650);
      assert.equal(run.rows().at(-1).omission, "FALSE");
    }
    const omitted = cycle(run);
    assert.equal(omitted.stimulus, "", "feedback cannot carry over from the previous SPACE response");
    assert.equal(omitted.padding, 0);
    assert.equal(run.rows().at(-1).rt, "");
    assert.equal(run.rows().at(-1).omission, "TRUE");
  });

  test(`${phase}: irrelevant keys and mouse input cannot count as metronome taps`, () => {
    const run = runtime(phase);
    assert.deepEqual(Array.from(run.response.choices), [" ", "p"]);
    assert.equal(run.response.response_ends_trial, true);
    assert.equal(run.pad.response_ends_trial, false, "additional feedback-screen input cannot end the cycle early");
    for (const input of [{ key: "Enter", rt: 100 }, { key: "x", rt: 100 }, { key: " ", rt: 100, mouse: true }]) {
      const result = cycle(run, input);
      assert.equal(result.elapsed, 1300);
      assert.equal(result.stimulus, "");
      assert.equal(run.rows().at(-1).omission, "TRUE");
      assert.equal(run.rows().at(-1).rt, "");
    }
    assert.equal(run.rows().length, 3);
  });

  test(`${phase}: pause and resume produce neither confirmation feedback nor a tapping/omission row`, () => {
    const run = runtime(phase);
    cycle(run, { key: " ", rt: 650 });
    const before = run.rows().length;
    run.response.on_start();
    run.time.advance(300);
    run.response.on_finish({ response: "p", rt: 300 });
    assert.equal(run.pauseNode.conditional_function(), true);
    assert.equal(run.padNode.conditional_function(), false);
    assert.equal(value(run.pad.stimulus), "", "pausing cannot display a SPACE confirmation");
    run.pauseTrial.on_start();
    run.time.advance(2500);
    run.pauseTrial.on_finish({ response: "p", rt: 2500 });
    assert.equal(run.pauseNode.conditional_function(), false);
    assert.equal(run.padNode.conditional_function(), true);
    assert.equal(value(run.pad.stimulus), "");
    assert.equal(value(run.pad.trial_duration), 0);
    run.pad.on_finish({});
    assert.equal(run.rows().length, before, "resuming cannot create a tap or omission");
    const pauses = Array.from(run.state.customData.task).map((task, index) => ({ task, index })).filter(row => row.task === "pause");
    assert.equal(pauses.length, 1);
    assert.equal(run.state.customData.pause_time[pauses[0].index], "2.500");
    const next = cycle(run, { key: " ", rt: 650 });
    assert.match(next.stimulus, />\+<\/div>/);
    assert.equal(run.rows().length, before + 1);
    assert.equal(run.rows().at(-1).rt, 0);
    assert.equal(run.rows().at(-1).omission, "FALSE");
  });
}

test("practice and main confidence questions use the user's exact wording", () => {
  for (const phase of ["practice", "main"]) {
    const run = runtime(phase);
    const confidence = flatten(run.built.timeline).find(trial => trial.data?.probe_kind === "confidence");
    assert.ok(confidence);
    assert.match(confidence.stimulus, new RegExp(`<p class="mrt-probe-question">${confidenceQuestion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<\\/p>`));
  }
});
