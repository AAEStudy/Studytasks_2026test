import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import * as schedule from "../js/image-schedule.mjs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function eventTarget() {
  const handlers = new Map();
  return {
    addEventListener(type, callback) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(callback);
    },
    removeEventListener(type, callback) { handlers.get(type)?.delete(callback); },
    emit(type, event) { for (const callback of [...(handlers.get(type) || [])]) callback(event); },
    listenerCount: type => handlers.get(type)?.size || 0
  };
}

function fakeClock() {
  let now = 0, sequence = 0;
  const timers = new Map();
  const add = (callback, delay, interval = false) => {
    const id = ++sequence;
    timers.set(id, { callback, at: now + delay, interval: interval ? delay : 0 });
    return id;
  };
  return {
    now: () => now,
    setTimeout: (callback, delay) => add(callback, delay),
    setInterval: (callback, delay) => add(callback, delay, true),
    clear: id => timers.delete(id),
    pending: () => timers.size,
    advance(milliseconds) {
      const target = now + milliseconds;
      let executions = 0;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) break;
        assert.ok(++executions < 10000, "timer callbacks must settle");
        const [id, timer] = next;
        now = timer.at;
        if (timer.interval) timer.at += timer.interval;
        else timers.delete(id);
        timer.callback();
      }
      now = target;
    }
  };
}

function collection(records) {
  return { values: () => records,
    filter: criteria => collection(records.filter(row => Object.entries(criteria).every(([key, value]) => row[key] === value))) };
}

function runtime({ comparisonRemaining = 5, finalRemaining = 3 } = {}) {
  const clock = fakeClock(), document = eventTarget(), window = eventTarget(), display = eventTarget();
  Object.assign(window, { setTimeout: clock.setTimeout, setInterval: clock.setInterval,
    clearTimeout: clock.clear, clearInterval: clock.clear });
  const observers = new Set(), records = [];
  let currentTrial = null, responseOnset = 0, page = 0, pages = [], buttons = [];
  const pointer = { x: 0, y: 0 };
  const next = { disabled: false, textContent: "", closest: selector => selector === "#jspsych-instructions-next" ? next : null };
  const status = { textContent: "" };
  const section = { dataset: {}, textContent: "" };
  function updateSection() {
    section.dataset = {};
    const html = pages[page] || "";
    for (const [, attribute, value] of html.matchAll(/data-([\w-]+)="([^"]*)"/g)) {
      section.dataset[attribute.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    }
    section.textContent = html.replace(/<[^>]*>/g, "");
  }
  display.querySelector = selector => {
    if (selector === "#jspsych-instructions-next") return next;
    const attribute = selector.match(/^\[([^\]]+)\]$/)?.[1];
    if (attribute && (pages[page] || "").includes(attribute)) return attribute.includes("status") ? status : section;
    if (selector === ".emotion-instructions") return section;
    return null;
  };
  display.contains = element => element === next || buttons.includes(element);
  display.querySelectorAll = () => buttons;
  const parseButtons = html => {
    buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attributes, body]) => {
      const value = attributes.match(/data-study-response="([^"]+)"/)?.[1];
      const node = { dataset: { studyResponse: value }, textContent: body.replace(/<[^>]*>/g, ""),
        attributes: {}, setAttribute(name, content) { this.attributes[name] = content; },
        disabled: /\sdisabled(?:\s|=|$)/.test(attributes),
        closest: selector => selector === "[data-study-response]" && value !== undefined ? node : null };
      return node;
    });
  };
  const psych = {
    getDisplayElement: () => display,
    pluginAPI: { cancelAllKeyboardResponses() {}, clearAllTimeouts() {} },
    data: { get: () => collection(records) },
    finishTrial(response) {
      const data = { ...currentTrial.data, ...response };
      currentTrial.on_finish?.(data);
      records.push(data);
    }
  };
  class MutationObserver {
    constructor(callback) { this.callback = callback; }
    observe() { observers.add(this); }
    disconnect() { observers.delete(this); }
  }
  const context = vm.createContext({ ...schedule, console, document, window, MutationObserver,
    performance: { now: clock.now }, crypto: webcrypto, TextEncoder,
    fetch: async path => ({ ok: true, text: async () => read(path) }),
    jsPsychHtmlKeyboardResponse: {}, jsPsychImageKeyboardResponse: {}, jsPsychInstructions: {} });
  const source = read("metaemotion.js").replace(/^import .*\n/m, "").replace(/^export /gm, "");
  vm.runInContext(read("js/response-controls.js") + "\n" + source, context);
  const reviewSchedule = Array.from({ length: 20 }, (_, index) => ({ pic: `${1000 + index}.jpg`, schedule: {} }));
  const state = { subject: "CHECK", jsPsych: psych, nextImageTrialId: 0,
    replaysRemaining: comparisonRemaining, finalReplaysRemaining: finalRemaining,
    practicePairs: [{ p1: "1.jpg", p2: "2.jpg", cat: 0 }],
    calibrationPairs: [{ p1: "3.jpg", p2: "4.jpg", cat: 0 }, { p1: "5.jpg", p2: "6.jpg", cat: 0 }],
    calibrationTargetCount: 2, caliCursor: 0, scheduleMetadata: {}, reviewSchedule,
    metaSchedule: Array.from({ length: 60 }, (_, index) => ({ pic: `${1000 + index % 20}.jpg`, schedule: {} })) };
  const mouseEvent = (node, extra = {}) => ({ target: node, pointerType: "mouse", button: 0, detail: 1,
    clientX: pointer.x, clientY: pointer.y, preventDefault() {}, ...extra });
  return { context, clock, document, window, display, state, records, next, status,
    observers: () => observers.size,
    instruction(trial) {
      currentTrial = trial;
      pages = Array.from(trial.pages);
      page = 0;
      updateSection();
      trial.on_load();
    },
    setPage(index, notify = true) {
      page = index;
      updateSection();
      if (notify) for (const observer of [...observers]) observer.callback();
    },
    forward() {
      let prevented = false;
      display.emit("click", { target: next, preventDefault() { prevented = true; }, stopImmediatePropagation() {} });
      return !prevented && !next.disabled;
    },
    response(trial) {
      currentTrial = { ...trial, data: { ...trial.data } };
      responseOnset = clock.now();
      trial.on_start?.(currentTrial);
      parseButtons(currentTrial.stimulus);
      currentTrial.on_load?.();
      return currentTrial;
    },
    click(value) {
      const node = buttons.find(button => button.dataset.studyResponse === String(value));
      assert.ok(node, `response ${value} exists`);
      const event = mouseEvent(node);
      document.emit("pointerdown", event);
      document.emit("click", event);
    },
    key(value) {
      assert.ok(Array.isArray(currentTrial.choices) && currentTrial.choices.includes(value));
      psych.finishTrial({ response: value, rt: clock.now() - responseOnset });
    },
    move(x, y = 0) {
      pointer.x = x;
      pointer.y = y;
      document.emit("pointermove", mouseEvent(display));
    },
    press(value, extra = {}) { document.emit("pointerdown", mouseEvent(buttons.find(button => button.dataset.studyResponse === String(value)), extra)); },
    clickOnly(value, extra = {}) { document.emit("click", mouseEvent(buttons.find(button => button.dataset.studyResponse === String(value)), extra)); },
    button: value => buttons.find(button => button.dataset.studyResponse === String(value))
  };
}

