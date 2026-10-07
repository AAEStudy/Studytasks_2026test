export const IMAGE_SCHEDULE_VERSION = "image-order-v1";
export const CALIBRATION_BLOCK_SIZE = 10;
export const MIN_PAIR_INTERVENING_TRIALS = 60;
export const MIN_IMAGE_INTERVENING_TRIALS = 2;
export const SCHEDULE_FIELDS = [
  "schedule_version", "schedule_seed", "schedule_stage", "schedule_position",
  "schedule_source_row", "schedule_block", "schedule_pair_occurrence",
  "schedule_min_pair_intervening", "schedule_min_image_intervening",
  "schedule_source_sha256", "schedule_followup_shuffle", "schedule_review_order"
];

export function sessionSeed(seed) {
  if (seed === undefined || seed === null) return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error("Image schedule seed must be an unsigned 32-bit integer.");
  return seed;
}

// Local Mulberry32 PRNG: reproducible image ordering without changing Math.random
// or consuming the MRT's randomization stream.
function randomStream(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let x = Math.imul(value ^ (value >>> 15), value | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(values, random) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function pairKey(a, b) { return JSON.stringify([a, b].sort()); }

function validatePairs(rows) {
  const images = [...new Set(rows.flatMap(row => [row.p1, row.p2]))].sort();
  if (images.length !== 20 || rows.length !== 380) throw new Error("Calibration must retain the current 20 images and all 380 comparisons.");
  const pairs = new Map();
  rows.forEach((row, index) => {
    if (!row.p1 || !row.p2 || row.p1 === row.p2) throw new Error("Calibration contains a missing image or a self-comparison.");
    const key = pairKey(row.p1, row.p2);
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key).push(index);
  });
  if (pairs.size !== 190) throw new Error("Calibration must include all 190 unique image pairs.");
  for (const indices of pairs.values()) {
    const [a, b] = indices.map(i => rows[i]);
    if (indices.length !== 2 || a.p1 !== b.p2 || a.p2 !== b.p1) {
      throw new Error("Every calibration pair must occur exactly twice in reversed presentation order.");
    }
  }
  return { images, pairs };
}

function metadata(seed, stage, position, sourceRow, block, occurrence = "") {
  return {
    schedule_version: IMAGE_SCHEDULE_VERSION,
    schedule_seed: seed,
    schedule_stage: stage,
    schedule_position: position,
    schedule_source_row: sourceRow,
    schedule_block: block,
    schedule_pair_occurrence: occurrence,
    schedule_min_pair_intervening: stage === "calibration" ? MIN_PAIR_INTERVENING_TRIALS : "",
    schedule_min_image_intervening: stage === "calibration" ? MIN_IMAGE_INTERVENING_TRIALS : ""
  };
}

export function createCalibrationSchedule(rows, seed) {
  seed = sessionSeed(seed);
  const { images, pairs } = validatePairs(rows);
  const random = randomStream(seed ^ 0xc411b8a7);
  const orderedPairs = new Map([...pairs].map(([key, ids]) => [key, shuffled(ids, random)]));
  let ring = shuffled(images, random);
  const rounds = [];
  // Circle factorization gives 19 matchings, each containing all 20 images once.
  for (let round = 0; round < 19; round++) {
    rounds.push(Array.from({ length: CALIBRATION_BLOCK_SIZE }, (_, i) => pairKey(ring[i], ring[19 - i])));
    ring = [ring[0], ring[19], ...ring.slice(1, 19)];
  }
  const roundOrder = shuffled(rounds, random);
  const blocks = [0, 1].flatMap(copy => roundOrder.map(keys => keys.map(key => orderedPairs.get(key)[copy])));
  const locations = new Array(rows.length);
  const other = new Array(rows.length);
  blocks.forEach((block, index) => block.forEach(id => { locations[id] = index; }));
  for (const [a, b] of pairs.values()) { other[a] = b; other[b] = a; }
  // Seven block positions guarantee at least 60 intervening trials regardless
  // of each pair's eventual position inside its ten-trial block.
  const minBlockDistance = Math.ceil((MIN_PAIR_INTERVENING_TRIALS + CALIBRATION_BLOCK_SIZE) / CALIBRATION_BLOCK_SIZE);
  function exchange(a, b, idsA, idsB) {
    const destinations = new Map([...idsA.map(id => [id, b]), ...idsB.map(id => [id, a])]);
    for (const [id, target] of destinations) {
      if (Math.abs(target - (destinations.get(other[id]) ?? locations[other[id]])) < minBlockDistance) return;
    }
    const removeA = new Set(idsA), removeB = new Set(idsB);
    blocks[a] = [...blocks[a].filter(id => !removeA.has(id)), ...idsB];
    blocks[b] = [...blocks[b].filter(id => !removeB.has(id)), ...idsA];
    for (const [id, target] of destinations) locations[id] = target;
  }
  // Alternating-cycle exchanges preserve one appearance per image per block
  // while breaking up the original matching groups and the two-copy ordering.
  for (let step = 0; step < 5000; step++) {
    const a = Math.floor(random() * blocks.length);
    const b = Math.floor(random() * blocks.length);
    if (a === b) continue;
    if (step % 5 === 0) { exchange(a, b, blocks[a], blocks[b]); continue; }
    const edgesA = new Map(), edgesB = new Map();
    for (const id of blocks[a]) { edgesA.set(rows[id].p1, id); edgesA.set(rows[id].p2, id); }
    for (const id of blocks[b]) { edgesB.set(rows[id].p1, id); edgesB.set(rows[id].p2, id); }
    const start = images[Math.floor(random() * images.length)];
    let vertex = start;
    const idsA = [], idsB = [];
    do {
      const idA = edgesA.get(vertex);
      idsA.push(idA);
      vertex = rows[idA].p1 === vertex ? rows[idA].p2 : rows[idA].p1;
      const idB = edgesB.get(vertex);
      idsB.push(idB);
      vertex = rows[idB].p1 === vertex ? rows[idB].p2 : rows[idB].p1;
    } while (vertex !== start);
    exchange(a, b, idsA, idsB);
  }
  const order = [];
  for (const block of blocks) {
    const remaining = shuffled(block, random);
    while (remaining.length) {
      const recentImages = new Set(order.slice(-MIN_IMAGE_INTERVENING_TRIALS).flatMap(id => [rows[id].p1, rows[id].p2]));
      const next = remaining.findIndex(id => !recentImages.has(rows[id].p1) && !recentImages.has(rows[id].p2));
      if (next < 0) throw new Error("Could not satisfy image spacing at a calibration block boundary.");
      order.push(remaining.splice(next, 1)[0]);
    }
  }
  const occurrences = new Map();
  return order.map((id, index) => {
    const key = pairKey(rows[id].p1, rows[id].p2);
    const occurrence = (occurrences.get(key) || 0) + 1;
    occurrences.set(key, occurrence);
    return { ...rows[id], schedule: metadata(seed, "calibration", index + 1, id + 1, Math.floor(index / CALIBRATION_BLOCK_SIZE) + 1, occurrence) };
  });
}

export function createReviewSchedule(list, seed, previousImage = null) {
  seed = sessionSeed(seed);
  if (list.length !== 20 || new Set(list).size !== 20) throw new Error("Review must retain 20 distinct images.");
  const random = randomStream(seed ^ 0x7e71e001);
  let indices;
  do { indices = shuffled(list.map((_, i) => i), random); } while (list[indices[0]] === previousImage);
  return indices.map((id, index) => ({ pic: list[id], schedule: metadata(seed, "review", index + 1, id + 1, 1) }));
}

export function createMetaSchedule(list, seed, previousImage = null) {
  seed = sessionSeed(seed);
  const images = [...new Set(list)].sort();
  const sourceRows = new Map(images.map(pic => [pic, list.flatMap((value, i) => value === pic ? [i] : [])]));
  if (images.length !== 20 || list.length !== 60 || [...sourceRows.values()].some(ids => ids.length !== 3)) {
    throw new Error("Final judgments must retain all 20 images, each occurring three times.");
  }
  const random = randomStream(seed ^ 0xf1a1e001);
  const scheduled = [];
  const lastPosition = new Map();
  if (previousImage) lastPosition.set(previousImage, -1);
  // Independently permute three coverage blocks. Reject orders with fewer than
  // five intervening judgments between repetitions, including block boundaries.
  for (let block = 0; block < 3; block++) {
    let order = null;
    for (let attempt = 0; attempt < 10000 && !order; attempt++) {
      const candidate = shuffled(images, random);
      if (candidate.every((pic, i) => !lastPosition.has(pic) || block * 20 + i - lastPosition.get(pic) > 5)) order = candidate;
    }
    if (!order) throw new Error("Could not satisfy final-judgment image spacing.");
    order.forEach((pic, i) => {
      const position = block * 20 + i;
      lastPosition.set(pic, position);
      scheduled.push({ pic, schedule: metadata(seed, "meta", position + 1, sourceRows.get(pic)[block] + 1, block + 1) });
    });
  }
  return scheduled;
}

export function assertSameImages(pairs, review, meta) {
  const images = [...new Set(pairs.flatMap(row => [row.p1, row.p2]))].sort();
  for (const list of [review, meta]) {
    if (JSON.stringify([...new Set(list)].sort()) !== JSON.stringify(images)) {
      throw new Error("Calibration, review, and final judgments must use the same unchanged image set.");
    }
  }
  if (review.length !== images.length || meta.length !== images.length * 3 || images.some(pic => meta.filter(value => value === pic).length !== 3)) {
    throw new Error("Review must show each image once and final judgments must show each image three times.");
  }
}
