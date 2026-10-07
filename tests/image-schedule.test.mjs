import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createCalibrationSchedule, createReviewSchedule, createMetaSchedule, assertSameImages, pairKey, sessionSeed } from "../js/image-schedule.mjs";

globalThis.STUDY_RESPONSE_SETTINGS = { imageReplayLimit: 3 };
const { parseCSV, initMetaEmotion } = await import("../metaemotion.js");
const repo = fileURLToPath(new URL("../", import.meta.url));
const read = filename => readFileSync(`${repo}lists/${filename}`, "utf8");
const pairs = parseCSV(read("calibration_pairs.csv")).slice(1).map(([p1, p2], i) => ({ p1, p2, cat: NaN, originalMarker: i }));
const review = parseCSV(read("review_list.csv")).slice(1).map(row => row[0]);
const meta = parseCSV(read("meta_list.csv")).slice(1).map(row => row[0]);
const original = JSON.stringify({ pairs, review, meta });

function checkCalibration(schedule) {
  assert.equal(schedule.length, 380);
  assert.equal(new Set(schedule.map(row => row.schedule.schedule_source_row)).size, 380);
  const pairPositions = new Map(), imagePositions = new Map(), first = new Map(), second = new Map();
  schedule.forEach((row, i) => {
    const source = pairs[row.schedule.schedule_source_row - 1];
    assert.equal(row.p1, source.p1); assert.equal(row.p2, source.p2);
    assert.equal(row.originalMarker, source.originalMarker);
    assert(Number.isNaN(row.cat));
    assert.equal(row.schedule.schedule_position, i + 1);
    assert.equal(row.schedule.schedule_block, Math.floor(i / 10) + 1);
    const key = pairKey(row.p1, row.p2);
    if (pairPositions.has(key)) {
      const prev = pairPositions.get(key);
      assert(i - prev - 1 >= 60, `Pair ${key}: ${prev} -> ${i}`);
      assert.equal(schedule[prev].p1, row.p2);
      assert.equal(row.schedule.schedule_pair_occurrence, 2);
    } else assert.equal(row.schedule.schedule_pair_occurrence, 1);
    pairPositions.set(key, i);
    for (const pic of [row.p1, row.p2]) {
      if (imagePositions.has(pic)) assert(i - imagePositions.get(pic) - 1 >= 2);
      imagePositions.set(pic, i);
    }
    first.set(row.p1, (first.get(row.p1) || 0) + 1);
    second.set(row.p2, (second.get(row.p2) || 0) + 1);
  });
  assert.equal(pairPositions.size, 190);
  for (const pic of review) { assert.equal(first.get(pic), 19); assert.equal(second.get(pic), 19); }
  for (let i = 0; i < 380; i += 10) assert.equal(new Set(schedule.slice(i, i + 10).flatMap(row => [row.p1, row.p2])).size, 20);
}

test("1,000 seeds preserve every directed row, position balance, chunk coverage and spacing", () => {
  for (let seed = 0; seed < 1000; seed++) checkCalibration(createCalibrationSchedule(pairs, seed));
  assert.equal(JSON.stringify({ pairs, review, meta }), original);
});

test("determinism, participant variation, extreme seeds and isolated RNG", () => {
  assert.deepEqual(createCalibrationSchedule(pairs, 20261007), createCalibrationSchedule(pairs, 20261007));
  assert.notDeepEqual(createCalibrationSchedule(pairs, 1), createCalibrationSchedule(pairs, 2));
  const oldRandom = Math.random;
  Math.random = () => { throw new Error("Global RNG must not be used by seeded image scheduling"); };
  try { checkCalibration(createCalibrationSchedule(pairs, 0xffffffff)); }
  finally { Math.random = oldRandom; }
  for (const bad of [-1, 2 ** 32, 0.5, "12"]) assert.throws(() => sessionSeed(bad));
});

test("review and final judgment schedules retain all source occurrences and vary independently", () => {
  for (let seed = 0; seed < 1000; seed++) {
    const r = createReviewSchedule(review, seed);
    assert.deepEqual(r.map(row => row.pic).sort(), [...review].sort());
    const m = createMetaSchedule(meta, seed, r.at(-1).pic);
    assert.deepEqual(m.map(row => row.pic).sort(), [...meta].sort());
    assert.equal(new Set(m.map(row => row.schedule.schedule_source_row)).size, 60);
    const last = new Map([[r.at(-1).pic, -1]]);
    m.forEach((row, i) => {
      assert.equal(row.pic, meta[row.schedule.schedule_source_row - 1]);
      if (last.has(row.pic)) assert(i - last.get(row.pic) - 1 >= 5);
      last.set(row.pic, i);
    });
    for (let i = 0; i < 60; i += 20) assert.equal(new Set(m.slice(i, i + 20).map(row => row.pic)).size, 20);
  }
});

test("invalid or changed comparison sets fail explicitly, never silently drop or draw rows", () => {
  assert.throws(() => createCalibrationSchedule(pairs.slice(1), 1));
  assert.throws(() => createCalibrationSchedule([...pairs.slice(0, -1), pairs[0]], 1));
  assert.throws(() => createCalibrationSchedule(pairs.map((row, i) => i ? row : { ...row, p2: row.p1 }), 1));
  assert.throws(() => assertSameImages(pairs, ["2152.jpg", ...review.slice(1)], meta));
  assert.throws(() => assertSameImages(pairs, [...review, review[0]], meta));
  assert.throws(() => assertSameImages(pairs, review, [...meta.slice(0, -1), meta[0]]));
  assert.throws(() => createReviewSchedule(review.slice(1), 1));
  assert.throws(() => createMetaSchedule(meta.slice(1), 1));
});

test("runtime integration truncates only after scheduling and preserves independent follow-up lists", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async url => ({ ok: true, text: async () => readFileSync(`${repo}${url}`, "utf8") });
  try {
    let reference;
    for (const limit of [0, 1, 6, 380, "ALL"]) {
      const state = await initMetaEmotion({ subject: "TEST", calibrationLimit: limit, imageScheduleSeed: 20261007 });
      assert.equal(state.calibrationTargetCount, limit === "ALL" ? 380 : limit);
      assert.equal(state.calibrationPairs.length, 380);
      assert.equal(state.reviewList.length, 20);
      assert.equal(state.metaList.length, 60);
      assert.equal(state.calibrationPairs[0].schedule.schedule_source_sha256.length, 64);
      if (reference) {
        assert.deepEqual(state.calibrationPairs, reference.calibrationPairs);
        assert.deepEqual(state.reviewList, reference.reviewList);
        assert.deepEqual(state.metaList, reference.metaList);
      }
      reference = state;
    }
    const unshuffled = await initMetaEmotion({ subject: "TEST", imageScheduleSeed: 20261007, shuffleFollowupStages: false });
    assert.deepEqual(unshuffled.reviewList, review);
    assert.deepEqual(unshuffled.metaList, meta);
    assert.equal(unshuffled.practicePairs.length, 12);
    assert.equal(unshuffled.practicePairs[0].p1, "1410.jpg");
  } finally { globalThis.fetch = oldFetch; }
});
