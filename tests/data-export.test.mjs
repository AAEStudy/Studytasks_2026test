import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

globalThis.STUDY_RESPONSE_SETTINGS = { imageReplayLimit: 5 };
const { exportMetaEmotion, parseCSV } = await import("../metaemotion.js");
const root = fileURLToPath(new URL("../", import.meta.url));
const read = path => readFileSync(root + path, "utf8");
const comparisonHeaders = ["subject", "systemtime", "pic1", "pic2", "category", "rawchoice", "picchoice", "RT"];
const judgmentHeaders = ["subject", "systemtime", "pic", "higherlower", "firstRT", "confidence", "secondRT"];

function collection(rows) {
  return {
    values: () => rows,
    filter: criteria => collection(rows.filter(row => Object.entries(criteria).every(([key, value]) => row[key] === value)))
  };
}
function pair(phase, extra = {}) {
  return { task: "metaemotion", event: "2ifc", phase, timestamp_s: 8001, pic1_id: 10, pic2_id: 2,
    cat: NaN, choice_key: "2", chosen_id: 2, rt_s: 0.6, chunk: 1, ...extra };
}
function judgment(extra = {}) {
  return { task: "metaemotion", event: "meta_conf", pic_id: 10, type1_time_s: 8010,
    type1_key: "1", type1_rt_s: 0.7, conf_key: "3", conf_rt_s: 0.8, ...extra };
}

test("Lee's exact core headers and numeric codes survive alongside named provenance", () => {
  const records = [pair("practice"), pair("calibration"), judgment()];
  const out = exportMetaEmotion({ subject: "CHECK" }, { data: { get: () => collection(records) } }, { session_id: "session-a" });
  const practice = parseCSV(out.pracCsvText), calibration = parseCSV(out.caliCsvText), meta = parseCSV(out.metaJCsvText);
  assert.deepEqual(practice[0].slice(0, 8), comparisonHeaders);
  assert.deepEqual(calibration[0].slice(0, 8), comparisonHeaders);
  assert.deepEqual(meta[0].slice(0, 7), judgmentHeaders);
  assert.deepEqual(calibration[1].slice(0, 8), ["CHECK", "8001", "10", "2", "", "2", "2", "0.6"]);
  assert.deepEqual(meta[1].slice(0, 7), ["CHECK", "8010", "10", "1", "0.7", "3", "0.8"]);
  assert.equal(calibration[1][calibration[0].indexOf("pair_key")], "2_10");
  assert.equal(meta[1][meta[0].indexOf("confidence_label")], "Confident");
  assert.equal(meta[1][meta[0].indexOf("response_time_s")], "8010");
  for (const table of [practice, calibration, meta]) {
    assert.equal(table[1].length, table[0].length);
    assert.equal(table[1][table[0].indexOf("session_id")], "session-a");
    assert.equal(new Set(table[0]).size, table[0].length);
  }
  assert.deepEqual(out.counts, { practice: 1, calibration: 1, meta: 1 });
});

test("CSV round-trip retains the first trial, quoted JSON, multiline values, zero and false", () => {
  const replay = [{ pictures: ['a,"b".jpg', "c.jpg"], elapsed_ms: 10 }];
  const records = [pair("calibration", { replay_requests: replay, fast_response: false, fast_streak: 0 }),
    pair("calibration", { pic1_id: 20, chosen_id: 20, choice_key: "1", rt_s: Infinity })];
  const marker = 'a,"quoted"\nsecond\rline';
  const out = exportMetaEmotion({ subject: marker }, { data: { get: () => collection(records) } }, { session_id: marker });
  const table = parseCSV(out.caliCsvText), [header, first, second] = table;
  assert.equal(table.length, 3);
  assert.equal(first[0], marker);
  assert.equal(first[header.indexOf("session_id")], marker);
  assert.deepEqual(JSON.parse(first[header.indexOf("replay_requests")]), replay);
  assert.equal(first[header.indexOf("fast_response")], "false");
  assert.equal(first[header.indexOf("fast_streak")], "0");
  assert.equal(second[header.indexOf("RT")], "");
  assert.equal(second[header.indexOf("row_index")], "2");
  assert.equal(first.length, header.length);
  assert.equal(second.length, header.length);
});

test("empty image files retain their schema and reject ambiguous header collisions", () => {
  const psych = { data: { get: () => collection([]) } };
  const out = exportMetaEmotion({ subject: "CHECK" }, psych);
  assert.equal(parseCSV(out.pracCsvText).length, 1);
  assert.equal(parseCSV(out.caliCsvText).length, 1);
  assert.equal(parseCSV(out.metaJCsvText).length, 1);
  assert.deepEqual(out.schemas.meta.slice(0, 7), judgmentHeaders);
  assert.throws(() => exportMetaEmotion({ subject: "CHECK" }, psych, { subject: "duplicate" }), /unique/);
});

