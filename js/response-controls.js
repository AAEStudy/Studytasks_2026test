// Shared settings for judgment responses; metronome taps are never screened.
const STUDY_RESPONSE_SETTINGS = Object.freeze({
  fastThresholdMs: 250,
  fastStreakLength: 3,
  maxSpeedReminders: 2,
  imageReplayLimit: 5,
  finalImageReplayLimit: 3
});

const StudyResponses = (() => {
  // Earlier tasks share the default allowance. Final picture judgments have
  // their own allowance so earlier reminders cannot exhaust it.
  const reminderGroups = new Map();
  function reminderState(options = {}) {
    const group = options.reminderGroup ?? 'general';
    if (!reminderGroups.has(group)) {
      reminderGroups.set(group, { group, streaks: new Map(), pending: new Set(), shown: 0 });
    }
    return reminderGroups.get(group);
  }
  let cursorPosition = null;
  const trackCursor = event => {
    if (event.pointerType === 'mouse') cursorPosition = { x: event.clientX, y: event.clientY };
  };
  document.addEventListener('pointermove', trackCursor, true);
  document.addEventListener('pointerdown', trackCursor, true);
  document.addEventListener('pointerup', trackCursor, true);
  const reminderText = "You have been responding very quickly. Please take the time you need to consider each question and choose the response that best reflects your experience. Thank you.";

  function recordSpeed(kind, rt, options = {}) {
    const state = reminderState(options);
    const fast = Number.isFinite(rt) && rt >= 0 && rt < STUDY_RESPONSE_SETTINGS.fastThresholdMs;
    const streak = fast ? (state.streaks.get(kind) || 0) + 1 : 0;
    state.streaks.set(kind, streak);
    const due = streak >= STUDY_RESPONSE_SETTINGS.fastStreakLength && state.shown < STUDY_RESPONSE_SETTINGS.maxSpeedReminders;
    if (due) { state.pending.add(kind); state.streaks.set(kind, 0); }
    return { fast_response: fast, fast_streak: streak, speed_reminder_requested: due, speed_reminder_group: state.group };
  }

  function hasReminder(prefix, options = {}) {
    const state = reminderState(options);
    return state.shown < STUDY_RESPONSE_SETTINGS.maxSpeedReminders && [...state.pending].some(kind => kind.startsWith(prefix));
  }

  function takeReminder(prefix, options = {}) {
    const state = reminderState(options);
    const kinds = [...state.pending].filter(kind => kind.startsWith(prefix));
    kinds.forEach(kind => state.pending.delete(kind));
    if (!kinds.length || state.shown >= STUDY_RESPONSE_SETTINGS.maxSpeedReminders) return [];
    state.shown++;
    kinds.forEach(kind => state.streaks.set(kind, 0));
    return kinds;
  }

  // Require a primary mouse press on this screen. Keyboard clicks and the
  // second click of a double-click cannot answer the next screen.
  function freshClicks(root, onClick, canRespond = () => true) {
    let pressed = null;
    const cancel = () => { pressed = null; };
    const down = event => {
      pressed = null;
      const button = event.target.closest?.('[data-study-response]');
      if (event.pointerType !== 'mouse' || event.button !== 0 || !button || !root.contains(button) || button.disabled || !canRespond()) return;
      event.preventDefault();
      pressed = button;
    };
    const click = event => {
      const button = event.target.closest?.('[data-study-response]');
      const valid = pressed && pressed === button && event.detail === 1 && event.button === 0 && !button.disabled && canRespond();
      pressed = null;
      if (valid) onClick(button.dataset.studyResponse);
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('click', click, true);
    document.addEventListener('pointercancel', cancel, true);
    window.addEventListener('blur', cancel);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('blur', cancel);
    };
  }

  function finishMouseTrial(jsPsych, data) {
    jsPsych.pluginAPI.cancelAllKeyboardResponses();
    jsPsych.pluginAPI.clearAllTimeouts();
    jsPsych.finishTrial(data);
  }

  function mouseTrial(jsPsych, trial, { minMs = 0, minMovePx = 0 } = {}) {
    let cleanup = () => {};
    let finished = false;
    return {
      ...trial,
      type: jsPsychHtmlKeyboardResponse,
      choices: 'NO_KEYS',
      on_load: () => {
        cleanup();
        const onset = performance.now();
        finished = false;
        const root = jsPsych.getDisplayElement();
        const gated = minMs > 0 || minMovePx > 0;
        let origin = cursorPosition ? { ...cursorPosition } : null;
        let maxDistance = 0;
        let timer = null;
        const buttons = gated ? [...root.querySelectorAll('[data-study-response]')] : [];
        const ready = () => performance.now() - onset >= minMs && maxDistance >= minMovePx;
        const refresh = () => {
          if (finished) return;
          buttons.forEach(button => {
            button.disabled = !ready();
            button.setAttribute('aria-disabled', String(!ready()));
          });
        };
        const move = event => {
          if (event.pointerType !== 'mouse') return;
          if (!origin) origin = { x: event.clientX, y: event.clientY };
          maxDistance = Math.max(maxDistance, Math.hypot(event.clientX - origin.x, event.clientY - origin.y));
          refresh();
        };
        const activateWhenDue = () => {
          if (finished) return;
          const remaining = minMs - (performance.now() - onset);
          if (remaining > 0) timer = window.setTimeout(activateWhenDue, Math.ceil(remaining));
          else refresh();
        };
        if (gated) {
          document.addEventListener('pointermove', move, true);
          activateWhenDue();
          refresh();
        }
        const removeClicks = freshClicks(root, response => {
          if (finished) return;
          finished = true;
          cleanup();
          finishMouseTrial(jsPsych, {
            response, rt: performance.now() - onset,
            ...(gated ? {
              certainty_min_ms: minMs,
              certainty_min_move_px: minMovePx,
              certainty_max_move_px: maxDistance
            } : {})
          });
        }, ready);
        cleanup = () => {
          finished = true;
          if (timer !== null) window.clearTimeout(timer);
          if (gated) document.removeEventListener('pointermove', move, true);
          removeClicks();
        };
      },
      on_finish: data => { cleanup(); trial.on_finish?.(data); }
    };
  }

  function reminderHtml() { return `<p class="speed-reminder" role="status">${reminderText}</p>`; }

  function reminderTrial(jsPsych, onShown, options = {}) {
    return {
      timeline: [mouseTrial(jsPsych, {
        stimulus: `<section class="emotion-response-screen">${reminderHtml()}<button class="study-response-button" data-study-response="continue" tabindex="-1">Continue</button></section>`,
        data: { task: 'system', event: 'speed_reminder', speed_reminder_group: reminderState(options).group },
        on_start: trial => {
          const kinds = takeReminder('emotion_', options);
          trial.data = { ...trial.data, reminder_kinds: kinds, reminder_number: reminderState(options).shown };
          onShown(kinds);
        }
      })],
      conditional_function: () => hasReminder('emotion_', options)
    };
  }

  return { recordSpeed, hasReminder, takeReminder, freshClicks, finishMouseTrial, mouseTrial, reminderHtml, reminderTrial };
})();
