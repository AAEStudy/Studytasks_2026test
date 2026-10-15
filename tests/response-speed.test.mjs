import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../js/response-controls.js", import.meta.url), "utf8");
const finalGroup = { reminderGroup: "final_judgment" };

function runtime() {
  const context = vm.createContext({
    document: { addEventListener() {}, removeEventListener() {} },
    window: { addEventListener() {}, removeEventListener() {} },
    jsPsychHtmlKeyboardResponse: {}
  });
  vm.runInContext(`${source}\nglobalThis.responses = StudyResponses; globalThis.settings = STUDY_RESPONSE_SETTINGS;`, context);
  return { ...context.responses, settings: context.settings };
}

function streak(responses, kind, options, rt = 100) {
  return Array.from({ length: 3 }, () => responses.recordSpeed(kind, rt, options)).at(-1);
}

test("fast responses use a strict 250 ms threshold and a same-kind three-response streak", () => {
  const responses = runtime();
  for (const rt of [250, 600, -1, NaN, Infinity, undefined, null, "100"]) {
    assert.equal(responses.recordSpeed("emotion_judgment", 100).fast_streak, 1);
    const result = responses.recordSpeed("emotion_judgment", rt);
    assert.equal(result.fast_response, false, `${String(rt)} is not a valid fast response`);
    assert.equal(result.fast_streak, 0);
    assert.equal(result.speed_reminder_requested, false);
  }
  assert.equal(responses.recordSpeed("emotion_judgment", 0).fast_response, true);
  assert.equal(responses.recordSpeed("emotion_judgment", 249.999).speed_reminder_requested, false);
  assert.equal(responses.recordSpeed("emotion_judgment", 100).speed_reminder_requested, true);
  assert.equal(responses.hasReminder("emotion_"), true);
});

test("default MRT and comparison warnings share the five-display cap without consuming it when requested", () => {
  const responses = runtime();
  assert.equal(streak(responses, "mrt_focus").speed_reminder_requested, true);
  assert.equal(streak(responses, "emotion_calibration_comparison").speed_reminder_requested, true);
  for (let index = 0; index < 5; index++) {
    assert.equal(responses.hasReminder("mrt_"), true);
    assert.equal(responses.hasReminder("emotion_"), true);
  }
  assert.deepEqual(Array.from(responses.takeReminder("mrt_")), ["mrt_focus"]);
  assert.equal(responses.hasReminder("emotion_"), true, "the other pending kind survives the first display");
  assert.deepEqual(Array.from(responses.takeReminder("emotion_")), ["emotion_calibration_comparison"]);
  assert.equal(responses.hasReminder("mrt_"), false);
  assert.equal(responses.hasReminder("emotion_"), false);
  for (let display = 2; display < responses.settings.maxSpeedReminders; display++) {
    const kind = display % 2 === 0 ? "mrt_basis" : "emotion_calibration_comparison";
    const prefix = kind.startsWith("mrt_") ? "mrt_" : "emotion_";
    assert.equal(streak(responses, kind).speed_reminder_requested, true);
    assert.deepEqual(Array.from(responses.takeReminder(prefix)), [kind]);
  }
  assert.equal(streak(responses, "emotion_calibration_comparison").speed_reminder_requested, false);
  assert.equal(streak(responses, "mrt_basis").speed_reminder_requested, false);
  assert.deepEqual(Array.from(responses.takeReminder("emotion_")), []);
});

test("multiple pending kinds shown together consume one warning and unmatched requests consume none", () => {
  const responses = runtime();
  streak(responses, "emotion_judgment");
  streak(responses, "emotion_confidence");
  assert.deepEqual(Array.from(responses.takeReminder("mrt_")), []);
  assert.deepEqual(Array.from(responses.takeReminder("emotion_")), ["emotion_judgment", "emotion_confidence"]);
  for (let display = 1; display < responses.settings.maxSpeedReminders; display++) {
    assert.equal(streak(responses, "mrt_focus").speed_reminder_requested, true);
    assert.deepEqual(Array.from(responses.takeReminder("mrt_")), ["mrt_focus"]);
  }
  assert.equal(streak(responses, "emotion_judgment").speed_reminder_requested, false);
});

