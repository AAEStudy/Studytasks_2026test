import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const labels = ["Very unconfident", "Unconfident", "Confident", "Very confident"];

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
    emit(type, event) { for (const callback of [...(listeners.get(type) || [])]) callback(event); }
  };
}

function runtime() {
  let now = 0, activeTrial;
  const document = eventTarget(), window = eventTarget(), finished = [];
  window.setTimeout = () => 1;
  window.clearTimeout = () => {};
  const buttons = labels.map((label, index) => ({
    label, dataset: { value: String(index + 1) }, attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    closest(selector) { return selector === ".mrt-certainty-option" ? this : null; }
  }));
  const psych = {
    getDisplayElement: () => ({ querySelectorAll: () => buttons }),
    finishTrial(data) {
      finished.push(data);
      activeTrial.on_finish({ ...activeTrial.data, ...data });
    }
  };
  const context = vm.createContext({ document, window, performance: { now: () => now },
    jsPsychHtmlKeyboardResponse: {}, jsPsychInstructions: {} });
  vm.runInContext(read("js/response-controls.js") + "\n" + read("mrt.js"), context);
  const state = { mrtCursor: 0, mrtInitialized: false, mrtMainStarted: false, probeBlockCounter: 0, trialNum: 0 };
  const params = { jsPsych: psych, subjectID: "CHECK", metronomeAudio: {}, _state: state, numBlocks: 35, includeMidBreak: false };
  return { context, state, params, document, window, buttons, finished,
    setTime: value => { now = value; },
    load: trial => { activeTrial = trial; trial.on_load(); } };
}

function flatten(items) {
  return Array.from(items).flatMap(item => [item, ...(item.timeline ? flatten(item.timeline) : [])]);
}
function rows(state, task) {
  const data = state.customData;
  return Array.from(data.task, (value, index) => value === task
    ? Object.fromEntries(Object.entries(data).map(([key, values]) => [key, values[index]])) : null).filter(Boolean);
}
function start(trial) {
  const live = { ...trial, data: { ...trial.data } };
  trial.on_start?.(live);
  return live;
}
function answer(questions, values = {}) {
  const { focus = "4", basis = "F", confidence = 3, focusRT = 701, basisRT = 902, confidenceRT = 1103 } = values;
  const data = [];
  for (const trial of questions) {
    const live = start(trial);
    const response = trial.data.probe_kind === "focus" ? { response: focus, rt: focusRT }
      : trial.data.probe_kind === "basis" ? { response: basis, rt: basisRT }
        : { response: confidence, confidence_rating: confidence, confidence_label: labels[confidence - 1], rt: confidenceRT };
    const result = { ...live.data, ...response };
    trial.on_finish(result);
    data.push(result);
  }
  return data;
}
function mainProbe(runtime) {
  const built = runtime.context.buildMRTChunk({ ...runtime.params, blocksToTake: 1 });
  const node = flatten(built.timeline).find(item => item.timeline?.some(child => child.data?.probe_kind === "focus" && child.data?.thought_probe === 1));
  assert.ok(node, "main thought probe exists");
  return { node, questions: Array.from(node.timeline).filter(item => item.data?.probe_question),
    checkNode: Array.from(node.timeline).find(item => item.timeline?.some(child => child.data?.instructed_response_probe === 1)) };
}