function flatten(timeline) {
  return Array.from(timeline).flatMap(trial => [trial, ...(trial.timeline ? flatten(trial.timeline) : [])]);
}
function replayNode(timeline, phase) {
  return flatten(timeline).find(trial => trial.loop_function && trial.timeline?.some(child =>
    child.data?.event === (phase === "meta" ? "meta_type1" : "2ifc") && (phase === "meta" || child.data?.phase === phase)));
}
function replayResponse(node) { return node.timeline.at(-1); }

test("final instructions precede review, then a self-paced SPACE reminder separates review from judgments", () => {
  const run = runtime();
  const review = run.context.buildMetaEmotionReview(run.state, 20);
  const judgments = run.context.buildMetaEmotionMetaJ(run.state, 60);
  assert.equal(review[0].data.event, "meta_instructions");
  assert.equal(review[0].pages.length, 3);
  const images = flatten(review).filter(trial => trial.data?.event === "image" && trial.data?.phase === "review");
  assert.equal(images.length, 20);
  assert.ok(Array.from(review).slice(1, -1).every(trial => trial.data?.phase === "review"));
  const transition = review.at(-1);
  assert.equal(transition.data.event, "review_to_judgment_transition");
  assert.equal(transition.type, run.context.jsPsychHtmlKeyboardResponse);
  assert.deepEqual(Array.from(transition.choices), [" "]);
  assert.notEqual(transition.response_ends_trial, false);
  assert.ok(transition.trial_duration === undefined || transition.trial_duration === null,
    "the transition cannot time out or start final judgments automatically");
  const leaves = flatten([...review, ...judgments]).filter(trial => !trial.timeline);
  const lastReviewIndex = leaves.findLastIndex(trial => trial.data?.event === "image" && trial.data?.phase === "review");
  const firstFinalImageIndex = leaves.findIndex(trial => trial.data?.event === "image" && trial.data?.phase === "meta");
  assert.deepEqual(leaves.slice(lastReviewIndex + 1, firstFinalImageIndex), [transition]);
  const transitionText = transition.stimulus.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  assert.match(transitionText, /feeling.*whole picture set/i);
  assert.match(transitionText, /SPACE.*begin the final picture judgments/i);
  assert.doesNotMatch(transitionText, /important|full attention|effort|minutes|near the end|new variation/i);
  assert.equal(flatten(judgments).filter(trial => trial.pages || /instructions/.test(trial.data?.event || "")).length, 0);
  assert.equal(flatten(judgments).filter(trial => trial.data?.event === "meta_type1").length, 60);
  assert.equal(flatten(judgments).filter(trial => trial.data?.event === "meta_conf").length, 60);
  const first = flatten(judgments)[0];
  assert.ok(first.timeline, "the scored final task still starts with its first trial sequence");
  assert.equal(flatten(judgments).find(trial => trial.data?.event === "image").data.phase, "meta");
  assert.deepEqual(Array.from(run.state.reviewPresented), images.map(trial => trial.stimulus.split("/").at(-1)));
  run.response(transition);
  run.clock.advance(120000);
  assert.equal(run.records.length, 0, "the transition waits for an explicit SPACE response");
  run.key(" ");
  assert.equal(run.records.length, 1);
  assert.equal(run.records[0].event, "review_to_judgment_transition");
  assert.equal(run.state.practiceReplaysRemaining, 5);
  assert.equal(run.state.replaysRemaining, 5);
  assert.equal(run.state.finalReplaysRemaining, 3);
  const exported = run.context.exportMetaEmotion(run.state, run.state.jsPsych);
  assert.deepEqual({ ...exported.counts }, { practice: 0, calibration: 0, meta: 0 },
    "the new transition cannot become a scored trial");
});

