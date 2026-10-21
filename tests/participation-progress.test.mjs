import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createParticipationProgress } from "../js/participation-progress.mjs";

const startedAt = "2026-10-21T12:00:00.000Z";
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

function visibilityDocument(initial = "visible") {
  const listeners = new Set();
  return {
    visibilityState: initial,
    addEventListener(event, callback) { assert.equal(event, "visibilitychange"); listeners.add(callback); },
    removeEventListener(event, callback) { assert.equal(event, "visibilitychange"); listeners.delete(callback); },
    change(state) { this.visibilityState = state; [...listeners].forEach(callback => callback()); },
    get listenerCount() { return listeners.size; }
  };
}

function harness(options = {}) {
  let time = 0;
  const uploads = [];
  const document = visibilityDocument();
  const tracker = createParticipationProgress({
    experimentId: "synthetic-experiment", subjectId: "participant-17", sessionId: "session-abc",
    runMode: "full", studyVersion: "synthetic-study-version", totalSections: 4,
    startedAtUtc: startedAt, startedMonotonicMs: 0,
    save(filename, text) { uploads.push({ filename, text }); return { save_state: "stored", http_status: 201, error: null }; },
    ...options,
    environment: {
      now: () => time,
      wallClock: () => new Date(Date.parse(startedAt) + time).toISOString(),
      document,
      ...options.environment
    }
  });
  return { tracker, uploads, document, at(value) { time = value; } };
}

function checkpoint(section = 1, extra = {}) {
  return {
    section, comparisonsCompleted: [90, 190, 280, 380][section - 1], comparisonsPlanned: 380,
    mrtProbesCompleted: section * 12, mrtProbesPlanned: 48,
    finalJudgmentsCompleted: 0, finalJudgmentsPlanned: 60,
    scheduledBreakSeconds: 0, pauseSeconds: 0,
    ...extra
  };
}

test("a checkpoint returns immediately with an immutable snapshot before a never-settling upload starts", async () => {
  let calls = 0;
  const run = harness({ save() { calls++; return new Promise(() => {}); } });
  run.at(12 * 60000 + 1500);
  const record = run.tracker.checkpoint(checkpoint());
  assert.equal(record instanceof Promise, false);
  assert.equal(Object.isFrozen(record), true);
  assert.equal(calls, 0, "the transport is invoked in a later microtask");
  assert.equal(record.elapsed_seconds, 721.5);
  assert.equal(record.elapsed_minutes, 12.025);
  assert.equal(record.checkpoint_at_utc, "2026-10-21T12:12:01.500Z");
  await nextTurn();
  assert.equal(calls, 1);
  assert.equal(run.tracker.statuses[0].save_state, "pending");
  assert.equal(run.tracker.statuses[0].upload_duration_ms, null);
  const second = run.tracker.checkpoint(checkpoint(2));
  assert.equal(second.sections_completed, 2, "another section is independent of an earlier pending upload");
  run.tracker.dispose();
});

test("four completed sections produce four separate files once, including when callers repeat a checkpoint", async () => {
  const run = harness();
  const originals = [];
  for (let section = 1; section <= 4; section++) {
    run.at(section * 20 * 60000);
    originals.push(run.tracker.checkpoint(checkpoint(section, { scheduledBreakSeconds: (section - 1) * 120 })));
    assert.equal(run.tracker.checkpoint(checkpoint(section)), originals.at(-1));
  }
  await nextTurn();
  assert.equal(run.uploads.length, 4);
  assert.equal(new Set(run.uploads.map(upload => upload.filename)).size, 4);
  assert.deepEqual(run.uploads.map(upload => upload.filename), [1, 2, 3, 4].map(section =>
    `Progress/Progress_full_participant-17_session-abc_section-0${section}.json`));
  assert.deepEqual(run.uploads.map(upload => JSON.parse(upload.text)), originals);
  assert.deepEqual(originals.map(record => record.primary_tasks_complete), [false, false, false, true]);
  assert.ok(originals.every(record => record.github_tasks_complete === false));
  assert.deepEqual(run.tracker.statuses.map(status => status.save_state), ["stored", "stored", "stored", "stored"]);
  const exposed = run.tracker.records;
  exposed.pop();
  assert.equal(run.tracker.records.length, 4);
  assert.ok(run.tracker.statuses.every(Object.isFrozen));
  run.tracker.dispose();
});

