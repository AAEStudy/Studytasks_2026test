const SCHEMA = "fae-participation-v1";
const SAVE_STATES = new Set(["stored", "queued", "accepted", "rejected", "unconfirmed"]);

// Participation records contain counts and timing only. They are independent of
// task-data exports and never wait for an upload, retry one, or create a timer.
export function createParticipationProgress({ experimentId, subjectId, sessionId, runMode,
  studyVersion, totalSections, startedAtUtc, startedMonotonicMs, save,
  environment = {}, onRecord = () => {}, onStatus = () => {}, enabled = true } = {}) {
  const records = [];
  const statuses = [];
  const sections = new Map();
  const scalar = value => typeof value === "string" && value.trim().length > 0
    && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
  const count = value => Number.isSafeInteger(value) && value >= 0;
  const duration = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
  const configured = enabled && scalar(experimentId) && scalar(subjectId) && scalar(sessionId)
    && scalar(runMode) && scalar(studyVersion) && count(totalSections) && totalSections > 0
    && totalSections <= 99 && typeof save === "function";
  const guarded = (callback, value) => {
    try {
      // A consumer may accidentally supply an async callback. Its rejection is
      // isolated just as a synchronous callback exception is.
      Promise.resolve(callback(value)).catch(() => {});
    } catch (_) {}
  };
  const fallbackNow = () => {
    try {
      const value = globalThis.performance?.now();
      if (Number.isFinite(value)) return value;
    } catch (_) {}
    return Date.now();
  };
  const suppliedNow = environment.now || environment.clock || fallbackNow;
  let lastNow;
  const now = () => {
    try {
      const value = suppliedNow();
      if (Number.isFinite(value)) lastNow = Math.max(lastNow ?? value, value);
    } catch (_) {}
    if (lastNow === undefined) lastNow = fallbackNow();
    return lastNow;
  };
  const utc = value => {
    try {
      const date = new Date(value);
      return Number.isFinite(date.getTime()) ? date.toISOString() : null;
    } catch (_) { return null; }
  };
  const wallClock = () => {
    try {
      const value = utc(environment.wallClock ? environment.wallClock() : Date.now());
      if (value) return value;
    } catch (_) {}
    return new Date().toISOString();
  };
  const opened = now();
  const started = Number.isFinite(startedMonotonicMs) && startedMonotonicMs <= opened
    ? startedMonotonicMs : opened;
  const startedUtc = utc(startedAtUtc) || wallClock();
  const roundSeconds = milliseconds => Math.round(milliseconds) / 1000;
  const safePart = value => value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "_") || "unknown";

  let doc = null;
  try { doc = environment.document === undefined ? globalThis.document : environment.document; } catch (_) {}
  let visibility = null;
  let visibleMs = 0;
  let hiddenMs = 0;
  let visibilityAt = started;
  let observing = false;
  const readVisibility = () => {
    try {
      return doc?.visibilityState === "visible" ? "visible"
        : doc?.visibilityState === "hidden" ? "hidden" : null;
    } catch (_) { return null; }
  };
  const accumulateVisibility = timestamp => {
    if (!observing || visibility === null) return;
    const elapsed = Math.max(0, timestamp - visibilityAt);
    if (visibility === "visible") visibleMs += elapsed;
    else hiddenMs += elapsed;
    visibilityAt = timestamp;
  };
  const visibilityChanged = () => {
    accumulateVisibility(now());
    visibility = readVisibility();
    // An unobservable state makes the session's split incomplete. Retain null
    // instead of presenting a partial measurement as full visible/hidden time.
    if (visibility === null) observing = false;
  };
  try {
    visibility = readVisibility();
    if (configured && visibility !== null && typeof doc.addEventListener === "function"
        && typeof doc.removeEventListener === "function") {
      doc.addEventListener("visibilitychange", visibilityChanged);
      observing = true;
    }
  } catch (_) { observing = false; }
  let disposed = false;

  const setStatus = (index, status) => {
    statuses[index] = Object.freeze(status);
    guarded(onStatus, statuses[index]);
  };
  const shortText = (value, max = 300) => {
    try {
      if (typeof value === "string") return value.slice(0, max);
      if (typeof value?.message === "string") return value.message.slice(0, max);
    } catch (_) {}
    return null;
  };
  const resultStatus = result => {
    // Do not copy arbitrary adapter fields or serialize a raw response body.
    try {
      return {
        save_state: SAVE_STATES.has(result?.save_state) ? result.save_state : "unconfirmed",
        http_status: Number.isInteger(result?.http_status) && result.http_status >= 100
          && result.http_status <= 599 ? result.http_status : null,
        error: shortText(result?.error),
        code: shortText(result?.code, 100)
      };
    } catch (_) {
      return { save_state: "unconfirmed", http_status: null, error: "Could not read upload status.", code: null };
    }
  };

  function checkpoint(input = {}) {
    if (!configured || !input || typeof input !== "object") return null;
    let section, comparisonsCompleted, comparisonsPlanned, mrtProbesCompleted, mrtProbesPlanned,
      finalJudgmentsCompleted, finalJudgmentsPlanned, scheduledBreakSeconds, pauseSeconds;
    try {
      ({ section, comparisonsCompleted, comparisonsPlanned, mrtProbesCompleted, mrtProbesPlanned,
        finalJudgmentsCompleted, finalJudgmentsPlanned, scheduledBreakSeconds, pauseSeconds } = input);
    } catch (_) { return null; }
    if (!count(section) || section < 1 || section > totalSections) return null;
    if (sections.has(section)) return sections.get(section);
    if (![comparisonsCompleted, comparisonsPlanned, mrtProbesCompleted, mrtProbesPlanned,
      finalJudgmentsCompleted, finalJudgmentsPlanned].every(count)
        || comparisonsCompleted > comparisonsPlanned || mrtProbesCompleted > mrtProbesPlanned
        || finalJudgmentsCompleted > finalJudgmentsPlanned
        || !duration(scheduledBreakSeconds) || !duration(pauseSeconds)) return null;

    const timestamp = now();
    accumulateVisibility(timestamp);
    const elapsedMs = Math.max(0, timestamp - started);
    const record = Object.freeze({
      schema_version: SCHEMA,
      subject_id: subjectId,
      session_id: sessionId,
      run_mode: runMode,
      study_version: studyVersion,
      study_started_at_utc: startedUtc,
      checkpoint_at_utc: wallClock(),
      elapsed_seconds: roundSeconds(elapsedMs),
      elapsed_minutes: Math.round(elapsedMs / 60) / 1000,
      tab_visible_seconds: observing ? roundSeconds(visibleMs) : null,
      tab_hidden_seconds: observing ? roundSeconds(hiddenMs) : null,
      sections_completed: section,
      sections_planned: totalSections,
      calibration_comparisons_completed: comparisonsCompleted,
      calibration_comparisons_planned: comparisonsPlanned,
      mrt_probes_completed: mrtProbesCompleted,
      mrt_probes_planned: mrtProbesPlanned,
      final_judgments_completed: finalJudgmentsCompleted,
      final_judgments_planned: finalJudgmentsPlanned,
      scheduled_break_seconds_completed: scheduledBreakSeconds,
      p_key_pause_seconds: pauseSeconds,
      primary_tasks_complete: section === totalSections && comparisonsCompleted === comparisonsPlanned
        && mrtProbesCompleted === mrtProbesPlanned,
      github_tasks_complete: false
    });
    const filename = `Progress/Progress_${safePart(runMode)}_${safePart(subjectId)}_${safePart(sessionId)}_section-${String(section).padStart(2, "0")}.json`;
    const text = JSON.stringify(record);
    const index = records.length;
    sections.set(section, record);
    records.push(record);
    guarded(onRecord, record);
    setStatus(index, { filename, section, save_state: "pending", http_status: null,
      error: null, code: null, upload_duration_ms: null });
    // Starting in a microtask makes even synchronous transport work occur after
    // the checkpoint has returned and the study can advance to its next screen.
    let uploadStarted;
    Promise.resolve().then(() => {
      uploadStarted = now();
      return save(filename, text);
    }).then(result => {
      setStatus(index, { filename, section, ...resultStatus(result),
        upload_duration_ms: Math.max(0, now() - uploadStarted) });
    }, error => {
      setStatus(index, { filename, section, save_state: "unconfirmed", http_status: null,
        error: shortText(error) || "Could not confirm the progress upload.",
        code: null, upload_duration_ms: Math.max(0, now() - uploadStarted) });
    }).catch(() => {});
    return record;
  }

  return {
    checkpoint,
    get records() { return records.slice(); },
    get statuses() { return statuses.slice(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      observing = false;
      try { doc?.removeEventListener("visibilitychange", visibilityChanged); } catch (_) {}
    }
  };
}