test("the approximate final-part duration and attention request appear before variation instructions and before review", () => {
  const run = runtime();
  const review = run.context.buildMetaEmotionReview(run.state, 20);
  const page = review[0].pages[0].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  const variationStart = page.indexOf("In this part,");
  assert.ok(variationStart > 0);
  const preface = page.slice(0, variationStart);
  assert.match(preface, /near the end/i);
  assert.match(preface, /important part/i);
  assert.match(preface, /(?:about|approximately)\s+5[–-]7 minutes/i);
  assert.match(preface, /full attention and effort/i);
  assert.ok(review.indexOf(review[0]) < review.findIndex(trial => trial.data?.phase === "review"));
});

function exerciseGates(run, trial, durations) {
  run.instruction(trial);
  assert.equal(trial.allow_keys, false);
  assert.equal(run.forward(), false);
  run.clock.advance(durations[0] - 1);
  assert.equal(run.forward(), false);
  run.clock.advance(1);
  assert.equal(run.forward(), true);
  run.setPage(1, false);
  assert.equal(run.forward(), false, "a rapid second click must see the new page before its observer runs");
  run.clock.advance(4000);
  run.setPage(0);
  assert.equal(run.forward(), true, "returning to a completed page retains its reading time");
  run.clock.advance(40000);
  run.setPage(1, false);
  assert.equal(run.forward(), false, "time away from a page does not count as viewing it");
  run.clock.advance(durations[1] - 4000 - 1);
  assert.equal(run.forward(), false);
  run.clock.advance(1);
  assert.equal(run.forward(), true, "returning to a partly read page retains its prior viewing time");
  if (durations.length === 3) {
    run.setPage(2, false);
    assert.equal(run.forward(), false);
    run.clock.advance(durations[2] - 1);
    assert.equal(run.forward(), false);
    run.clock.advance(1);
    assert.equal(run.forward(), true);
  }
  trial.on_finish();
  assert.equal(run.clock.pending(), 0);
  assert.equal(run.observers(), 0);
  assert.equal(run.display.listenerCount("click"), 0);
}

test("final 20/20/15-second gates resist rapid clicks, preserve back-navigation time and clean up", () => {
  const run = runtime();
  const trial = run.context.buildMetaEmotionReview(run.state, 20)[0];
  exerciseGates(run, trial, [20000, 20000, 15000]);
  run.instruction(trial);
  assert.equal(run.forward(), false, "a new instructions run starts a new reading period");
  run.clock.advance(1000);
  trial.on_finish();
  assert.equal(run.clock.pending(), 0, "leaving a locked page also clears timers");
  assert.equal(run.observers(), 0);
  assert.equal(run.display.listenerCount("click"), 0);
});

test("comparison instructions retain independent 20/10-second page gates", () => {
  const run = runtime();
  const trial = run.context.buildMetaEmotionPractice(run.state)[0];
  exerciseGates(run, trial, [20000, 10000]);
});

test("final replays have an independent three-use cap and never consume comparison replays or add scored judgments", () => {
  const run = runtime();
  const timeline = run.context.buildMetaEmotionMetaJ(run.state, 1);
  const node = replayNode(timeline, "meta"), response = replayResponse(node);
  const confidence = flatten(timeline).find(trial => trial.data?.event === "meta_conf");
  assert.equal(run.state.replaysRemaining, 5);
  assert.equal(run.state.finalReplaysRemaining, 3);
  for (let remaining = 3; remaining > 0; remaining--) {
    run.response(response);
    assert.match(run.button("replay").textContent, new RegExp(`${remaining} remaining`));
    run.clock.advance(1);
    run.click("replay");
    assert.equal(node.loop_function(), true);
    assert.equal(run.state.finalReplaysRemaining, remaining - 1);
    assert.equal(run.state.replaysRemaining, 5);
  }
  run.response(response);
  assert.equal(run.button("replay").disabled, true);
  const recordCount = run.records.length;
  run.click("replay");
  assert.equal(run.records.length, recordCount, "disabled replay requests cannot finish a screen");
  assert.equal(run.state.replaysRemaining, 5);
  run.clock.advance(900);
  run.click("1");
  assert.equal(node.loop_function(), false);
  run.response(confidence);
  assert.equal(run.button("replay"), undefined, "confidence cannot replay an image");
  run.move(125);
  run.clock.advance(700);
  run.click("3");
  assert.equal(run.state.replaysRemaining, 5);
  assert.equal(run.state.finalReplaysRemaining, 0);
  assert.equal(run.records.filter(row => row.event === "replay_request").length, 3);
  assert.equal(run.records.filter(row => row.event === "meta_type1").length, 1);
  const finalRecord = run.records.find(row => row.event === "meta_conf");
  assert.equal(finalRecord.replay_count, 3);
  assert.equal(finalRecord.replay_requests.length, 3);
  assert.equal(finalRecord.replay_limit, 3);
  assert.ok(finalRecord.replay_requests.every(request => request.budget === "final"));
  assert.deepEqual(Array.from(finalRecord.replay_requests, request => request.remaining), [2, 1, 0]);
  assert.deepEqual(Array.from(finalRecord.replay_requests, request => request.replays_remaining), [2, 1, 0]);
  const exported = run.context.exportMetaEmotion(run.state, run.state.jsPsych, { session_id: "session-a" });
  assert.equal(exported.counts.meta, 1);
  const table = run.context.parseCSV(exported.metaJCsvText);
  assert.equal(table.length, 2);
  assert.deepEqual(Array.from(table[0]).slice(table[0].indexOf("session_id"), table[0].indexOf("session_id") + 6), ["session_id", "final_replay_limit", "final_replays_remaining",
    "certainty_min_ms", "certainty_min_move_px", "certainty_max_move_px"]);
  assert.equal(table[1][table[0].indexOf("final_replay_limit")], "3");
  assert.equal(table[1][table[0].indexOf("replay_limit")], "3");
  assert.equal(table[1][table[0].indexOf("final_replays_remaining")], "0");
  assert.equal(table[1][table[0].indexOf("certainty_min_ms")], "600");
  assert.equal(table[1][table[0].indexOf("certainty_min_move_px")], "100");
  assert.equal(table[1][table[0].indexOf("certainty_max_move_px")], "125");
  const nextNode = replayNode(run.context.buildMetaEmotionMetaJ(run.state, 1), "meta");
  run.response(replayResponse(nextNode));
  assert.equal(run.button("replay").disabled, true, "building another chunk cannot reset the final allowance");
  run.clock.advance(1);
  run.click("1");
  const comparison = replayNode(run.context.buildMetaEmotionCalibrationChunk(run.state, 1, 1), "calibration");
  run.response(replayResponse(comparison));
  assert.match(run.button("replay").textContent, /5 remaining/,
    "all comparison replays remain available after exhausting final replays");
  assert.equal(run.button("replay").disabled, false);
});

