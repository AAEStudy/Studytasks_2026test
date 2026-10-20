// One switch for ordinary launches; ?mode=test / ?mode=full overrides it per run.
export const DEFAULT_RUN_MODE = "test";
export const STUDY_SCHEDULE_VERSION = "four-sections-20261020";
export const TAP_CYCLE_MS = 1300;

export function resolveStudyConfig(search = "", defaultMode = DEFAULT_RUN_MODE) {
  const requested = new URLSearchParams(search).get("mode");
  const mode = ["full", "test"].includes(requested) ? requested : defaultMode;
  if (!["full", "test"].includes(mode)) throw new Error("Unknown study mode");
  const full = mode === "full";
  const sections = full ? [90, 100, 90, 100].map((comparisons, index) => ({
    number: index + 1, comparisons, probes: 12,
    break: { kind: index % 2 === 0 ? "optional" : "mandatory",
      durationMs: index === 3 ? 300000 : index === 1 ? 180000 : 120000 }
  })) : [{ number: 1, comparisons: 6, probes: 1, break: null }];
  return {
    mode, scheduleVersion: full ? STUDY_SCHEDULE_VERSION : "legacy-short-20261019",
    calibrationComparisons: full ? 380 : 6, mrtProbeIntervals: full ? 48 : 1,
    // Preserve the existing short run's 40-second target (31 complete tap cycles).
    mrtMeanSeconds: full ? 42 : 40, mrtJitterSeconds: 15,
    reviewImages: 20, finalJudgments: 60, sections
  };
}

function shuffle(values, random) {
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

// Generate ONCE per session. Matched positive/negative jitters retain the chosen
// mean and bounds; shuffling prevents a predictable long/short sequence.
// Balance complete tap cycles within each section, so all full MRT blocks have
// exactly 388 cycles = 504.4 s. The 8:24 target is quantized to the 1.3-s rhythm.
export function createMrtIntervalSchedule(config, random = Math.random) {
  const schedule = [];
  for (const section of config.sections) {
    const seconds = [];
    for (let i = 0; i < Math.floor(section.probes / 2); i++) {
      const jitter = random() * config.mrtJitterSeconds;
      seconds.push(config.mrtMeanSeconds + jitter, config.mrtMeanSeconds - jitter);
    }
    if (section.probes % 2) seconds.push(config.mrtMeanSeconds);
    shuffle(seconds, random);
    const exactCycles = seconds.map(value => value * 1000 / TAP_CYCLE_MS);
    const cycles = exactCycles.map(Math.floor);
    const target = Math.round(section.probes * config.mrtMeanSeconds * 1000 / TAP_CYCLE_MS);
    const order = exactCycles.map((value, index) => ({ index, fraction: value % 1 }))
      .sort((a, b) => b.fraction - a.fraction);
    const extra = target - cycles.reduce((sum, value) => sum + value, 0);
    for (let i = 0; i < extra; i++) cycles[order[i].index]++;
    seconds.forEach((value, index) => schedule.push({
      interval: schedule.length + 1, section: section.number, probeInSection: index + 1,
      targetSeconds: value, tappingTrials: cycles[index], tappingMs: cycles[index] * TAP_CYCLE_MS
    }));
  }
  return Object.freeze(schedule.map(Object.freeze));
}

export function sectionProgressMessage(section) {
  return [
    "Congratulations—you have completed about one-quarter of the primary tasks!",
    "Congratulations—you are halfway through the primary tasks!",
    "Congratulations—you have completed about three-quarters of the primary tasks!",
    "Congratulations—you have completed all four sections of the primary tasks!"
  ][section - 1];
}