test("one short-mode checkpoint has its own mode and session name without claiming final judgments complete", async () => {
  const run = harness({ runMode: "test", totalSections: 1, sessionId: "a-new-session" });
  const record = run.tracker.checkpoint(checkpoint(1, {
    comparisonsCompleted: 4, comparisonsPlanned: 4, mrtProbesCompleted: 1,
    mrtProbesPlanned: 1, finalJudgmentsPlanned: 6
  }));
  await nextTurn();
  assert.equal(record.sections_planned, 1);
  assert.equal(record.primary_tasks_complete, true);
  assert.equal(record.github_tasks_complete, false);
  assert.equal(run.uploads.length, 1);
  assert.equal(run.uploads[0].filename, "Progress/Progress_test_participant-17_a-new-session_section-01.json");
  run.tracker.dispose();
});

test("progress payloads whitelist small metadata only and safe filenames keep IDs out of the directory path", async () => {
  const run = harness({ subjectId: "person / 17", sessionId: "../session?abc" });
  const record = run.tracker.checkpoint(checkpoint(1, {
    response: "PRIVATE RESPONSE", raw_data: new Array(100000).fill("PRIVATE RESPONSE"),
    id: "PRIVATE CREDIT NUMBER", surveyUrl: "https://example.test/private-survey"
  }));
  await nextTurn();
  assert.deepEqual(Object.keys(record).sort(), [
    "schema_version", "subject_id", "session_id", "run_mode", "study_version", "study_started_at_utc",
    "checkpoint_at_utc", "elapsed_seconds", "elapsed_minutes", "tab_visible_seconds", "tab_hidden_seconds",
    "sections_completed", "sections_planned", "calibration_comparisons_completed", "calibration_comparisons_planned",
    "mrt_probes_completed", "mrt_probes_planned", "final_judgments_completed", "final_judgments_planned",
    "scheduled_break_seconds_completed", "p_key_pause_seconds", "primary_tasks_complete", "github_tasks_complete"
  ].sort());
  assert.equal(record.schema_version, "fae-participation-v1");
  assert.equal(record.subject_id, "person / 17");
  assert.equal(record.session_id, "../session?abc");
  assert.equal(run.uploads[0].filename, "Progress/Progress_full_person_17___session_abc_section-01.json");
  assert.ok(Buffer.byteLength(run.uploads[0].text, "utf8") < 1500);
  assert.doesNotMatch(run.uploads[0].text, /PRIVATE|private-survey|synthetic-experiment/);
  run.tracker.dispose();
});