test("practice has its own persistent five-use budget and cannot consume formal replays", () => {
  const run = runtime();
  const practice = replayNode(run.context.buildMetaEmotionPractice(run.state), "practice");
  assert.equal(run.state.practiceReplaysRemaining, 5, "old states lazily receive the practice budget");
  for (let remaining = 5; remaining > 0; remaining--) {
    run.response(replayResponse(practice));
    assert.match(run.button("replay").textContent, new RegExp(`${remaining} remaining`));
    run.clock.advance(1);
    run.click("replay");
    assert.equal(run.state.practiceReplaysRemaining, remaining - 1);
    assert.equal(run.state.replaysRemaining, 5, "practice cannot consume formal replays");
    assert.equal(run.state.finalReplaysRemaining, 3);
  }
  run.response(replayResponse(practice));
  assert.match(run.button("replay").textContent, /0 remaining/);
  assert.equal(run.button("replay").disabled, true);
  const before = run.records.length;
  run.click("replay");
  assert.equal(run.records.length, before);
  run.clock.advance(1);
  run.key("1");
  const practiceRecord = run.records.find(row => row.event === "2ifc" && row.phase === "practice");
  assert.equal(practiceRecord.replays_remaining, 0);
  assert.equal(practiceRecord.replay_count, 5);
  assert.deepEqual(Array.from(practiceRecord.replay_requests, request => request.remaining), [4, 3, 2, 1, 0]);
  assert.ok(practiceRecord.replay_requests.every(request => request.budget === "practice"));
  assert.ok(practiceRecord.replay_requests.every(request => request.replays_remaining === request.remaining));

  const rebuiltPractice = replayNode(run.context.buildMetaEmotionPractice(run.state), "practice");
  run.response(replayResponse(rebuiltPractice));
  assert.equal(run.button("replay").disabled, true, "a new practice builder cannot reset its allowance");
  assert.match(run.button("replay").textContent, /0 remaining/);
  run.clock.advance(1);
  run.key("1");
  assert.equal(run.state.practiceReplaysRemaining, 0);
  assert.equal(run.state.replaysRemaining, 5);
  assert.equal(run.state.finalReplaysRemaining, 3);

  run.state.calibrationPairs.push({ p1: "7.jpg", p2: "8.jpg", cat: 0 });
  run.state.calibrationTargetCount = 3;
  for (let chunk = 1; chunk <= 2; chunk++) {
    const calibration = replayNode(run.context.buildMetaEmotionCalibrationChunk(run.state, 1, chunk), "calibration");
    const response = replayResponse(calibration);
    for (let use = 0; use < (chunk === 1 ? 3 : 2); use++) {
      run.response(response);
      assert.match(run.button("replay").textContent, new RegExp(`${(chunk === 1 ? 5 : 2) - use} remaining`));
      run.clock.advance(1);
      run.click("replay");
    }
    run.response(response);
    run.clock.advance(1);
    run.key("1");
    assert.equal(run.state.practiceReplaysRemaining, 0, "calibration cannot alter the practice budget");
    assert.equal(run.state.finalReplaysRemaining, 3, "calibration cannot consume the final-only cap");
  }
  assert.equal(run.state.replaysRemaining, 0);
  assert.equal(run.state.finalReplaysRemaining, 3);
  const exhaustedComparison = replayNode(run.context.buildMetaEmotionCalibrationChunk(run.state, 1, 3), "calibration");
  run.response(replayResponse(exhaustedComparison));
  assert.equal(run.button("replay").disabled, true, "another comparison chunk cannot reset an exhausted pool");
  assert.match(run.button("replay").textContent, /0 remaining/);
  run.clock.advance(1);
  run.key("1");
  const finalTimeline = run.context.buildMetaEmotionMetaJ(run.state, 1);
  const finalNode = replayNode(finalTimeline, "meta");
  run.response(replayResponse(finalNode));
  assert.match(run.button("replay").textContent, /3 remaining/, "all final replays remain available after exhausting comparison replays");
  run.clock.advance(1);
  run.click("replay");
  assert.equal(run.state.replaysRemaining, 0);
  assert.equal(run.state.finalReplaysRemaining, 2);
  run.response(replayResponse(finalNode));
  assert.match(run.button("replay").textContent, /2 remaining/);
  assert.equal(run.button("replay").disabled, false);
  run.clock.advance(1);
  run.click("1");
  run.response(flatten(finalTimeline).find(trial => trial.data?.event === "meta_conf"));
  run.move(125);
  run.clock.advance(600);
  run.click("3");
  assert.equal(run.state.practiceReplaysRemaining, 0);
  assert.equal(run.state.replaysRemaining, 0);
  assert.equal(run.state.finalReplaysRemaining, 2);
  const nextFinalTimeline = run.context.buildMetaEmotionMetaJ(run.state, 1);
  const nextFinal = replayNode(nextFinalTimeline, "meta");
  for (let remaining = 2; remaining > 0; remaining--) {
    run.response(replayResponse(nextFinal));
    assert.match(run.button("replay").textContent, new RegExp(`${remaining} remaining`),
      "another final chunk preserves the remaining final allowance");
    run.clock.advance(1);
    run.click("replay");
    assert.equal(run.state.replaysRemaining, 0);
  }
  run.response(replayResponse(nextFinal));
  assert.equal(run.button("replay").disabled, true);
  run.clock.advance(1);
  run.click("1");
  run.response(flatten(nextFinalTimeline).find(trial => trial.data?.event === "meta_conf"));
  run.move(250);
  run.clock.advance(600);
  run.click("3");

  const calRows = run.records.filter(row => row.event === "2ifc" && row.phase === "calibration");
  assert.deepEqual(calRows.map(row => row.replays_remaining), [2, 0, 0]);
  assert.ok(calRows.every(row => row.replay_limit === 5));
  assert.ok(calRows.every(row => row.replay_requests.every(request => request.budget === "comparison")));
  assert.ok(calRows.every(row => row.replay_requests.every(request => request.replays_remaining === request.remaining)));
  assert.deepEqual(Array.from(calRows[0].replay_requests, request => request.remaining), [4, 3, 2]);
  assert.deepEqual(Array.from(calRows[1].replay_requests, request => request.remaining), [1, 0]);
  const finalRecord = run.records.find(row => row.event === "meta_conf");
  assert.equal(finalRecord.replay_requests[0].budget, "final");
  assert.equal(finalRecord.replay_requests[0].remaining, 2);
  assert.equal(finalRecord.replay_requests[0].replays_remaining, 2);
  assert.equal(finalRecord.replay_limit, 3);
  const finalRecords = run.records.filter(row => row.event === "meta_conf");
  assert.deepEqual(finalRecords.map(row => row.replays_remaining), [2, 0]);
  assert.deepEqual(finalRecords.map(row => row.final_replays_remaining), [2, 0]);
  assert.equal(run.state.practiceReplaysRemaining, 0);
  assert.equal(run.state.replaysRemaining, 0);
  assert.equal(run.state.finalReplaysRemaining, 0);

  const exported = run.context.exportMetaEmotion(run.state, run.state.jsPsych, { session_id: "session-a" });
  const practiceCSV = run.context.parseCSV(exported.pracCsvText), calibrationCSV = run.context.parseCSV(exported.caliCsvText);
  assert.equal(practiceCSV[1][practiceCSV[0].indexOf("replays_remaining")], "0");
  const practiceRequests = JSON.parse(practiceCSV[1][practiceCSV[0].indexOf("replay_requests")]);
  assert.equal(practiceRequests.length, 5);
  assert.ok(practiceRequests.every(request => request.budget === "practice"));
  assert.equal(calibrationCSV[1][calibrationCSV[0].indexOf("replays_remaining")], "2");
  assert.equal(calibrationCSV[2][calibrationCSV[0].indexOf("replays_remaining")], "0");
  assert.equal(calibrationCSV[3][calibrationCSV[0].indexOf("replays_remaining")], "0");
  const finalCSV = run.context.parseCSV(exported.metaJCsvText);
  assert.equal(finalCSV[1][finalCSV[0].indexOf("replay_limit")], "3");
  assert.equal(finalCSV[1][finalCSV[0].indexOf("final_replays_remaining")], "2");
  assert.equal(finalCSV[2][finalCSV[0].indexOf("final_replays_remaining")], "0");
});

