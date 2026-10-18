import test from "node:test";
import assert from "node:assert/strict";
import { splitStudyExports, restoreWideExports } from "../js/analysis-exports.mjs";

const mrtCore = ["subject", "trial", "task", "trial_num", "RT_from_metronome", "omission", "performance_rating", "probe1_rt", "probe2_rt", "confidence_rating", "pause_time", "break_time", "instructed_response", "instructed_response_expected", "instructed_response_correct", "instructed_response_rt_ms", "confidence_label", "main_basis", "probe3_rt"];
const comparisonCore = ["subject", "systemtime", "pic1", "pic2", "category", "rawchoice", "picchoice", "RT"];
const judgmentCore = ["subject", "systemtime", "pic", "higherlower", "firstRT", "confidence", "secondRT"];
const calCheck = ["cal_check_id", "cal_check_after_trial", "cal_check_expected", "cal_check_response", "cal_check_correct", "cal_check_rt_ms"];
const finalCheck = ["final_check_id", "final_check_after_trial", "final_check_expected", "final_check_response", "final_check_correct", "final_check_rt_ms"];
const session = { session_id: "session-雪", run_mode: "test", configured_tasks_complete: "true", full_protocol_complete: "false", export_schema_version: "fae-export-v2", study_version: "study-wide" };
const technical = ["row_index", "phase", "chunk", "trial_index", ...Object.keys(session), "certainty_min_ms", "certainty_min_move_px", "replay_requests", "schedule_version", "schedule_position", "schedule_source_sha256"];

