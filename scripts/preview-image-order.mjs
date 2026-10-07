import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { IMAGE_SCHEDULE_VERSION, pairKey, sessionSeed } from "../js/image-schedule.mjs";

globalThis.STUDY_RESPONSE_SETTINGS = { imageReplayLimit: 3 };
const { initMetaEmotion } = await import("../metaemotion.js");
const repo = fileURLToPath(new URL("../", import.meta.url));
const seed = sessionSeed(Number(process.argv[2] ?? 20261007));
const output = `${repo}preview/image-order/seed-${seed}`;
const originalFetch = globalThis.fetch;
globalThis.fetch = async url => ({ ok: true, text: async () => readFileSync(`${repo}${url}`, "utf8") });
let state;
try { state = await initMetaEmotion({ subject: "PREVIEW_ONLY", calibrationLimit: "ALL", imageScheduleSeed: seed }); }
finally { globalThis.fetch = originalFetch; }
mkdirSync(`${output}/originals`, { recursive: true });
const csv = rows => rows.map(row => row.map(value => {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}).join(",")).join("\n") + "\n";
const save = (name, rows) => writeFileSync(`${output}/${name}`, csv(rows));
const originalHashes = {};
let sourceFilesUnchanged = true;
for (const name of ["calibration_pairs.csv", "review_list.csv", "meta_list.csv", "practice_pairs.csv"]) {
  const file = `${repo}lists/${name}`;
  originalHashes[name] = createHash("sha256").update(readFileSync(file)).digest("hex");
  sourceFilesUnchanged &&= readFileSync(file).equals(execFileSync("git", ["show", `HEAD:lists/${name}`], { cwd: repo }));
  copyFileSync(file, `${output}/originals/${name}`);
}
save("calibration_pairs.csv", [["pic1", "pic2"], ...state.calibrationPairs.map(row => [row.p1, row.p2])]);
save("review_list.csv", [["pic"], ...state.reviewList.map(pic => [pic])]);
save("meta_list.csv", [["pic"], ...state.metaList.map(pic => [pic])]);

function audit(rows) {
  const pairLast = new Map(), imageLast = new Map();
  const pairGaps = [], imageGaps = [];
  let adjacentSharedImage = 0;
  rows.forEach((row, i) => {
    const key = pairKey(row.p1, row.p2);
    if (pairLast.has(key)) pairGaps.push(i - pairLast.get(key) - 1);
    pairLast.set(key, i);
    for (const pic of [row.p1, row.p2]) {
      if (imageLast.has(pic)) imageGaps.push(i - imageLast.get(pic) - 1);
      imageLast.set(pic, i);
    }
    if (i && [row.p1, row.p2].some(pic => [rows[i - 1].p1, rows[i - 1].p2].includes(pic))) adjacentSharedImage++;
  });
  const chunkImageCounts = Array.from({ length: 38 }, (_, i) => new Set(rows.slice(i * 10, i * 10 + 10).flatMap(row => [row.p1, row.p2])).size);
  return {
    trials: rows.length, distinctImages: imageLast.size, uniquePairs: pairLast.size,
    minPairIntervening: Math.min(...pairGaps), maxPairIntervening: Math.max(...pairGaps),
    minImageIntervening: Math.min(...imageGaps), maxImageIntervening: Math.max(...imageGaps),
    adjacentTrialsSharingImage: adjacentSharedImage,
    minDistinctImagesPerChunk: Math.min(...chunkImageCounts), maxDistinctImagesPerChunk: Math.max(...chunkImageCounts)
  };
}
const pairLast = new Map();
save("calibration_schedule.csv", [["trial", "chunk", "pic1", "pic2", "original_data_row", "pair_occurrence", "intervening_trials_since_pair"],
  ...state.calibrationPairs.map((row, i) => {
    const key = pairKey(row.p1, row.p2);
    const gap = pairLast.has(key) ? i - pairLast.get(key) - 1 : "";
    pairLast.set(key, i);
    return [i + 1, row.schedule.schedule_block, row.p1, row.p2, row.schedule.schedule_source_row, row.schedule.schedule_pair_occurrence, gap];
  })]);