test("practice presents focus, basis, confidence and saves only complete, separately labeled probes", () => {
  const run = runtime();
  const built = run.context.buildMRTPractice(run.params);
  const questions = flatten(built.timeline).filter(item => item.data?.practice_probe === 1 && item.data?.probe_question);
  assert.deepEqual(questions.map(item => item.data.probe_kind), ["focus", "basis", "confidence"]);
  assert.deepEqual(questions.map(item => item.data.probe_question), [1, 2, 3]);
  assert.ok(questions.every(item => item.data.thought_probe === 0));
  vm.runInContext("StudyResponses.recordSpeed = () => { throw new Error('Practice must not affect main response-speed tracking'); };", run.context);

  for (const [index, trial] of questions.entries()) {
    const live = start(trial);
    trial.on_finish({ ...live.data, ...[{ response: "4", rt: 701 }, { response: "F", rt: 902 },
      { response: 3, confidence_rating: 3, confidence_label: "Confident", rt: 1103 }][index] });
    assert.equal(rows(run.state, "practice_probe").length, index === 2 ? 1 : 0);
  }
  assert.equal(run.state.probeBlockCounter, 0);
  assert.equal(run.state.mrtCursor, 0);
  assert.equal(run.state.mrtMainStarted, false);
  assert.equal(rows(run.state, "thought_probe").length, 0);
  const first = rows(run.state, "practice_probe")[0];
  assert.equal(first.main_basis, "general_feeling");
  assert.equal(first.confidence_rating, 3);
  assert.equal(first.probe1_rt, "0.701");
  assert.equal(first.probe2_rt, "1.103", "legacy probe2_rt still means confidence RT");
  assert.equal(first.probe3_rt, "0.902", "legacy probe3_rt still means basis RT");
  assert.equal(first.probe1_fast, "NA");
  assert.equal(first.probe3_fast, "NA");

  const prompt = flatten(built.timeline).find(item => Array.isArray(item.choices) && item.choices.includes("arrowleft"));
  prompt.on_finish({ response: "arrowleft" });
  answer(questions, { basis: "C", confidence: 1 });
  assert.equal(rows(run.state, "practice_probe").length, 2);
  assert.equal(rows(run.state, "practice_probe")[1].main_basis, "remembered_thoughts");
  assert.equal(rows(run.state, "practice_probe")[1].confidence_label, "Very unconfident");
  assert.equal(run.state.probeBlockCounter, 0);
});

test("main probes retain legacy RT meanings and do not reuse prior basis or confidence values", () => {
  const run = runtime();
  run.context.buildMRTPractice(run.params);
  const { node, questions } = mainProbe(run);
  assert.deepEqual(questions.map(item => item.data.probe_kind), ["focus", "basis", "confidence"]);
  assert.deepEqual(questions.map(item => item.data.probe_question), [1, 2, 3]);
  node.timeline[0].on_start();
  questions[0].on_finish({ response: "6", rt: 101 });
  assert.equal(rows(run.state, "thought_probe").length, 0);
  questions[1].on_finish({ response: "o", rt: 202 });
  assert.equal(rows(run.state, "thought_probe").length, 0, "basis cannot save an incomplete probe");
  questions[2].on_finish({ confidence_rating: 4, confidence_label: "Very confident", rt: 1303 });
  const first = rows(run.state, "thought_probe")[0];
  assert.equal(first.performance_rating, "6");
  assert.equal(first.main_basis, "other");
  assert.equal(first.confidence_rating, 4);
  assert.equal(first.probe1_rt, "0.101");
  assert.equal(first.probe2_rt, "1.303");
  assert.equal(first.probe3_rt, "0.202");
  assert.equal(first.probe1_fast, true);
  assert.equal(first.probe3_fast, true);

  const next = mainProbe(run);
  next.node.timeline[0].on_start();
  answer(next.questions, { focus: "1", basis: "C", confidence: 2 });
  const second = rows(run.state, "thought_probe")[1];
  assert.equal(second.performance_rating, "1");
  assert.equal(second.main_basis, "remembered_thoughts");
  assert.equal(second.confidence_rating, 2);
  assert.equal(second.confidence_label, "Unconfident");
  assert.equal(second.probe1_fast, false);
  assert.equal(second.probe3_fast, false);
  assert.equal(run.state.probeBlockCounter, 2);
  const exported = run.state.convertToCSV(run.state.customData);
  assert.ok(exported.split("\n")[0].split("\t").includes("probe_order"));
  assert.ok(exported.includes("focus,basis,confidence"));
});

