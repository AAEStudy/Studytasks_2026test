import { sectionProgressMessage } from "./study-schedule.mjs?v=20261020-full-schedule";

// Buttons, not a trial timeout, control departure. Mandatory timers only unlock
// Continue; optional breaks may be skipped or ended early. Time is measured from
// a deadline, so background-tab timer throttling does not extend the break.
export function buildSectionBreak({ jsPsych, trialType = globalThis.jsPsychHtmlKeyboardResponse, section, breakSpec, onRecord = () => {},
  clock = () => performance.now(), wallClock = () => new Date().toISOString(),
  timers = globalThis }) {
  const mandatory = breakSpec.kind === "mandatory";
  const minutes = breakSpec.durationMs / 60000;
  let opened, started, startedAt, openedAt, timer, finished = false, cleanup = () => {};
  return {
    type: trialType,
    choices: "NO_KEYS", response_ends_trial: false,
    data: { task: "system", event: "scheduled_break", section, break_kind: breakSpec.kind },
    stimulus: `<section class="study-progress-screen">
      <h2>${sectionProgressMessage(section)}</h2>
      <p>${section === 4
        ? "The image comparisons and metronome tapping are complete. After this break, you will receive instructions for the final picture judgments. A short set of questionnaires follows the tasks."
        : "Thank you for your effort. Each section includes picture comparisons followed by metronome tapping. Final picture judgments and questionnaires will follow the four sections."}</p>
      <p>${mandatory
        ? `Please take a break of at least <strong>${minutes} minutes</strong> before continuing.`
        : `You may take a <strong>${minutes}-minute break</strong> now, or continue immediately if you are ready.`}</p>
      <p>You may stand up, stretch, or rest. Please keep this window open. Scheduled breaks do not count as P-key pauses.</p>
      <p class="study-break-status" data-break-status role="status"></p>
      <div class="study-break-actions">
        ${mandatory ? "" : `<button type="button" class="study-response-button" data-break-action="take">Take a ${minutes}-minute break</button>`}
        <button type="button" class="study-response-button" data-break-action="continue" ${mandatory ? "disabled" : ""}>Continue when ready</button>
      </div>
      <p class="study-break-note">The task will wait for you to select Continue. It will not restart automatically.</p>
    </section>`,
    on_load() {
      opened = clock(); openedAt = wallClock();
      started = mandatory ? opened : null;
      startedAt = mandatory ? openedAt : null;
      const display = jsPsych.getDisplayElement();
      const status = display.querySelector("[data-break-status]");
      const next = display.querySelector('[data-break-action="continue"]');
      const take = display.querySelector('[data-break-action="take"]');
      const remaining = () => started === null ? 0 : Math.max(0, breakSpec.durationMs - (clock() - started));
      const refresh = () => {
        if (finished) return;
        const left = remaining();
        next.disabled = mandatory && left > 0;
        if (started === null) status.textContent = "Choose a break, or continue when ready.";
        else if (left > 0) {
          const seconds = Math.ceil(left / 1000);
          status.textContent = `${mandatory ? "Minimum" : "Suggested"} break time remaining: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}.${mandatory ? " Continue will become available when the timer ends." : " You may continue earlier if you are ready."}`;
        } else status.textContent = "Your break time is complete. Select Continue when you are ready.";
      };
      const startBreak = () => {
        if (started !== null || finished) return;
        started = clock(); startedAt = wallClock();
        take.hidden = true;
        refresh();
      };
      const proceed = () => {
        if (finished || (mandatory && remaining() > 0)) return;
        const ended = clock();
        finished = true;
        const breakMs = started === null ? 0 : Math.max(0, ended - started);
        jsPsych.finishTrial({
          task: "system", event: "scheduled_break", section, break_kind: breakSpec.kind,
          taken: started !== null, skipped: started === null,
          target_duration_ms: breakSpec.durationMs,
          minimum_duration_ms: mandatory ? breakSpec.durationMs : 0,
          break_duration_ms: breakMs, screen_duration_ms: Math.max(0, ended - opened),
          decision_duration_ms: Math.max(0, (started ?? ended) - opened),
          ended_early: started !== null && breakMs < breakSpec.durationMs,
          minimum_met: !mandatory || breakMs >= breakSpec.durationMs,
          screen_started_at_utc: openedAt, break_started_at_utc: startedAt,
          ended_at_utc: wallClock()
        });
      };
      take?.addEventListener("click", startBreak);
      next.addEventListener("click", proceed);
      timer = timers.setInterval(refresh, 250);
      refresh();
      cleanup = () => {
        finished = true;
        timers.clearInterval(timer);
        take?.removeEventListener("click", startBreak);
        next.removeEventListener("click", proceed);
      };
    },
    on_finish(data) { cleanup(); onRecord({ ...data }); }
  };
}