save("image_balance.csv", [["image", "appearances", "first_position", "second_position", "chunks_present", "earliest_trial", "latest_trial"],
  ...[...state.sourceReviewList].sort().map(pic => {
    const positions = state.calibrationPairs.flatMap((row, i) => [row.p1, row.p2].includes(pic) ? [i] : []);
    return [pic, positions.length, state.calibrationPairs.filter(row => row.p1 === pic).length,
      state.calibrationPairs.filter(row => row.p2 === pic).length, new Set(positions.map(i => Math.floor(i / 10))).size,
      positions[0] + 1, positions.at(-1) + 1];
  })]);
const manifest = {
  seed, version: IMAGE_SCHEDULE_VERSION, sourceGitCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(), originalSHA256: originalHashes,
  original: audit(state.sourceCalibrationPairs), shuffled: audit(state.calibrationPairs),
  reviewCount: state.reviewList.length, metaJudgmentCount: state.metaList.length,
  images: [...state.sourceReviewList].sort(), sourceFilesUnchanged,
  note: "Illustrative full-run schedule only. Runtime uses a fresh saved seed per session; source lists stay unchanged."
};
writeFileSync(`${output}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(`${output}/README.txt`, `IMAGE ORDER PREVIEW: seed ${seed}, ${IMAGE_SCHEDULE_VERSION}

These CSVs show one full-session presentation order, not replacement stimulus pools.
Do not overwrite lists/ with these previews. The study reads the unchanged master
lists and schedules their exact rows in memory, using a fresh saved seed per session.
Original source CSVs are copied byte-for-byte into originals/ for comparison.

Calibration: 380 comparisons, 190 unique pairs twice in reversed orientation.
Each of 38 ten-trial blocks contains all 20 images exactly once. Each image appears
38 times total, 19 first and 19 second. At least 60 other comparisons separate
repetitions of an exact pair; at least two other comparisons separate appearances
of an image, including block boundaries. No ranks, outcomes or emotional labels
are used to construct the schedule. These are design constraints, not empirically
validated forgetting intervals. This is constrained randomization, not a uniform
draw over every possible permutation.

Independent follow-up shuffles are prepared as the recommended option:
review_list.csv contains each current image once; meta_list.csv contains all 20
images three times, once per independently shuffled 20-item coverage block, with
at least five intervening judgments between repeats. No extra breaks are added.
Practice's 12 comparisons are unchanged. No pictures are replaced or added.

The 60-comparison gap is in scheduled calibration comparisons, not seconds or MRT
trials. Optional participant-requested replays are an explicit exception: they
repeat the same picture(s) immediately, as requested, and remain flagged in data.

The existing six-comparison test limit is applied after generating the full order.
It therefore exercises a randomized prefix, not a complete calibration. Restore
META_CALIBRATION_COMPARISONS = "ALL" for all 380 comparisons. Other timing, MRT
blocks, response controls, confidence wording and saving endpoints are unchanged.

WHY: distribute exposure over time, remove focal-image runs and stable order/key
cues, and make specific prior choices less conveniently retrievable. This does
not prevent learning or prove that final judgments are independent of memory.
No distractors, new measures, rankings or alternative calibration analysis added.

FILES
calibration_pairs.csv: exact ordered stimulus rows in the illustrative new order.
calibration_schedule.csv: adds chunk, original source row and pair spacing.
image_balance.csv: per-image first/second counts and coverage.
review_list.csv, meta_list.csv: independently randomized follow-up previews.
manifest.json: before/after checks and source hashes.

Generation: node scripts/preview-image-order.mjs ${seed}
Checks: node --test tests/image-schedule.test.mjs
This example documents one reproducible order; live sessions use their own saved seed.
`);
console.log(JSON.stringify({ output, ...manifest }, null, 2));