test("every tenth main probe checks the four confidence controls and records checks separately", () => {
  const run = runtime();
  run.context.buildMRTPractice(run.params);
  const { node, questions, checkNode } = mainProbe(run);
  assert.ok(node.timeline.indexOf(checkNode) > node.timeline.indexOf(questions[2]));
  const check = checkNode.timeline[0];
  assert.equal(check.choices, "NO_KEYS", "response checks use the confidence mouse controls");
  const expected = [];
  for (let index = 1; index <= 50; index++) {
    node.timeline[0].on_start();
    answer(questions, { confidence: 4 });
    assert.equal(checkNode.conditional_function(), index % 10 === 0);
    if (!checkNode.conditional_function()) continue;
    const live = start(check);
    expected.push(live.data.instructed_response_expected);
    const response = index === 20 ? 1 : live.data.instructed_response_expected;
    check.on_finish({ ...live.data, response, rt: 715 });
  }
  assert.deepEqual(expected.map(Number), [1, 2, 3, 4, 1]);
  const checks = rows(run.state, "instructed_response");
  assert.equal(checks.length, 5);
  assert.deepEqual(checks.map(row => row.instructed_response_correct), [true, false, true, true, true]);
  assert.ok(checks.every(row => row.confidence_rating === "NA" && row.main_basis === "NA"));
  assert.ok(checks.every(row => row.instructed_response_rt_ms === 715));
  const probes = rows(run.state, "thought_probe");
  assert.equal(probes.length, 50);
  assert.ok(probes.every(row => row.confidence_rating === 4 && row.confidence_label === "Very confident"));
});

test("a check requires new mouse movement and a new eligible press after confidence", () => {
  const run = runtime();
  run.context.buildMRTPractice(run.params);
  const { node, questions, checkNode } = mainProbe(run);
  node.timeline[0].on_start();
  questions[0].on_finish({ response: "4", rt: 701 });
  questions[1].on_finish({ response: "F", rt: 902 });
  const confidence = questions[2];
  const pointer = (button, extra = {}) => ({ pointerType: "mouse", button: 0, detail: 1,
    clientX: 25, clientY: 0, target: button, preventDefault() {}, ...extra });
  run.document.emit("pointermove", pointer(run.buttons[2], { clientX: 0 }));
  run.load(confidence);
  run.document.emit("pointermove", pointer(run.buttons[2]));
  run.setTime(600);
  run.document.emit("pointerdown", pointer(run.buttons[2]));
  run.document.emit("click", pointer(run.buttons[2]));
  assert.equal(run.finished.length, 1);
  assert.equal(rows(run.state, "thought_probe")[0].confidence_rating, 3);

  run.state.probeBlockCounter = 10;
  const check = checkNode.timeline[0];
  start(check);
  run.load(check);
  run.document.emit("click", pointer(run.buttons[0]));
  assert.equal(run.finished.length, 1, "a previous press cannot answer the next screen");
  run.document.emit("pointerdown", pointer(run.buttons[0]));
  run.setTime(1200);
  run.document.emit("click", pointer(run.buttons[0]));
  assert.equal(run.finished.length, 1, "a press made before activation stays ineligible");
  run.document.emit("pointermove", pointer(run.buttons[0], { clientX: 50 }));
  run.document.emit("click", pointer(run.buttons[0], { detail: 0 }));
  assert.equal(run.finished.length, 1, "keyboard-generated clicks cannot answer");
  run.document.emit("pointerdown", pointer(run.buttons[0], { clientX: 50 }));
  run.document.emit("click", pointer(run.buttons[0], { clientX: 50 }));
  assert.equal(run.finished.length, 2);
  assert.equal(run.finished[1].confidence_rating, undefined, "checks do not emit a genuine confidence rating");
  assert.equal(rows(run.state, "instructed_response")[0].instructed_response_correct, true);
  assert.equal(rows(run.state, "thought_probe")[0].confidence_rating, 3);
});