test("initialized sessions receive independent practice and formal allowances plus the final cap", async () => {
  const run = runtime();
  const state = await run.context.initMetaEmotion({ subject: "CHECK", jsPsych: run.state.jsPsych, imageScheduleSeed: 20261014 });
  assert.equal(state.replaysRemaining, 5);
  assert.equal(state.practiceReplaysRemaining, 5);
  assert.equal(state.finalReplaysRemaining, 3);
});

test("each final confidence question requires 100px of new movement, 600ms and an eligible fresh press", () => {
  const run = runtime();
  const timeline = run.context.buildMetaEmotionMetaJ(run.state, 3);
  const trials = Array.from(timeline);
  const prepare = index => {
    const group = trials[index];
    const viewing = replayNode([group], "meta"), judgment = replayResponse(viewing);
    run.response(judgment);
    assert.equal(run.button("1").disabled, false, "Higher/Lower remains ungated");
    run.clock.advance(1);
    run.click("1");
    const confidence = flatten([group]).find(trial => trial.data?.event === "meta_conf");
    assert.equal(confidence.choices, "NO_KEYS");
    run.response(confidence);
    return confidence;
  };
  prepare(0);
  run.clock.advance(2000);
  run.click("3");
  assert.equal(run.records.length, 1, "waiting without moving cannot answer confidence");
  run.move(20);
  run.click("3");
  assert.equal(run.records.length, 1, "the old 20-pixel threshold cannot answer");
  run.move(99);
  run.click("3");
  assert.equal(run.records.length, 1, "movement below 100 pixels cannot answer");
  run.move(125);
  run.click("3");
  assert.equal(run.records.length, 2);
  assert.equal(run.records[1].certainty_min_ms, 600);
  assert.equal(run.records[1].certainty_min_move_px, 100);
  assert.equal(run.records[1].certainty_max_move_px, 125);

  prepare(1);
  run.clock.advance(1000);
  run.click("3");
  assert.equal(run.records.length, 3, "the previous question's movement cannot unlock the next question");
  run.move(224);
  run.click("3");
  assert.equal(run.records.length, 3);
  run.move(225);
  run.click("3");
  assert.equal(run.records.length, 4);
  assert.equal(run.records[3].certainty_max_move_px, 100);

  prepare(2);
  run.move(325);
  run.press("3");
  run.clock.advance(600);
  run.clickOnly("3");
  assert.equal(run.records.length, 5, "a press begun before 600ms cannot become eligible while held");
  run.press("3");
  run.clickOnly("3", { detail: 0 });
  assert.equal(run.records.length, 5, "keyboard-generated clicks cannot answer");
  run.click("3");
  assert.equal(run.records.length, 6);
  assert.equal(run.state.replaysRemaining, 5, "ordinary judgments and confidence do not consume replay allowance");
  assert.equal(run.state.finalReplaysRemaining, 3);
  assert.equal(run.clock.pending(), 0, "completed confidence questions clear their timers");
  assert.equal(run.document.listenerCount("click"), 0);
  assert.equal(run.document.listenerCount("pointerdown"), 1, "only the shared cursor tracker remains");
});