test("exhausting all five general warnings leaves five independent final-judgment warnings", () => {
  const responses = runtime();
  for (let display = 0; display < responses.settings.maxSpeedReminders; display++) {
    assert.equal(streak(responses, "mrt_focus").speed_reminder_requested, true);
    assert.deepEqual(Array.from(responses.takeReminder("mrt_")), ["mrt_focus"]);
  }
  assert.equal(streak(responses, "emotion_calibration_comparison").speed_reminder_requested, false);
  for (let display = 0; display < responses.settings.maxSpeedReminders; display++) {
    const result = streak(responses, "emotion_judgment", finalGroup);
    assert.equal(result.speed_reminder_requested, true);
    assert.equal(result.speed_reminder_group, "final_judgment");
    assert.equal(responses.hasReminder("emotion_", finalGroup), true);
    assert.equal(responses.hasReminder("emotion_"), false);
    assert.deepEqual(Array.from(responses.takeReminder("emotion_", finalGroup)), ["emotion_judgment"]);
  }
  assert.equal(streak(responses, "emotion_judgment", finalGroup).speed_reminder_requested, false);
  assert.equal(responses.hasReminder("emotion_", finalGroup), false);
});

test("groups isolate streaks and pending warnings even for identical response kinds", () => {
  const responses = runtime();
  assert.equal(responses.recordSpeed("emotion_judgment", 100).fast_streak, 1);
  assert.equal(responses.recordSpeed("emotion_judgment", 100, finalGroup).fast_streak, 1);
  responses.recordSpeed("emotion_judgment", 600);
  assert.equal(responses.recordSpeed("emotion_judgment", 100, finalGroup).fast_streak, 2);
  assert.equal(responses.recordSpeed("emotion_judgment", 100, finalGroup).speed_reminder_requested, true);
  assert.equal(responses.hasReminder("emotion_"), false);
  assert.equal(responses.hasReminder("emotion_", finalGroup), true);
  assert.deepEqual(Array.from(responses.takeReminder("emotion_")), []);
  assert.equal(responses.hasReminder("emotion_", finalGroup), true);
  streak(responses, "emotion_judgment");
  responses.takeReminder("emotion_", finalGroup);
  assert.equal(responses.hasReminder("emotion_"), true, "displaying a final warning cannot clear a general pending warning");
});

test("600 ms confidence responses cannot interrupt a fast final type-1 judgment streak", () => {
  const responses = runtime();
  for (let index = 1; index <= 3; index++) {
    const judgment = responses.recordSpeed("emotion_judgment", 100, finalGroup);
    assert.equal(judgment.fast_streak, index);
    assert.equal(judgment.speed_reminder_requested, index === 3);
    const confidence = responses.recordSpeed("emotion_confidence", 600, finalGroup);
    assert.equal(confidence.fast_response, false);
    assert.equal(confidence.fast_streak, 0);
    assert.equal(responses.hasReminder("emotion_", finalGroup), index === 3);
  }
  assert.deepEqual(Array.from(responses.takeReminder("emotion_", finalGroup)), ["emotion_judgment"]);
});

test("reminder nodes consume warnings at display and record their group-local ordinal", () => {
  const responses = runtime();
  const shown = [];
  const node = responses.reminderTrial({}, kinds => shown.push(Array.from(kinds)), finalGroup);
  assert.equal(node.conditional_function(), false);
  for (let ordinal = 1; ordinal <= responses.settings.maxSpeedReminders; ordinal++) {
    streak(responses, "emotion_judgment", finalGroup);
    for (let inspection = 0; inspection < 5; inspection++) assert.equal(node.conditional_function(), true);
    const trial = { ...node.timeline[0], data: { ...node.timeline[0].data } };
    trial.on_start(trial);
    assert.equal(trial.data.event, "speed_reminder");
    assert.equal(trial.data.speed_reminder_group, "final_judgment");
    assert.equal(trial.data.reminder_number, ordinal);
    assert.deepEqual(Array.from(trial.data.reminder_kinds), ["emotion_judgment"]);
    assert.equal(node.conditional_function(), false);
  }
  assert.deepEqual(shown, Array.from({ length: responses.settings.maxSpeedReminders }, () => ["emotion_judgment"]));
  assert.equal(streak(responses, "emotion_judgment", finalGroup).speed_reminder_requested, false);
});