function table(headers, rows, delimiter = ",") {
  const cell = value => {
    const text = value === undefined || value === null ? "" : String(value);
    return text.includes(delimiter) || /["\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [headers, ...rows.map(row => headers.map(header => row[header]))].map(row => row.map(cell).join(delimiter)).join("\n") + "\n";
}
function fixture(count = 2) {
  const rows = Array.from({ length: count }, (_, index) => ({
    subject: "SID-雪", trial: index + 1, task: "thought_probe", trial_num: index + 1,
    RT_from_metronome: index ? "-0.000" : 0, omission: false, performance_rating: 2,
    probe1_rt: 700, probe2_rt: 800, confidence_rating: 3, pause_time: 0, break_time: 0,
    instructed_response: "Confident", instructed_response_expected: 2, instructed_response_correct: false,
    instructed_response_rt_ms: 0, confidence_label: 'Confident, "really"',
    main_basis: 'feeling\t雪\n"quoted"', probe3_rt: 900,
    probe_order: "focus,basis,confidence", basis_display_order: "memory,feeling,other", basis_layout: "horizontal",
    probe1_fast: false, probe3_fast: false, speed_reminder_shown: false,
    systemtime: 1000 + index, pic1: 10 + index, pic2: 20, category: "", rawchoice: 1, picchoice: 10 + index,
    RT: index ? "0.000" : 0.7, pic: 10 + index, higherlower: 1, firstRT: 0.7, confidence: 3, secondRT: 0.8,
    cal_check_id: index + 1, cal_check_after_trial: index + 1, cal_check_expected: 2,
    cal_check_response: 1, cal_check_correct: false, cal_check_rt_ms: 0,
    final_check_id: index + 1, final_check_after_trial: index + 1, final_check_expected: 2,
    final_check_response: 1, final_check_correct: false, final_check_rt_ms: 0,
    replay_count: 0, fast_response: false, type1_fast: false,
    row_index: index + 1, phase: "main", chunk: 1, trial_index: 20 + index, ...session,
    certainty_min_ms: 600, certainty_min_move_px: 100,
    replay_requests: index ? '[]' : '[{"path":"a,b\\\"雪.jpg","note":"first\\nsecond"}]\r\nline two',
    schedule_version: "stable-schedule", schedule_position: index + 1,
    schedule_source_sha256: "a".repeat(64)
  }));
  return {
    mrtTsv: table([...mrtCore, "probe_order", "basis_display_order", "basis_layout", "probe1_fast", "probe3_fast", "speed_reminder_shown", ...technical], rows, "\t"),
    pracCsvText: table([...comparisonCore, "replay_count", "fast_response", "speed_reminder_shown", ...technical], rows),
    caliCsvText: table([...comparisonCore, ...calCheck, "replay_count", "fast_response", "speed_reminder_shown", ...technical], rows),
    metaJCsvText: table([...judgmentCore, ...finalCheck, "confidence_label", "replay_count", "type1_fast", "fast_response", "speed_reminder_shown", ...technical], rows)
  };
}

test("analysis files put checks immediately after original outcomes and diagnostics preserve every original cell", () => {
  const original = fixture();
  const outputs = splitStudyExports(original, { export_schema_version: "fae-export-v3" }, { mrt: "mrt.tsv", metaCalibration: "cal.csv" });
  const diagnostics = JSON.parse(outputs.diagnosticsJsonText);
  assert.equal(diagnostics.subject, "SID-雪");
  assert.equal(diagnostics.session_id, session.session_id);
  assert.equal(diagnostics.export_schema_version, "fae-export-v3");
  assert.deepEqual(diagnostics.datasets.metaCalibration.analysis_columns.slice(0, 14), [...comparisonCore, ...calCheck]);
  assert.deepEqual(diagnostics.datasets.metaJudgment.analysis_columns.slice(0, 13), [...judgmentCore, ...finalCheck]);
  assert.deepEqual(diagnostics.datasets.mrt.analysis_columns.slice(0, 19), mrtCore);
  assert.deepEqual(diagnostics.datasets.metaPractice.analysis_columns.slice(-9), ["row_index", "phase", "chunk", "trial_index", "session_id", "run_mode", "configured_tasks_complete", "full_protocol_complete", "export_schema_version"]);
  assert.equal(diagnostics.datasets.mrt.filename, "mrt.tsv");
  assert.equal(diagnostics.datasets.metaCalibration.filename, "cal.csv");
  assert.deepEqual(restoreWideExports(outputs, outputs.diagnosticsJsonText), original);
  for (const [key, core] of [["mrt", mrtCore], ["metaPractice", comparisonCore], ["metaCalibration", comparisonCore], ["metaJudgment", judgmentCore]]) {
    const saved = diagnostics.datasets[key];
    assert.equal(saved.rows.length, 2);
    assert.deepEqual(saved.columns, ["row_index", "replay_requests", "schedule_position"]);
    assert.equal(saved.constants.certainty_min_ms, "600");
    assert.equal(saved.session_columns.study_version, "study_version");
    assert.equal(saved.session_columns.export_schema_version, "original_values.export_schema_version");
    for (const column of core) {
      assert.ok(!saved.columns.includes(column), `${key}.${column} must not repeat an outcome`);
      assert.ok(!Object.hasOwn(saved.constants, column), `${key}.${column} must not repeat a constant outcome`);
    }
  }
  assert.equal(diagnostics.session.original_values.export_schema_version, "fae-export-v2");
  assert.equal(outputs.caliCsvText.includes("false,0,0,false,false"), true);
});

test("quoted tabs, commas, multiline Unicode, false, zero and negative-zero text survive repeated recovery", () => {
  const original = fixture();
  original.mrtTsv = "\uFEFF" + original.mrtTsv;
  const outputs = splitStudyExports(original);
  const recovered = restoreWideExports(outputs, outputs.diagnosticsJsonText);
  assert.deepEqual(recovered, original);
  assert.match(outputs.mrtTsv, /"feeling\t雪\n""quoted"""/u);
  assert.match(outputs.mrtTsv, /-0\.000/u);
  assert.match(outputs.metaJCsvText, /"Confident, ""really"""/u);
  const again = splitStudyExports(recovered);
  assert.deepEqual(restoreWideExports(again, again.diagnosticsJsonText), original);
});

test("primary values remain the single source of original outcomes during recovery", () => {
  const original = fixture();
  const outputs = splitStudyExports(original);
  const edited = { ...outputs, caliCsvText: outputs.caliCsvText.replace(",0.7,1,1,2,1,false,0,", ",0.9,1,1,2,1,false,0,") };
  assert.notEqual(edited.caliCsvText, outputs.caliCsvText);
  const recovered = restoreWideExports(edited, outputs.diagnosticsJsonText);
  assert.equal(recovered.caliCsvText, original.caliCsvText.replace(",0.7,1,1,2,1,false,0,", ",0.9,1,1,2,1,false,0,"));
});

test("headers without rows retain original schemas and optional absent fields stay absent", () => {
  const original = {
    mrtTsv: table(mrtCore, [], "\t"),
    pracCsvText: table(comparisonCore, []),
    caliCsvText: table(comparisonCore, []),
    metaJCsvText: table(judgmentCore, [])
  };
  const outputs = splitStudyExports(original, { session_id: "empty-session", export_schema_version: "fae-export-v3" });
  assert.deepEqual(restoreWideExports(outputs, outputs.diagnosticsJsonText), original);
  assert.deepEqual(JSON.parse(outputs.diagnosticsJsonText).datasets.metaCalibration.analysis_columns,
    [...comparisonCore, "row_index", "session_id", "export_schema_version"]);
});

test("source row indices are stable join keys and absent row indices are supplied", () => {
  const original = fixture();
  const rows = [{ subject: "SID", systemtime: "0", pic1: "10", pic2: "20", category: "", rawchoice: "1", picchoice: "10", RT: "0" }];
  original.pracCsvText = table(comparisonCore, rows.map(row => ({ ...row, subject: "SID-雪" })));
  const outputs = splitStudyExports(original);
  assert.deepEqual(JSON.parse(outputs.diagnosticsJsonText).datasets.metaPractice.rows, [["1"]]);
  assert.deepEqual(restoreWideExports(outputs, outputs.diagnosticsJsonText), original);
  const duplicate = fixture();
  duplicate.pracCsvText = duplicate.pracCsvText.replace("\nSID-雪,1001,", "\nSID-雪,1001,").replace(/,2,main,1,21,/u, ",1,main,1,21,");
  assert.throws(() => splitStudyExports(duplicate), /row_index must be nonempty and unique/u);
});

test("invalid headers, missing outcomes, malformed quoting and inconsistent row widths fail before saving", () => {
  const original = fixture();
  assert.throws(() => splitStudyExports({ ...original, caliCsvText: original.caliCsvText.replace("pic1,pic2", "pic1,pic1") }), /duplicate column/u);
  assert.throws(() => splitStudyExports({ ...original, caliCsvText: original.caliCsvText.replace("pic1,pic2", "picture,pic2") }), /missing required core column pic1/u);
  assert.throws(() => splitStudyExports({ ...original, caliCsvText: original.caliCsvText.replace("subject,systemtime", ",systemtime") }), /empty column header/u);
  assert.throws(() => splitStudyExports({ ...original, caliCsvText: original.caliCsvText + "bad,row\n" }), /has 2 cells/u);
  assert.throws(() => splitStudyExports({ ...original, caliCsvText: original.caliCsvText + '"not closed' }), /unterminated quoted/u);
  assert.throws(() => splitStudyExports({ ...original, caliCsvText: original.caliCsvText + '"closed"extra' }), /after a closing quote/u);
  assert.throws(() => splitStudyExports({ ...original, caliCsvText: original.caliCsvText + 'bad"quote' }), /quote inside/u);
});

test("mixed participants, mixed sessions and external routing identifiers are rejected", () => {
  const original = fixture();
  assert.throws(() => splitStudyExports({ ...original, caliCsvText: original.caliCsvText.replace("SID-雪,", "OTHER-SID,") }), /mixed subject/u);
  assert.throws(() => splitStudyExports({ ...original, caliCsvText: original.caliCsvText.replace("session-雪", "other-session") }), /mixed session_id/u);
  assert.throws(() => splitStudyExports(original, { session_id: "other-session" }), /does not match/u);
  assert.throws(() => splitStudyExports(original, { id: "external" }), /routing identifier/u);
  assert.throws(() => splitStudyExports({ ...original, caliCsvText: original.caliCsvText.replace("schedule_position", "id") }), /routing identifiers/u);
});

test("recovery rejects files from a different session, dropped rows and duplicate row links", () => {
  const outputs = splitStudyExports(fixture());
  assert.throws(() => restoreWideExports({ ...outputs, caliCsvText: outputs.caliCsvText.replace("session-雪", "other-session") }, outputs.diagnosticsJsonText), /session_id does not match/u);
  const detail = JSON.parse(outputs.diagnosticsJsonText);
  detail.datasets.mrt.rows.pop();
  assert.throws(() => restoreWideExports(outputs, JSON.stringify(detail)), /row count mismatch/u);
  const duplicate = JSON.parse(outputs.diagnosticsJsonText);
  duplicate.datasets.mrt.rows[1][0] = duplicate.datasets.mrt.rows[0][0];
  assert.throws(() => restoreWideExports(outputs, JSON.stringify(duplicate)), /row count mismatch/u);
});

test("one diagnostic file removes repeated configuration and is smaller overall for a completed session", () => {
  const original = fixture(120);
  const outputs = splitStudyExports(original, { export_schema_version: "fae-export-v3" });
  const before = Object.values(original).reduce((total, value) => total + Buffer.byteLength(value), 0);
  const after = Object.values(outputs).reduce((total, value) => total + Buffer.byteLength(value), 0);
  assert.ok(after < before * 0.85, `Combined files should be smaller: ${after} / ${before}`);
  assert.deepEqual(restoreWideExports(outputs, outputs.diagnosticsJsonText), original);
});