test("three final checks accept fresh stationary clicks after 600ms and append data only to the preceding scored row", () => {
  const run = runtime();
  const timeline = run.context.buildMetaEmotionMetaJ(run.state, 60);
  const steps = flatten(timeline).filter(trial => ["meta_type1", "meta_conf", "meta_instructed_response"].includes(trial.data?.event));
  assert.equal(steps.filter(trial => trial.data.event === "meta_type1").length, 60);
  assert.equal(steps.filter(trial => trial.data.event === "meta_conf").length, 60);
  assert.equal(steps.filter(trial => trial.data.event === "meta_instructed_response").length, 3);
  const leaves = flatten(timeline).filter(trial => !trial.timeline);
  let completedPairs = 0;
  for (const [index, trial] of leaves.entries()) {
    if (trial.data?.event === "meta_conf" && ++completedPairs % 20 === 0) {
      assert.equal(leaves[index + 1].data.event, "meta_instructed_response",
        "the check is the next question, without a blank or other intervening screen");
    }
  }
  assert.equal(flatten(run.context.buildMetaEmotionPractice(run.state)).filter(trial => trial.data?.event === "meta_instructed_response").length, 0);

  let judgments = 0, x = 0, checkIndex = 0;
  for (const trial of steps) {
    const live = run.response(trial);
    if (trial.data.event === "meta_type1") {
      run.clock.advance(1);
      run.click("1");
    } else if (trial.data.event === "meta_conf") {
      run.move(x += 125);
      run.clock.advance(600);
      run.click("4");
      judgments++;
    } else {
      checkIndex++;
      assert.equal(judgments, checkIndex * 20, "checks occur only after complete judgment-confidence pairs at phase thirds");
      assert.equal(live.data.presentation, "confidence_options");
      assert.equal(live.data.after_meta_trial, judgments);
      const expected = ((checkIndex - 1) % 4) + 1;
      assert.equal(Number(live.data.expected_response), expected);
      assert.match(live.stimulus, /<p>Click your answer\.<\/p>/);
      assert.doesNotMatch(live.stimulus, /Move the mouse/i);
      const before = run.records.length;
      if (checkIndex === 1) {
        run.press(expected);
        run.clock.advance(599);
        run.clickOnly(expected);
        assert.equal(run.records.length, before, "a premature held press cannot answer a final check");
        run.click(expected);
        assert.equal(run.records.length, before, "clicks before 600ms are rejected");
        run.press(expected);
        run.clock.advance(1);
        run.clickOnly(expected);
        assert.equal(run.records.length, before, "a press begun before activation cannot become eligible while held");
        run.press(expected);
        run.clickOnly(expected, { detail: 2 });
        assert.equal(run.records.length, before, "the second click of a double-click cannot answer");
        run.press(expected);
        run.clickOnly(expected, { detail: 0 });
        assert.equal(run.records.length, before, "keyboard-generated clicks cannot answer");
        run.press(expected, { button: 2 });
        run.clickOnly(expected, { button: 2 });
        assert.equal(run.records.length, before, "a fresh primary mouse press is required");
        run.click(expected);
      } else {
        run.clock.advance(600);
        run.click(checkIndex === 2 ? expected % 4 + 1 : expected);
      }
      assert.equal(run.records.length, before + 1, "a new stationary click is accepted after 600ms");
    }
  }
  const confidenceRows = run.records.filter(row => row.event === "meta_conf");
  const checkRows = run.records.filter(row => row.event === "meta_instructed_response");
  assert.equal(confidenceRows.length, 60);
  assert.equal(checkRows.length, 3);
  assert.equal(run.state.replaysRemaining, 5, "confidence questions and checks cannot consume formal replays");
  assert.equal(run.state.finalReplaysRemaining, 3, "checks cannot consume the final replay cap");
  assert.ok(confidenceRows.every(row => row.conf_key === "4" && row.confidence_label === "Very confident"));
  assert.ok(checkRows.every(row => row.conf_key === undefined && row.type1_key === undefined));
  assert.ok(checkRows.every(row => row.certainty_min_ms === 600 && row.certainty_min_move_px === 0 && row.certainty_max_move_px === 0));
  for (const [index, row] of confidenceRows.entries()) {
    const expectedId = (index + 1) % 20 === 0 ? (index + 1) / 20 : undefined;
    assert.equal(row.final_check_id, expectedId);
    if (expectedId !== undefined) {
      assert.equal(row.final_check_after_trial, index + 1);
      assert.equal(row.final_check_presentation, "confidence_options");
      assert.equal(row.final_check_correct, expectedId !== 2);
      assert.equal(row.final_check_min_ms, 600);
      assert.equal(row.final_check_min_move_px, 0);
      assert.equal(row.final_check_max_move_px, 0);
      assert.ok(row.final_check_rt_ms >= 600);
    }
  }
  const out = run.context.exportMetaEmotion(run.state, run.state.jsPsych, { session_id: "session-a" });
  assert.equal(out.counts.meta, 60);
  const table = run.context.parseCSV(out.metaJCsvText), [header] = table;
  assert.equal(table.length, 61, "checks never create additional scored meta-emotion rows");
  assert.ok(header.indexOf("final_check_id") > header.indexOf("session_id"));
  assert.equal(table[20][header.indexOf("final_check_id")], "1");
  assert.equal(table[20][header.indexOf("final_check_min_ms")], "600");
  assert.equal(table[20][header.indexOf("final_check_min_move_px")], "0");
  assert.equal(table[20][header.indexOf("final_check_max_move_px")], "0");
  assert.equal(table[40][header.indexOf("final_check_correct")], "false");
  assert.equal(table[40][header.indexOf("confidence")], "4", "check choices cannot overwrite actual confidence");
  assert.equal(table[60][header.indexOf("final_check_id")], "3");
});

