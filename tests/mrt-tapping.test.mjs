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
    setInterval(callback, milliseconds) {
      const id = ++sequence;
      timers.set(id, { callback, at: now + milliseconds, interval: milliseconds });
      return id;
    },
    clearTimeout: id => timers.delete(id),
    pending: () => timers.size,
    advance(milliseconds) {
      const until = now + milliseconds;
      while (true) {
        const due = [...timers].filter(([, timer]) => timer.at <= until)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        const [id, timer] = due;
        now = timer.at;
        if (timer.interval) timer.at += timer.interval;
        else timers.delete(id);
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
  const time = clock(), keyboard = {}, audio = { currentTime: 0, ticks: 0, tickTimes: [], pauses: 0,
    play() { this.ticks++; this.tickTimes.push(time.now()); }, pause() { this.pauses++; } };
  let instructionPage = 0, instructionStatus = null;
  const next = { disabled: false, dataset: {}, innerHTML: "" };
  const previous = { disabled: true, dataset: {} };
  next.closest = selector => selector === ".jspsych-instructions-nav button" ? next : null;
  previous.closest = selector => selector === ".jspsych-instructions-nav button" ? previous : null;
  const observers = new Set();
  const listeners = new Map();
  const display = {};
  const nav = {
    querySelector: selector => selector === "#jspsych-instructions-next" ? next : null,
    querySelectorAll: () => [previous, next],
    parentNode: { insertBefore: element => { instructionStatus = element; } }
  };
  const document = {
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
    querySelector(selector) {
      if (selector === ".jspsych-display-element") return display;
      if (selector === ".jspsych-instructions-pagenum") return { textContent: `${instructionPage + 1} / 4` };
      if (selector === ".jspsych-instructions-nav") return nav;
      return null;
    },
    querySelectorAll: () => [previous, next],
    getElementById: () => instructionStatus,
    createElement: () => ({ setAttribute() {}, textContent: "" })
  };
  class MutationObserver {
    constructor(callback) { this.callback = callback; }
    observe() { observers.add(this); }
    disconnect() { observers.delete(this); }
  }
  class FakeDate extends Date { static now() { return time.now(); } }
  const context = vm.createContext({
    document, MutationObserver, Date: FakeDate,
    window: { addEventListener() {}, removeEventListener() {}, setTimeout: time.setTimeout, clearTimeout: time.clearTimeout,
      setInterval: time.setInterval, clearInterval: time.clearTimeout, requestAnimationFrame: callback => callback() },
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
  const response = tapping.timeline[0];
  const pauseNode = Array.from(tapping.timeline).find(node => node.timeline?.[0]?.trial_duration === null);
  const padNode = Array.from(tapping.timeline).find(node => typeof node.timeline?.[0]?.stimulus === "function");
  assert.ok(pauseNode && padNode);
  const pad = padNode.timeline[0], pauseTrial = pauseNode.timeline[0];
  const task = phase === "practice" ? "practice trial" : "metronome";
  const rows = () => Array.from(state.customData.task, (value, index) => value === task ? {
    task: value, rt: state.customData.RT_from_metronome[index], omission: state.customData.omission[index], trial: state.customData.trial[index]
  } : null).filter(Boolean);
  return { context, state, time, audio, keyboard, built, response, pauseNode, pauseTrial, padNode, pad, rows,
    next, previous, observerCount: () => observers.size,
    instructionClick(button = next) {
      let blocked = false;
      const event = { target: button, preventDefault() { blocked = true; }, stopImmediatePropagation() {} };
      for (const callback of [...(listeners.get("click") || [])]) callback(event);
      return !blocked && !button.disabled;
    },
    listenerCount: type => listeners.get(type)?.size || 0,
    instructionPage(index, notify = true) {
      instructionPage = index;
      previous.disabled = index === 0;
      next.disabled = false;
      if (notify) for (const observer of [...observers]) observer.callback();
    }
  };
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
  run.pad.on_finish({ response: null, rt: null });
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
      const beeps = run.audio.ticks;
      const result = cycle(run, { key: " ", rt });
      assert.match(result.stimulus, />\+<\/div>/);
      assert.equal(result.padding, 1300 - rt);
      assert.equal(result.elapsed, 1300);
      assert.equal(run.rows().length, before + 1);
      assert.equal(run.rows().at(-1).rt, rt - 650);
      assert.equal(run.rows().at(-1).omission, "FALSE");
      assert.equal(run.audio.ticks, beeps + 1, "ordinary early SPACE must preserve the scheduled tone during feedback");
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
    assert.deepEqual(Array.from(run.pad.choices), ["p"], "SPACE and other keys cannot interrupt feedback or consume the pause listener");
    assert.equal(run.pad.response_ends_trial, true, "P can interrupt feedback");
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
    const ticksBefore = run.audio.ticks;
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
    assert.equal(value(run.pad.stimulus), "");
    assert.equal(value(run.pad.trial_duration), 0);
    assert.equal(run.audio.ticks, ticksBefore, "the pending tone is canceled when P is pressed before it sounds");
    assert.equal(run.rows().length, before, "resuming cannot create a tap or omission");
    const pauses = Array.from(run.state.customData.task).map((task, index) => ({ task, index })).filter(row => row.task === "pause");
    assert.equal(pauses.length, 1);
    assert.equal(run.state.customData.pause_time[pauses[0].index], "2.500");
    const resumedAt = run.time.now();
    const next = cycle(run, { key: " ", rt: 650 });
    assert.match(next.stimulus, />\+<\/div>/);
    assert.equal(run.rows().length, before + 1);
    assert.equal(run.rows().at(-1).rt, 0);
    assert.equal(run.rows().at(-1).omission, "FALSE");
    assert.equal(run.audio.tickTimes.at(-1), resumedAt + 650, "resuming starts a fresh tone cycle");
  });

  test(`${phase}: P during confirmation preserves the accepted tap once and cancels any pending tone`, () => {
    for (const tapRT of [200, 900]) {
      const run = runtime(phase);
      run.response.on_start();
      run.time.advance(tapRT);
      run.response.on_finish({ response: " ", rt: tapRT });
      assert.equal(run.padNode.conditional_function(), true);
      assert.match(value(run.pad.stimulus), />\+<\/div>/);
      assert.equal(run.pauseNode.conditional_function(), false);
      assert.ok(run.rows().length <= 1, "the accepted response is not recorded twice across active and feedback screens");
      run.time.advance(100);
      run.pad.on_finish({ response: "p", rt: 100 });
      assert.equal(run.rows().length, 1);
      assert.equal(run.rows()[0].rt, tapRT - 650);
      assert.equal(run.rows()[0].omission, "FALSE");
      assert.equal(run.pauseNode.conditional_function(), true);
      assert.equal(value(run.pad.stimulus), "", "confirmation cannot remain visible while paused");
      run.pauseTrial.on_start();
      run.time.advance(2500);
      run.pauseTrial.on_finish({ response: "p", rt: 2500 });
      assert.equal(run.audio.ticks, tapRT < 650 ? 0 : 1);
      assert.equal(run.rows().length, 1, "pause and resume cannot duplicate the saved SPACE response");
      const pauseIndex = Array.from(run.state.customData.task).indexOf("pause");
      assert.equal(run.state.customData.pause_time[pauseIndex], "2.500");
      const resumedAt = run.time.now();
      const next = cycle(run);
      assert.equal(next.stimulus, "");
      assert.equal(next.elapsed, 1300);
      assert.equal(run.rows().length, 2);
      assert.equal(run.rows()[1].omission, "TRUE");
      assert.equal(run.audio.tickTimes.at(-1), resumedAt + 650);
    }
  });

  test(`${phase}: pauses are self-paced and remain available after repeated use`, () => {
    const run = runtime(phase);
    assert.equal(run.pauseTrial.trial_duration, null);
    assert.deepEqual(Array.from(run.pauseTrial.choices), ["p"]);
    for (const duration of [2500, 120000, 2000, 3000, 4000, 5000]) {
      run.response.on_start();
      run.time.advance(100);
      run.response.on_finish({ response: "p", rt: 100 });
      assert.equal(run.padNode.conditional_function(), false);
      assert.equal(run.pauseNode.conditional_function(), true);
      run.pauseTrial.on_start();
      run.time.advance(duration);
      run.pauseTrial.on_finish({ response: "p", rt: duration });
      assert.equal(run.pauseNode.conditional_function(), false);
    }
    assert.equal(run.rows().length, 0);
    assert.equal(run.audio.ticks, 0);
    const pauseValues = Array.from(run.state.customData.task).flatMap((task, index) => task === "pause" ? [run.state.customData.pause_time[index]] : []);
    assert.deepEqual(pauseValues, ["2.500", "120.000", "2.000", "3.000", "4.000", "5.000"]);
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

test("MRT recap has four pages with timed reading gates and preserves the probe sequence", () => {
  const run = runtime("practice");
  const instructions = flatten(run.built.timeline).find(trial => trial.pages);
  assert.equal(instructions.pages.length, 4);
  assert.equal(instructions.allow_keys, false);
  const text = Array.from(instructions.pages, html => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " "));
  const allText = text.join(" ");
  assert.match(allText, /synchron/i);
  assert.match(allText, /accura/i);
  assert.match(allText, /15\s+seconds/i);
  assert.match(allText, /(?:full\s+range|all\s+(?:six|6)\s+(?:response\s+)?(?:options|ratings))/i);
  assert.match(allText, /P.*pause/i);
  const questions = flatten(run.built.timeline).filter(trial => trial.data?.practice_probe === 1 && trial.data.probe_question);
  assert.deepEqual(questions.map(trial => trial.data.probe_kind), ["focus", "basis", "confidence"]);
  for (const label of ["Very unconfident", "Unconfident", "Confident", "Very confident"]) assert.ok(allText.includes(label));

  instructions.on_load();
  for (let page = 0; page < 4; page++) {
    if (page > 0) run.instructionPage(page, false);
    assert.equal(run.instructionClick(), false, "a rapid next click must lock the current page before its observer runs");
    assert.equal(run.next.disabled, true);
    run.time.advance(9999);
    assert.equal(run.next.disabled, true);
    assert.equal(run.instructionClick(), false);
    run.time.advance(1);
    assert.equal(run.next.disabled, false);
    assert.equal(run.instructionClick(), true);
  }
  assert.equal(run.instructionClick(run.previous), true);
  run.instructionPage(2, false);
  assert.equal(run.instructionClick(), true, "returning to a completed page does not relock navigation");
  run.instructionPage(0);
  assert.equal(run.next.disabled, false, "a completed page stays available on return");
  instructions.on_finish();
  assert.equal(run.time.pending(), 0);
  assert.equal(run.observerCount(), 0);
  assert.equal(run.listenerCount("click"), 0, "instruction navigation guards are removed on finish");
});