test("visibility changes accumulate the visible and hidden portions of elapsed time without recurring timers", () => {
  const run = harness({ environment: {
    setTimeout() { assert.fail("progress tracking must not start a timeout"); },
    setInterval() { assert.fail("progress tracking must not start an interval"); }
  } });
  assert.equal(run.document.listenerCount, 1);
  run.at(90000); run.document.change("hidden");
  run.at(150000); run.document.change("visible");
  run.at(210000);
  const first = run.tracker.checkpoint(checkpoint());
  assert.equal(first.elapsed_seconds, 210);
  assert.equal(first.tab_visible_seconds, 150);
  assert.equal(first.tab_hidden_seconds, 60);
  run.at(240000);
  const second = run.tracker.checkpoint(checkpoint(2));
  assert.equal(second.tab_visible_seconds, 180);
  assert.equal(second.tab_hidden_seconds, 60);
  const source = readFileSync(new URL("../js/participation-progress.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bset(?:Timeout|Interval)\s*\(/);
  run.tracker.dispose();
  assert.equal(run.document.listenerCount, 0);
});

test("unavailable or incomplete visibility measurements remain unknown rather than zero", () => {
  for (const document of [null, {}, { visibilityState: "visible" }, visibilityDocument("prerender")]) {
    const run = harness({ environment: { document } });
    run.at(10000);
    const record = run.tracker.checkpoint(checkpoint());
    assert.equal(record.tab_visible_seconds, null);
    assert.equal(record.tab_hidden_seconds, null);
    assert.equal(record.elapsed_seconds, 10);
    run.tracker.dispose();
  }
  const run = harness();
  run.at(1000); run.document.change("unavailable");
  run.at(2000);
  assert.equal(run.tracker.checkpoint(checkpoint()).tab_visible_seconds, null);
  run.tracker.dispose();
});

test("transport throws and rejected promises are isolated, counted once, and never retried", async () => {
  for (const save of [() => { throw new Error("offline"); }, () => Promise.reject(new Error("offline"))]) {
    let calls = 0;
    const run = harness({ save(...args) { calls++; return save(...args); } });
    const record = run.tracker.checkpoint(checkpoint());
    assert.equal(record.sections_completed, 1);
    await nextTurn();
    assert.equal(run.tracker.statuses[0].save_state, "unconfirmed");
    assert.equal(run.tracker.statuses[0].error, "offline");
    assert.equal(run.tracker.statuses[0].http_status, null);
    assert.equal(run.tracker.checkpoint(checkpoint()), record);
    await nextTurn();
    assert.equal(calls, 1);
    run.tracker.dispose();
  }
});

test("settled statuses keep only safe result fields and measure upload duration", async () => {
  let finish;
  const seen = [];
  const run = harness({
    save() { return new Promise(resolve => { finish = resolve; }); },
    onStatus(status) { seen.push(status); }
  });
  run.at(1000);
  run.tracker.checkpoint(checkpoint());
  await nextTurn();
  run.at(1213.5);
  finish({ save_state: "queued", http_status: 202, error: null, code: "CONTENTION",
    response_body: "private", receipt: { token: "private" }, filename: "wrong" });
  await nextTurn();
  const status = run.tracker.statuses[0];
  assert.equal(status.save_state, "queued");
  assert.equal(status.http_status, 202);
  assert.equal(status.error, null);
  assert.equal(status.code, "CONTENTION");
  assert.equal(status.upload_duration_ms, 213.5);
  assert.equal(status.filename, "Progress/Progress_full_participant-17_session-abc_section-01.json");
  assert.equal(Object.hasOwn(status, "response_body"), false);
  assert.equal(Object.hasOwn(status, "receipt"), false);
  assert.deepEqual(seen.map(value => value.save_state), ["pending", "queued"]);
  run.tracker.dispose();
});

test("malformed upload results and failing sync or async observer callbacks cannot affect the study", async () => {
  for (const result of [undefined, { ok: true }, new Proxy({}, { get() { throw new Error("bad status"); } })]) {
    const run = harness({
      save() { return result; },
      onRecord() { throw new Error("observer failed"); },
      onStatus() { return Promise.reject(new Error("async observer failed")); }
    });
    assert.doesNotThrow(() => run.tracker.checkpoint(checkpoint()));
    await nextTurn();
    assert.equal(run.tracker.records.length, 1);
    assert.equal(run.tracker.statuses[0].save_state, "unconfirmed");
    run.tracker.dispose();
  }
});

test("invalid or disabled checkpoints do not upload and final section requires completed planned counts", async () => {
  const run = harness();
  for (const input of [null, {}, checkpoint(0), checkpoint(5), checkpoint(1, { comparisonsCompleted: -1 }),
    checkpoint(1, { mrtProbesCompleted: 49 }), checkpoint(1, { pauseSeconds: NaN }),
    checkpoint(1, { scheduledBreakSeconds: -0.5 }), checkpoint(1, { comparisonsPlanned: "380" })]) {
    assert.equal(run.tracker.checkpoint(input), null);
  }
  assert.equal(run.tracker.records.length, 0);
  const incomplete = run.tracker.checkpoint(checkpoint(4, { mrtProbesCompleted: 47 }));
  assert.equal(incomplete.primary_tasks_complete, false);
  await nextTurn();
  assert.equal(run.uploads.length, 1);
  run.tracker.dispose();
  const disabled = harness({ enabled: false });
  assert.equal(disabled.tracker.checkpoint(checkpoint()), null);
  assert.equal(disabled.document.listenerCount, 0);
  assert.equal(disabled.uploads.length, 0);
  disabled.tracker.dispose();
});

test("dispose only removes observation without aborting in-flight saves or disabling explicit checkpoints", async () => {
  let finish;
  const run = harness({ save() { return new Promise(resolve => { finish = resolve; }); } });
  run.tracker.checkpoint(checkpoint());
  await nextTurn();
  run.tracker.dispose();
  run.tracker.dispose();
  assert.equal(run.document.listenerCount, 0);
  const afterDispose = run.tracker.checkpoint(checkpoint(2));
  assert.equal(afterDispose.sections_completed, 2);
  assert.equal(afterDispose.tab_visible_seconds, null);
  run.at(500);
  finish({ save_state: "stored", http_status: 201, error: null });
  await nextTurn();
  assert.equal(run.tracker.statuses[0].save_state, "stored");
  assert.equal(run.tracker.statuses[0].upload_duration_ms, 500);
});

test("a failed clock does not stop uploads or make elapsed time decrease", async () => {
  let value = 1000;
  const run = harness({ environment: {
    now() { if (value === null) throw new Error("clock unavailable"); return value; },
    wallClock() { throw new Error("wall clock unavailable"); }
  } });
  value = 5000;
  const first = run.tracker.checkpoint(checkpoint());
  value = 2000;
  const second = run.tracker.checkpoint(checkpoint(2));
  value = null;
  const third = run.tracker.checkpoint(checkpoint(3));
  assert.equal(first.elapsed_seconds, 5);
  assert.equal(second.elapsed_seconds, 5);
  assert.equal(third.elapsed_seconds, 5);
  assert.match(third.checkpoint_at_utc, /^\d{4}-\d\d-\d\dT/);
  await nextTurn();
  assert.equal(run.uploads.length, 3);
  run.tracker.dispose();
});