test("calibration checks use the same 1/2 keys at phase quarters across chunks", () => {
  const run = runtime();
  const practice = flatten(run.context.buildMetaEmotionPractice(run.state)).find(trial => trial.data?.event === "2ifc");
  run.response(practice);
  run.clock.advance(1);
  run.key("1");
  run.state.calibrationPairs = Array.from({ length: 25 }, (_, index) => ({
    p1: `${2000 + index * 2}.jpg`, p2: `${2001 + index * 2}.jpg`, cat: 0,
    schedule: { schedule_position: index + 1 }
  }));
  run.state.calibrationTargetCount = 25;
  const chunks = [7, 6, 8, 4].map((size, index) => run.context.buildMetaEmotionCalibrationChunk(run.state, size, index + 1));
  const steps = chunks.flatMap(chunk => flatten(chunk)).filter(trial =>
    trial.data?.event === "2ifc" || trial.data?.event === "calibration_instructed_response");
  const checkpoints = [7, 13, 19, 25];
  assert.equal(steps.filter(trial => trial.data.event === "2ifc").length, 25);
  assert.equal(steps.filter(trial => trial.data.event === "calibration_instructed_response").length, 4);
  const leaves = chunks.flatMap(chunk => flatten(chunk)).filter(trial => !trial.timeline);
  let trialNumber = 0;
  for (const [index, trial] of leaves.entries()) {
    if (trial.data?.event === "2ifc" && checkpoints.includes(++trialNumber)) {
      assert.equal(leaves[index + 1].data.event, "calibration_instructed_response",
        "the check immediately follows its quarter checkpoint as the second question");
    }
  }
  let comparisons = 0, checks = 0;
  for (const trial of steps) {
    const live = run.response(trial);
    if (trial.data.event === "2ifc") {
      run.clock.advance(1);
      run.key("1");
      comparisons++;
    } else {
      checks++;
      assert.equal(comparisons, checkpoints[checks - 1], "practice and chunk boundaries cannot shift the phase-quarter checkpoints");
      assert.equal(live.data.after_calibration_trial, comparisons);
      assert.equal(live.data.check_id, checks);
      assert.deepEqual(Array.from(live.choices), ["1", "2"]);
      assert.equal(run.button("replay"), undefined, "calibration checks do not show a replay button");
      const expected = checks % 2 === 1 ? "1" : "2";
      assert.equal(String(live.data.expected_response), expected);
      const paragraphs = [...live.stimulus.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)]
        .map(([, html]) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
      assert.match(paragraphs[0], /please select/i);
      assert.deepEqual(paragraphs[0].match(/\b[12]\b/g), [expected], "the check requests the expected numeric key directly");
      assert.match(paragraphs[1], /Press\s+1\s+or\s+2\s+to indicate your response\./i);
      assert.doesNotMatch(paragraphs.join(" "), /\b(?:FIRST|SECOND|picture|image)\b/i,
        "the check and its hint must not ask participants to choose a picture");
      run.clock.advance(1);
      run.key(checks === 2 ? "1" : expected);
    }
  }
  const comparisonsRows = run.records.filter(row => row.event === "2ifc" && row.phase === "calibration");
  const checkRows = run.records.filter(row => row.event === "calibration_instructed_response");
  assert.equal(comparisonsRows.length, 25);
  assert.equal(checkRows.length, 4);
  assert.equal(run.state.replaysRemaining, 5, "calibration checks cannot consume formal replays");
  assert.equal(run.state.practiceReplaysRemaining, 5);
  assert.equal(run.records.filter(row => row.event === "2ifc" && row.phase === "practice").length, 1);
  assert.ok(checkRows.every(row => row.choice_key === undefined), "checks cannot masquerade as scored comparisons");
  for (const [index, row] of comparisonsRows.entries()) {
    const checkpointIndex = checkpoints.indexOf(index + 1);
    const checkId = checkpointIndex < 0 ? undefined : checkpointIndex + 1;
    assert.equal(row.cal_check_id, checkId);
    assert.equal(row.choice_key, "1");
    if (checkId !== undefined) {
      assert.equal(row.cal_check_after_trial, index + 1);
      assert.equal(row.cal_check_correct, checkId !== 2);
      assert.equal(row.cal_check_rt_ms, 1, "keyboard response checks need no confidence delay or mouse movement");
    }
  }
  const exported = run.context.exportMetaEmotion(run.state, run.state.jsPsych, { session_id: "session-a" });
  assert.equal(exported.counts.calibration, 25);
  assert.equal(exported.counts.practice, 1);
  const table = run.context.parseCSV(exported.caliCsvText), [header] = table;
  assert.equal(table.length, 26);
  assert.ok(header.indexOf("cal_check_id") > header.indexOf("session_id"));
  assert.equal(table[7][header.indexOf("cal_check_id")], "1");
  assert.equal(table[13][header.indexOf("cal_check_id")], "2");
  assert.equal(table[13][header.indexOf("cal_check_correct")], "false");
  assert.equal(table[13][header.indexOf("rawchoice")], "1");
  assert.equal(table[19][header.indexOf("cal_check_id")], "3");
  assert.equal(table[25][header.indexOf("cal_check_id")], "4");
  assert.equal(table[6][header.indexOf("cal_check_id")], "");
  assert.equal(table[8][header.indexOf("cal_check_id")], "");
});