function runtime(records = [], full = false) {
  const planned = full ? 380 : 6;
  const state = { subject: "CHECK", practicePairs: new Array(12), calibrationPairs: new Array(380), calibrationTargetCount: planned };
  const psych = { data: { addProperties() {}, get: () => collection(records) }, run() {} };
  const context = vm.createContext({ console, performance, URLSearchParams, crypto: webcrypto,
    document: { addEventListener() {}, removeEventListener() {} },
    window: { location: { search: "?subjectID=CHECK" }, __metaState: state, addEventListener() {}, removeEventListener() {} },
    Audio: class {}, initJsPsych: () => psych, exportMetaEmotion,
    jsPsychHtmlKeyboardResponse: {}, jsPsychInstructions: {}, jsPsychPipe: {}, jsPsychPreload: {} });
  vm.runInContext(read("js/response-controls.js") + "\n" + read("mrt.js"), context);
  let main = read("main.js").replace(/^import .*\n/m, "").replace(/start\(\);\s*$/, "globalThis.qa = { sharedState, getResultFiles, getResultExports, buildPipeSaveTrials, getSessionMetadata, RESULT_FILENAMES };");
  if (full) main = main.replace("const META_CALIBRATION_COMPARISONS = 6;", 'const META_CALIBRATION_COMPARISONS = "ALL";').replace("const MRT_TOTAL_BLOCKS = 1;", "const MRT_TOTAL_BLOCKS = 35;");
  vm.runInContext(main, context);
  const built = context.buildMRTPractice({ subjectID: "CHECK", jsPsych: psych, metronomeAudio: {}, _state: context.qa.sharedState, numBlocks: full ? 35 : 1 });
  return { context, psych, state, built, qa: context.qa };
}

test("MRT TSV preserves original fields, quotes text and handles sparse arrays and repeated IDs", () => {
  const { built } = runtime();
  const text = built.convertToCSV({ subject: ["CHECK", "CHECK"], trial: [1, 1], note: ['a\tb\n"quoted"', null], sparse: [false], numeric: [0, NaN] }, { session_id: "s" });
  assert.equal(text, 'subject\ttrial\tnote\tsparse\tnumeric\trow_index\tsession_id\nCHECK\t1\t"a\tb\n""quoted"""\tfalse\t0\t1\ts\nCHECK\t1\t\t\t\t2\ts\n');
  assert.equal(built.convertToCSV({ subject: [] }, { session_id: "s" }), "subject\trow_index\tsession_id\n");
  assert.throws(() => built.convertToCSV({ subject: ["x"] }, { subject: "duplicate" }), /duplicates/);
  assert.throws(() => built.convertToCSV({ row_index: [1] }), /reserved/);
});

function completedRecords(calibrationCount) {
  return [...Array.from({ length: 12 }, () => pair("practice")),
    ...Array.from({ length: calibrationCount }, () => pair("calibration")),
    ...Array.from({ length: 60 }, () => judgment()),
    ...Array.from({ length: 20 }, () => ({ task: "metaemotion", event: "image", phase: "review" }))];
}

test("short and full runs report separate completion flags and identical upload/download bytes", () => {
  for (const full of [false, true]) {
    const records = completedRecords(full ? 380 : 6);
    const { qa } = runtime(records, full);
    qa.sharedState.customData.subject.push(...new Array((full ? 35 : 1) + 1).fill("CHECK"));
    qa.sharedState.customData.task.push("practice_probe", ...new Array(full ? 35 : 1).fill("thought_probe"));
    const metadata = qa.getSessionMetadata({ data: { get: () => collection(records) } });
    assert.equal(metadata.run_mode, full ? "full" : "test");
    assert.equal(metadata.configured_tasks_complete, true);
    assert.equal(metadata.full_protocol_complete, full);
    assert.equal(metadata.calibration_trials_completed, full ? 380 : 6);
    assert.equal(metadata.mrt_blocks_completed, full ? 35 : 1);
    const psych = { data: { get: () => collection(records) } };
    const files = qa.getResultFiles(psych), pipes = qa.buildPipeSaveTrials(psych);
    assert.equal(files.length, 4);
    assert.equal(pipes.length, 4);
    files.forEach((file, i) => {
      assert.equal(pipes[i].filename, file.filename);
      assert.equal(pipes[i].data_string(), file.text);
      assert.ok(file.filename.includes(`_${metadata.run_mode}_CHECK_${metadata.session_id}`));
    });
    const first = qa.getResultExports(psych);
    records.push(pair("calibration"));
    assert.equal(qa.getResultExports(psych), first, "completed-task snapshot is frozen across subsequent save events");
  }
});

test("partial runs are flagged and separate runs of the same subject get unique filenames", () => {
  const one = runtime([pair("calibration")]), two = runtime([pair("calibration")]);
  const metadata = one.qa.getSessionMetadata(one.psych);
  assert.equal(metadata.configured_tasks_complete, false);
  assert.equal(metadata.full_protocol_complete, false);
  assert.equal(metadata.calibration_trials_completed, 1);
  assert.notEqual(one.qa.RESULT_FILENAMES.metaCalibration, two.qa.RESULT_FILENAMES.metaCalibration);
});
