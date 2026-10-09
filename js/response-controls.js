// Shared settings for judgment responses; metronome taps are never screened.
const STUDY_RESPONSE_SETTINGS = Object.freeze({
  fastThresholdMs: 250,
  fastStreakLength: 3,
  maxSpeedReminders: 2,
  imageReplayLimit: 5
});

const StudyResponses = (() => {
  const streaks = new Map();
  const pending = new Set();
  let remindersShown = 0;
  const reminderText = "You have been responding very quickly. Please take the time you need to consider each question and choose the response that best reflects your experience. Thank you.";

  function recordSpeed(kind, rt) {
    const fast = Number.isFinite(rt) && rt >= 0 && rt < STUDY_RESPONSE_SETTINGS.fastThresholdMs;
    const streak = fast ? (streaks.get(kind) || 0) + 1 : 0;
    streaks.set(kind, streak);
    const due = streak >= STUDY_RESPONSE_SETTINGS.fastStreakLength && remindersShown < STUDY_RESPONSE_SETTINGS.maxSpeedReminders;
    if (due) { pending.add(kind); streaks.set(kind, 0); }
    return { fast_response: fast, fast_streak: streak, speed_reminder_requested: due };
  }

  function hasReminder(prefix) {
    return remindersShown < STUDY_RESPONSE_SETTINGS.maxSpeedReminders && [...pending].some(kind => kind.startsWith(prefix));
  }

  function takeReminder(prefix) {
    const kinds = [...pending].filter(kind => kind.startsWith(prefix));
    kinds.forEach(kind => pending.delete(kind));
    if (!kinds.length || remindersShown >= STUDY_RESPONSE_SETTINGS.maxSpeedReminders) return [];
    remindersShown++;
    kinds.forEach(kind => streaks.set(kind, 0));
    return kinds;
  }

  // Require a primary mouse press on this screen. Keyboard clicks and the
  // second click of a double-click cannot answer the next screen.
  function freshClicks(root, onClick) {
    let pressed = null;
    const cancel = () => { pressed = null; };
    const down = event => {
      pressed = null;
      const button = event.target.closest?.('[data-study-response]');
      if (event.pointerType !== 'mouse' || event.button !== 0 || !button || !root.contains(button) || button.disabled) return;
      event.preventDefault();
      pressed = button;
    };
    const click = event => {
      const button = event.target.closest?.('[data-study-response]');
      const valid = pressed && pressed === button && event.detail === 1 && event.button === 0 && !button.disabled;
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

  function mouseTrial(jsPsych, trial) {
    let cleanup = () => {};
    let finished = false;
    return {
      ...trial,
      type: jsPsychHtmlKeyboardResponse,
      choices: 'NO_KEYS',
      on_load: () => {
        const onset = performance.now();
        finished = false;
        cleanup = freshClicks(jsPsych.getDisplayElement(), response => {
          if (finished) return;
          finished = true;
          cleanup();
          finishMouseTrial(jsPsych, { response, rt: performance.now() - onset });
        });
      },
      on_finish: data => { cleanup(); trial.on_finish?.(data); }
    };
  }

  function reminderHtml() { return `<p class="speed-reminder" role="status">${reminderText}</p>`; }

  function reminderTrial(jsPsych, onShown) {
    return {
      timeline: [mouseTrial(jsPsych, {
        stimulus: `<section class="emotion-response-screen">${reminderHtml()}<button class="study-response-button" data-study-response="continue" tabindex="-1">Continue</button></section>`,
        data: { task: 'system', event: 'speed_reminder' },
        on_start: trial => {
          const kinds = takeReminder('emotion_');
          trial.data = { ...trial.data, reminder_kinds: kinds, reminder_number: remindersShown };
          onShown(kinds);
        }
      })],
      conditional_function: () => hasReminder('emotion_')
    };
  }

  return { recordSpeed, hasReminder, takeReminder, freshClicks, finishMouseTrial, mouseTrial, reminderHtml, reminderTrial };
})();