test("full and shortened calibration schedules retain four distinct global quarter checkpoints", () => {
  for (const [total, expected] of [[380, [95, 190, 285, 380]], [6, [2, 3, 5, 6]], [2, [1, 2]]]) {
    const run = runtime();
    run.state.calibrationPairs = Array.from({ length: total }, (_, index) => ({
      p1: `${2000 + index * 2}.jpg`, p2: `${2001 + index * 2}.jpg`, cat: 0, schedule: {}
    }));
    run.state.calibrationTargetCount = total;
    const built = [];
    while (run.state.caliCursor < total) built.push(...run.context.buildMetaEmotionCalibrationChunk(run.state, 10, built.length + 1));
    const checks = flatten(built).filter(trial => trial.data?.event === "calibration_instructed_response");
    assert.deepEqual(checks.map(trial => trial.data.after_calibration_trial), expected);
    assert.deepEqual(checks.map(trial => trial.data.check_id), expected.map((_, index) => index + 1));
    assert.equal(flatten(built).filter(trial => trial.data?.event === "2ifc").length, total);
  }
});

test("final judgment reminders still appear after earlier reminders are exhausted and are saved after the completed pair", () => {
  const run = runtime();
  run.state.practicePairs = Array.from({ length: 15 }, (_, index) => ({
    p1: `${3000 + index * 2}.jpg`, p2: `${3001 + index * 2}.jpg`, cat: 0
  }));
  const reminderIn = group => Array.from(group.timeline).find(trial => trial.timeline?.[0]?.data?.event === "speed_reminder");
  const practice = run.context.buildMetaEmotionPractice(run.state);
  const practiceGroups = Array.from(practice).filter(trial => trial.timeline && flatten([trial]).some(child => child.data?.event === "2ifc"));
  for (const group of practiceGroups) {
    run.response(flatten([group]).find(trial => trial.data?.event === "2ifc"));
    run.clock.advance(1);
    run.key("1");
    const reminder = reminderIn(group);
    if (reminder.conditional_function()) {
      run.response(reminder.timeline[0]);
      run.clock.advance(1);
      run.click("continue");
    }
  }
  const earlierReminders = run.records.filter(row => row.event === "speed_reminder");
  assert.equal(earlierReminders.length, 5);
  assert.ok(earlierReminders.every(row => row.speed_reminder_group === "general"));

  const finalGroups = Array.from(run.context.buildMetaEmotionMetaJ(run.state, 60)).slice(0, 3);
  let x = 0;
  for (const [index, group] of finalGroups.entries()) {
    const judgment = flatten([group]).find(trial => trial.data?.event === "meta_type1");
    const confidence = flatten([group]).find(trial => trial.data?.event === "meta_conf");
    const reminder = reminderIn(group);
    assert.ok(group.timeline.indexOf(reminder) > group.timeline.indexOf(confidence));
    run.response(judgment);
    run.clock.advance(1);
    run.click("1");
    assert.equal(run.records.filter(row => row.event === "speed_reminder" && row.speed_reminder_group === "final_judgment").length, 0,
      "a pending warning cannot interrupt a judgment-confidence pair");
    run.response(confidence);
    run.move(x += 125);
    run.clock.advance(600);
    run.click("3");
    assert.equal(reminder.conditional_function(), index === 2);
    if (reminder.conditional_function()) {
      run.response(reminder.timeline[0]);
      run.clock.advance(1);
      run.click("continue");
    }
  }
  const finalReminders = run.records.filter(row => row.event === "speed_reminder" && row.speed_reminder_group === "final_judgment");
  assert.equal(finalReminders.length, 1, "earlier reminders cannot exhaust the final phase allowance");
  const confidences = run.records.filter(row => row.event === "meta_conf");
  assert.equal(confidences.length, 3);
  assert.ok(confidences.every(row => row.rt === 600 && row.type1_fast === true && row.fast_response === false));
  assert.equal(confidences[2].speed_reminder_shown, true);
  assert.equal(confidences[2].speed_reminder_group, "final_judgment");
  assert.equal(confidences[2].speed_reminder_kinds, "emotion_judgment");
  assert.equal(run.state.practiceReplaysRemaining, 5);
  assert.equal(run.state.replaysRemaining, 5);
  assert.equal(run.state.finalReplaysRemaining, 3);
  const exported = run.context.exportMetaEmotion(run.state, run.state.jsPsych, { session_id: "session-a" });
  const table = run.context.parseCSV(exported.metaJCsvText), [header] = table;
  assert.equal(table.length, 4);
  assert.equal(header.at(-1), "speed_reminder_group", "the new group field follows all existing export columns");
  assert.equal(table[3][header.indexOf("speed_reminder_shown")], "true");
  assert.equal(table[3][header.indexOf("speed_reminder_group")], "final_judgment");
  assert.equal(table[3][header.indexOf("final_replay_limit")], "3");
});
