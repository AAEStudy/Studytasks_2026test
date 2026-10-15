const MRT_CERTAINTY_MIN_MS = 600;
const MRT_CERTAINTY_MIN_MOVE_PX = 100;
const MRT_RESPONSE_FORMAT_VERSION = "mrt-probes-v13-basis-horizontal";
const MRT_PROBE_ORDER = "focus,basis,confidence";
const MRT_CERTAINTY_LABELS = ["Very unconfident", "Unconfident", "Confident", "Very confident"];
const MRT_FOCUS_RESPONSE_HTML = `
<div style="display: inline-block; width: 1050px;">
                      <div style="display: flex; justify-content: space-between; margin-bottom: 5px; margin-top: 100px;">
                          <div style="width: 150px; text-align: center; font-size:20pt;">Least on Task</div>
                          <div style="width: 225px;"></div>
                          <div style="width: 150px; text-align: center; font-size:20pt; display: flex; align-items: center; justify-content: center">Middle</div>
                          <div style="width: 225px;"></div>
                          <div style="width: 150px; text-align: center; font-size:20pt;">Most on Task</div>
                      </div>
                      <div style="display: flex; justify-content: space-evenly; align-items: center;">
                          <div style="width: 150px; text-align: center; font-size:20pt;">[1]</div>
                          <div style="width: 150px; text-align: center; font-size:20pt;">[2]</div>
                          <div style="width: 150px; text-align: center; font-size:20pt;">[3]</div>
                          <div style="width: 71.5px; text-align: center; font-size:20pt;"></div>
                          <div style="width: 2px; height: 25px; background-color: white;"></div>
                          <div style="width: 71.5px; text-align: center; font-size:20pt;"></div>
                          <div style="width: 150px; text-align: center; font-size:20pt;">[4]</div>
                          <div style="width: 150px; text-align: center; font-size:20pt;">[5]</div>
                          <div style="width: 150px; text-align: center; font-size:20pt;">[6]</div>
                      </div>
                      <div style="display: flex; justify-content: center; margin-top: 150px;">
                          <div style="width: 600px; text-align: center; font-size:16pt;">
                              Indicate how focused you were on clicking along to the metronome just before we asked. Press a key (1–6) for your response.
                            </div>
                      </div>
                  </div>
`;
const MRT_BASIS_OPTIONS = {
  remembered_thoughts: { key: "C", text: "My memory of what I had been thinking about." },
  general_feeling: { key: "F", text: "A feeling of how focused or unfocused I had been." },
  other: { key: "O", text: "Something other than these two." }
};
function mrtBasisDisplayOrder(basisOrder) {
  return basisOrder === "feeling_first"
    ? ["general_feeling", "remembered_thoughts", "other"]
    : ["remembered_thoughts", "general_feeling", "other"];
}
function renderMrtBasisOptions(basisOrder) {
  const order = mrtBasisDisplayOrder(basisOrder);
  return `<ul class="mrt-basis-options" role="list" data-basis-display-order="${order.join(",")}">
    ${order.map(value => {
      const option = MRT_BASIS_OPTIONS[value];
      return `<li class="mrt-basis-option" data-basis="${value}"><span class="mrt-basis-label">${option.text}</span><span class="mrt-basis-key" aria-label="Press ${option.key}">[${option.key}]</span></li>`;
    }).join("\n")}
  </ul>`;
}

// Track the cursor across screens, before a certainty question takes its baseline.
let mrtCursorPosition = null;
function trackMrtCursor(event) {
  if (event.pointerType === "mouse") mrtCursorPosition = { x: event.clientX, y: event.clientY };
}
document.addEventListener("pointermove", trackMrtCursor, true);
document.addEventListener("pointerdown", trackMrtCursor, true);
document.addEventListener("pointerup", trackMrtCursor, true);

function mrtResponseMetadata(basisOrder) {
  return {
    response_format_version: MRT_RESPONSE_FORMAT_VERSION,
    probe_order: MRT_PROBE_ORDER,
    certainty_min_ms: MRT_CERTAINTY_MIN_MS,
    certainty_min_move_px: MRT_CERTAINTY_MIN_MOVE_PX,
    fast_threshold_ms: STUDY_RESPONSE_SETTINGS.fastThresholdMs,
    fast_streak_length: STUDY_RESPONSE_SETTINGS.fastStreakLength,
    speed_reminder_limit: STUDY_RESPONSE_SETTINGS.maxSpeedReminders,
    ...(basisOrder === undefined ? {} : {
      basis_display_order: mrtBasisDisplayOrder(basisOrder).join(","),
      basis_layout: "horizontal"
    })
  };
}

function mrtConfidenceStimulus(question, extraClass = "") {
  return `<section class="mrt-probe-screen mrt-certainty-screen ${extraClass}">
      <p class="mrt-probe-question">${question}</p>
      <div class="mrt-certainty-options">
        ${MRT_CERTAINTY_LABELS.map((label, index) => `<button type="button" class="mrt-certainty-option" data-value="${index + 1}" aria-disabled="true" tabindex="-1"><span class="confidence-option-number">${index + 1}</span><span class="confidence-option-label">${label}</span></button>`).join("")}
      </div>
      <p class="mrt-certainty-hint">Move the mouse a noticeable distance, then click your answer.</p>
    </section>`;
}

function buildMrtCertaintyTrial(jsPsych, onResponse, options = {}) {
  let cleanup = () => {};
  return {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: mrtConfidenceStimulus("How confident are you that the level of focus to the task you indicated was accurate?"),
    choices: "NO_KEYS",
    data: {
      ...(options.instructedResponse
        ? { instructed_response_probe: 1, thought_probe: 0, probe_kind: "response_check" }
        : { probe_question: 3, probe_kind: "confidence", thought_probe: 1 }),
      ...mrtResponseMetadata(options.basisOrder), ...options.data
    },
    on_load: () => {
      const onset = performance.now();
      let origin = mrtCursorPosition ? { ...mrtCursorPosition } : null;
      let maxDistance = 0;
      let pendingPress = null;
      let finished = false;
      const buttons = [...jsPsych.getDisplayElement().querySelectorAll(".mrt-certainty-option")];
      const ready = () => performance.now() - onset >= MRT_CERTAINTY_MIN_MS && maxDistance >= MRT_CERTAINTY_MIN_MOVE_PX;
      const refresh = () => buttons.forEach(button => button.setAttribute("aria-disabled", String(!ready())));
      const move = event => {
        if (event.pointerType !== "mouse") return;
        // If no cursor event preceded this screen, the first event establishes its origin.
        if (!origin) origin = { x: event.clientX, y: event.clientY };
        maxDistance = Math.max(maxDistance, Math.hypot(event.clientX - origin.x, event.clientY - origin.y));
        refresh();
      };
      const press = event => {
        pendingPress = null;
        const button = event.target.closest?.(".mrt-certainty-option");
        if (event.pointerType !== "mouse" || event.button !== 0 || !buttons.includes(button)) return;
        event.preventDefault();
        if (ready()) pendingPress = button;
      };
      const cancelPress = () => { pendingPress = null; };
      const click = event => {
        const pressed = pendingPress;
        pendingPress = null;
        const button = event.target.closest?.(".mrt-certainty-option");
        // A new mouse-down on this screen must itself meet both activation conditions.
        if (finished || event.detail === 0 || event.button !== 0 || pressed !== button || !pressed || !ready()) return;
        const response = Number(pressed.dataset.value);
        finished = true;
        cleanup();
        jsPsych.finishTrial({
          response,
          rt: performance.now() - onset,
          ...(options.instructedResponse
            ? { instructed_response_label: MRT_CERTAINTY_LABELS[response - 1] }
            : { confidence_rating: response, confidence_label: MRT_CERTAINTY_LABELS[response - 1] }),
          certainty_max_move_px: maxDistance,
          ...mrtResponseMetadata(options.basisOrder)
        });
      };
      document.addEventListener("pointermove", move, true);
      document.addEventListener("pointerdown", press, true);
      document.addEventListener("click", click, true);
      document.addEventListener("pointercancel", cancelPress, true);
      window.addEventListener("blur", cancelPress);
      let timer;
      const activateWhenDue = () => {
        const remaining = MRT_CERTAINTY_MIN_MS - (performance.now() - onset);
        if (remaining > 0) timer = window.setTimeout(activateWhenDue, Math.ceil(remaining));
        else refresh();
      };
      activateWhenDue();
      cleanup = () => {
        window.clearTimeout(timer);
        document.removeEventListener("pointermove", move, true);
        document.removeEventListener("pointerdown", press, true);
        document.removeEventListener("click", click, true);
        document.removeEventListener("pointercancel", cancelPress, true);
        window.removeEventListener("blur", cancelPress);
      };
      refresh();
    },
    on_finish: data => {
      cleanup();
      onResponse(data);
    }
  };
}

// Schedule instruction/practice without generating or consuming main MRT blocks.
function buildMRTPractice(params){
  return buildMRTChunk({ ...params, practiceOnly: true, blocksToTake: 0 });
}

function buildMRTChunk(params){
const subjectID = params.subjectID;
const metronomeAudio = params.metronomeAudio;
const practiceOnly = params.practiceOnly === true;
var jsPsych = params.jsPsych;
      // Prevent accidental page unload.
      function handleBeforeUnload(e) {
          e.preventDefault();
          e.returnValue = '';
        };

      // Add the listener using the named function
      window.addEventListener('beforeunload', handleBeforeUnload);
      var jsPsych = params.jsPsych;

      // ---------------- Global Variables & Data Storage ----------------
      //setIDfromlink();
      if (params._state.trialNum === undefined) params._state.trialNum = 0;
      if (params._state.probeBlockCounter === undefined) params._state.probeBlockCounter = 0;
      // Assign once per shared session; repeats and later chunks retain this display order.
      if (params._state.mrtBasisOrder === undefined) {
        params._state.mrtBasisOrder = Math.random() < 0.5 ? "memory_first" : "feeling_first";
      }
      const basisOrder = params._state.mrtBasisOrder;
      if (basisOrder !== "memory_first" && basisOrder !== "feeling_first") {
        throw new RangeError("MRT basis order must be memory_first or feeling_first.");
      }
      const responseMetadata = () => mrtResponseMetadata(basisOrder);
      const basisOptionsHtml = renderMrtBasisOptions(basisOrder);
      let customData = params._state.customData;
      if (!customData) {
        customData = {
          subject: [],
          trial: [],
          task: [],
          trial_num: [],
          RT_from_metronome: [],
          omission: [],
          performance_rating: [],
          probe1_rt: [],
          probe2_rt: [],
          confidence_rating: [],
          pause_time: [],
          break_time: [],
          instructed_response: [],
          instructed_response_expected: [],
          instructed_response_correct: [],
          instructed_response_rt_ms: [],
          confidence_label: [],
          main_basis: [],
          probe3_rt: [],
          response_format_version: [],
          certainty_min_ms: [],
          certainty_min_move_px: [],
          fast_threshold_ms: [],
          fast_streak_length: [],
          speed_reminder_limit: [],
          probe1_fast: [],
          probe3_fast: [],
          speed_reminder_shown: [],
          speed_reminder_kinds: [],
          basis_display_order: [],
          basis_layout: []
        };
        params._state.customData = customData;
      }
      // Older caller-provided state may omit the new fields; preserve its existing row alignment.
      if (customData.basis_display_order === undefined) {
        customData.basis_display_order = new Array(customData.subject.length).fill("NA");
      }
      if (customData.basis_layout === undefined) {
        customData.basis_layout = new Array(customData.subject.length).fill("NA");
      }
      // Flag to ensure we only run instructions + practice once across interleaving
      if (params._state.mrtInitialized === undefined) params._state.mrtInitialized = false;
      const lag_time = 650;
      let tempPerformance = null;
      let tempProbeRT1 = null;
      let tempProbeRT2 = null;
      let tempConfidence = null;
      let tempConfidenceLabel = null;
      let tempBasis = null;
      let tempBasisRT = null;
      let tempFocusFast = false;
      let tempBasisFast = false;
      let lastProbeRow = null;
      let pause = false;
      let pauseStart = 0;
      let pendingTapTick = null;
      let repeatPractice = false;
      let practiceConsecutiveMisses = 0;
      let mainConsecutiveMisses = 0;
      let practiceLastRT = null;
      let mainLastRT = null;

      
      // ---------------- Approved recap before MRT practice ----------------
      const MRT_INSTRUCTION_MIN_VIEW_MS = 10000;
      let cleanupMrtInstructionLock = null;

      let instructions_pages = [
        `<section class="mrt-instructions">
          <h2><u>Metronome Task</u></h2>
          <p><strong>Quick Recap:</strong></p>
          <p>The metronome plays at a <strong>constant pace</strong>. Press the <strong>SPACEBAR in exact synchrony with the start of each sound</strong>. Your accuracy depends on how close your key press is to the start of the sound. A <strong>+</strong> confirms that your key press registered.</p>
          <p>If an external interruption occurs while you are tapping, press <strong>P</strong> to pause. Press <strong>P</strong> again to resume.</p>
          <p><strong>If you pause for too long or more than 3 times, we won't be able to use your data.</strong></p>
        </section>`,
        `<section class="mrt-instructions">
          <h2><u>Metronome Task</u></h2>
          <p>Occasionally, the metronome will automatically pause for three questions, in this order: <strong>focus, main basis, and confidence</strong>.</p>
          <p>Your focus rating should refer to the <strong>preceding 15 seconds or so of tapping</strong>.</p>
          <p>First, press <strong>1–6</strong> to indicate how focused you were on keeping your presses synchronized with the metronome. Rate your focus relative to your <strong>own</strong> levels throughout the task: <strong>1 = least on task; 6 = most on task</strong>. Choose <strong>1–3</strong> for below your middle level and <strong>4–6</strong> for above it.</p>
          <p>Use the <strong>full range of focus ratings</strong> as appropriate.</p>
        </section>`,
        `<section class="mrt-instructions">
          <h2><u>Metronome Task</u></h2>
          <p>Next, indicate what mainly informed your original focus rating: press <strong>C</strong> for remembered thoughts, <strong>F</strong> for a feeling of how focused or unfocused you had been, or <strong>O</strong> for something other than these two.</p>
          <p>Remembered thoughts may be vague or partial, and may concern the task or something unrelated. A feeling about your focus does not require remembering particular thoughts.</p>
          <p>If both contributed, choose whichever <strong>influenced your rating more</strong>, rather than whichever experience was clearest or strongest. Choose <strong>O</strong> only when another source influenced your rating more than either memory or feeling.</p>
        </section>`,
        `<section class="mrt-instructions">
          <h2><u>Metronome Task</u></h2>
          <p>Finally, you will indicate how confident you are that your focus rating accurately described how focused you were just before the pause.</p>
          <p>You will move the mouse and click one answer:</p>
          <ul>
            <li><strong>1 = Very unconfident</strong></li>
            <li><strong>2 = Unconfident</strong></li>
            <li><strong>3 = Confident</strong></li>
            <li><strong>4 = Very confident</strong></li>
          </ul>
          <p>You can be confident or unconfident about either a high or a low focus rating.</p>
          <p>Use the <strong>full range of confidence ratings</strong> as appropriate.</p>
          <p>Please respond honestly and effortfully. Practice trials will begin next.</p>
        </section>`
      ];

      // Keep all instruction pages in one instructions trial so Previous works normally.
      // Keyboard navigation is disabled by the plugin itself, and the clickable controls
      // are genuinely disabled for the minimum reading time the first time each page is viewed.
      let instructionsTrials = [{
        type: jsPsychInstructions,
        pages: instructions_pages,
        show_clickable_nav: true,
        show_page_number: true,
        allow_keys: false,
        allow_backward: true,
        button_label_previous: "PREVIOUS",
        button_label_next: "NEXT",
        button_label_last: "START",
        on_load: function() {
          const displayElement = document.querySelector(".jspsych-display-element");
          if (!displayElement) return;

          let unlockTimeout = null;
          let countdownInterval = null;
          let observedPage = null;
          const completedPages = new Set();

          function clearLockTimers() {
            if (unlockTimeout !== null) window.clearTimeout(unlockTimeout);
            if (countdownInterval !== null) window.clearInterval(countdownInterval);
            unlockTimeout = null;
            countdownInterval = null;
          }

          function getPageKey() {
            const pageNumber = document.querySelector(".jspsych-instructions-pagenum");
            if (pageNumber) return pageNumber.textContent.trim();

            const content = document.querySelector(".mrt-instructions") || document.querySelector("#jspsych-instructions-content");
            return content ? content.textContent.trim().slice(0, 120) : null;
          }

          function lockCurrentPage() {
            const navContainer = document.querySelector(".jspsych-instructions-nav");
            const pageKey = getPageKey();
            if (!navContainer || !pageKey || pageKey === observedPage) return;

            observedPage = pageKey;
            clearLockTimers();

            const nextButton = navContainer.querySelector("#jspsych-instructions-next");
            if (nextButton) {
              const pageMatch = pageKey.match(/(\d+)\s*\/\s*(\d+)$/);
              const isLastPage = instructions_pages.length === 1 || (pageMatch && Number(pageMatch[1]) === Number(pageMatch[2]));
              nextButton.innerHTML = `${isLastPage ? "START" : "NEXT"} &gt;`;
            }

            let status = document.getElementById("mrt-instruction-lock-status");
            if (!status) {
              status = document.createElement("p");
              status.id = "mrt-instruction-lock-status";
              status.setAttribute("role", "status");
              status.setAttribute("aria-live", "polite");
              navContainer.parentNode.insertBefore(status, navContainer);
            }

            if (completedPages.has(pageKey)) {
              status.textContent = "You have already read this page. You may continue.";
              return;
            }

            const navButtons = navContainer.querySelectorAll("button");
            navButtons.forEach(function(button) {
              button.dataset.mrtWasDisabled = button.disabled ? "true" : "false";
              button.disabled = true;
            });

            const unlockAt = Date.now() + MRT_INSTRUCTION_MIN_VIEW_MS;
            function updateStatus() {
              const remainingSeconds = Math.max(0, Math.ceil((unlockAt - Date.now()) / 1000));
              status.textContent = remainingSeconds > 0
                ? `Please read this page. Navigation unlocks in ${remainingSeconds} second${remainingSeconds === 1 ? "" : "s"}.`
                : (instructions_pages.length === 1 ? "You may now begin practice." : "You may now continue or return to the previous page.");
            }

            updateStatus();
            countdownInterval = window.setInterval(updateStatus, 250);
            unlockTimeout = window.setTimeout(function() {
              completedPages.add(pageKey);
              window.clearInterval(countdownInterval);
              countdownInterval = null;
              updateStatus();

              document.querySelectorAll(".jspsych-instructions-nav button").forEach(function(button) {
                if (button.dataset.mrtWasDisabled !== "true") button.disabled = false;
              });
            }, MRT_INSTRUCTION_MIN_VIEW_MS);
          }

          const observer = new MutationObserver(function() {
            window.requestAnimationFrame(lockCurrentPage);
          });
          observer.observe(displayElement, { childList: true, subtree: true });
          // A rapid second click can arrive before the observer paints the new page's lock.
          // Check its current page synchronously before the instructions plugin handles navigation.
          function guardInstructionNavigation(event) {
            const button = event.target?.closest?.(".jspsych-instructions-nav button");
            if (!button) return;
            lockCurrentPage();
            if (button.disabled) {
              event.preventDefault();
              event.stopImmediatePropagation();
            }
          }
          document.addEventListener("click", guardInstructionNavigation, true);
          lockCurrentPage();

          cleanupMrtInstructionLock = function() {
            clearLockTimers();
            observer.disconnect();
            document.removeEventListener("click", guardInstructionNavigation, true);
            cleanupMrtInstructionLock = null;
          };
        },
        on_finish: function() {
          if (cleanupMrtInstructionLock) cleanupMrtInstructionLock();
        }
      }];


      // ---------------- Countdown Functions ----------------
      function add_countdown(n, l=1300) {
        return {
          type: jsPsychHtmlKeyboardResponse,
          stimulus: `<p style="font-size: 18pt;">${n}</p>`,
          response_ends_trial: false,
          trial_duration: l,
        };
      }
      function add_countdown_pad() {
        return {
          type: jsPsychHtmlKeyboardResponse,
          stimulus: "",
          response_ends_trial: false,
          on_start: function() { leadup_ticks(); },
          trial_duration: 650
        };
      }
      function leadup_ticks() {
        setTimeout(() => { play_metronome_tick(); }, 650);
        setTimeout(() => { play_metronome_tick(); }, 650 + 1300);
        setTimeout(() => { play_metronome_tick(); }, 650 + 2*1300);
        setTimeout(() => { play_metronome_tick(); }, 650 + 3*1300);
      }

      // ---------------- Data Saving Functions ----------------
      function saveProbeMetadata(label = "NA", basis = "NA", basisRT = "NA", check = {}) {
        customData.confidence_label.push(label);
        customData.main_basis.push(basis);
        customData.probe3_rt.push(basisRT);
        customData.instructed_response_expected.push(check.expected ?? "NA");
        customData.instructed_response_correct.push(check.correct ?? "NA");
        customData.instructed_response_rt_ms.push(check.rt ?? "NA");
        customData.probe1_fast.push(basis === "NA" ? "NA" : tempFocusFast);
        customData.probe3_fast.push(basis === "NA" ? "NA" : tempBasisFast);
        customData.speed_reminder_shown.push(false);
        customData.speed_reminder_kinds.push("");
        const metadata = responseMetadata();
        // The order column is appended after session metadata by the exporter.
        for (const key of Object.keys(metadata)) if (key !== "probe_order") customData[key].push(metadata[key]);
      }
      function saveTappingTrial(score, taskType = "metronome") {
        const trialNum = ++params._state.trialNum;
        customData.subject.push(subjectID);
        customData.trial.push(trialNum);
        customData.task.push(taskType); // will be "practice trial" or "metronome"
        customData.trial_num.push(trialNum);
        customData.RT_from_metronome.push(score);
        customData.omission.push(score === "" ? "TRUE" : "FALSE");
        customData.performance_rating.push("NA");
        customData.probe1_rt.push("NA");
        customData.probe2_rt.push("NA");
        customData.confidence_rating.push("NA");
        //customData.probe_text.push("NA");
        customData.pause_time.push("NA");
        customData.instructed_response.push("NA"); // Not applicable for tapping trials
        saveProbeMetadata();
      }
      function saveThoughtProbeTrial(basis, basisRT, isPractice = false) {
        const trialNum = ++params._state.trialNum;
        customData.subject.push(subjectID);
        customData.trial.push(trialNum);
        customData.task.push(isPractice ? "practice_probe" : "thought_probe");
        customData.trial_num.push(trialNum);
        customData.RT_from_metronome.push("NA");
        customData.omission.push("FALSE");
        customData.performance_rating.push(tempPerformance);
        customData.probe1_rt.push(tempProbeRT1);
        customData.probe2_rt.push(tempProbeRT2);
        customData.confidence_rating.push(tempConfidence);
        customData.instructed_response.push("NA");
        //customData.instructed_response.push("instructed_response"); 
        customData.pause_time.push("NA");
        saveProbeMetadata(tempConfidenceLabel, basis, basisRT);
        const probeRow = customData.subject.length - 1;
        if (isPractice) {
          customData.probe1_fast[probeRow] = "NA";
          customData.probe3_fast[probeRow] = "NA";
        } else {
          lastProbeRow = probeRow;
        }
        tempPerformance = null;
        tempProbeRT1 = null;
        tempProbeRT2 = null;
        tempConfidence = null;
        tempConfidenceLabel = null;
        tempBasis = null;
        tempBasisRT = null;
      }
      function savePauseTrial(pauseDuration) {
        const trialNum = ++params._state.trialNum;
        customData.subject.push(subjectID);
        customData.trial.push(trialNum);
        customData.task.push("pause");
        customData.trial_num.push(trialNum);
        customData.RT_from_metronome.push("NA");
        customData.omission.push("pause");
        customData.performance_rating.push("NA");
        customData.probe1_rt.push("NA");
        customData.probe2_rt.push("NA");
        customData.confidence_rating.push("NA");
        //customData.probe_text.push("NA");
        customData.pause_time.push(pauseDuration.toFixed(3));
        customData.instructed_response.push("NA"); // Not applicable for pause trial
        saveProbeMetadata();
      }
      function convertToCSV(dataObj, metadata = {}) {
        if (!dataObj || typeof dataObj !== "object" || Array.isArray(dataObj)) {
          throw new TypeError("MRT export data must be an object of column arrays.");
        }
        if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
          throw new TypeError("MRT export metadata must be an object.");
        }
        const allColumns = Object.keys(dataObj);
        const basisColumns = ["basis_display_order", "basis_layout"].filter(column => allColumns.includes(column));
        const columns = allColumns.filter(column => !basisColumns.includes(column));
        for (const column of allColumns) {
          if (!Array.isArray(dataObj[column])) {
            throw new TypeError(`MRT export column "${column}" must be an array.`);
          }
        }
        const metadataColumns = Object.keys(metadata);
        const usedColumns = new Set(allColumns);
        for (const reserved of ["row_index", "probe_order"]) {
          if (usedColumns.has(reserved)) throw new Error(`MRT export data cannot contain the reserved column "${reserved}".`);
          usedColumns.add(reserved);
        }
        for (const column of metadataColumns) {
          if (usedColumns.has(column)) {
            throw new Error(`MRT export metadata column "${column}" duplicates an export column.`);
          }
          usedColumns.add(column);
        }
        const cell = value => {
          if (value == null || (typeof value === "number" && !Number.isFinite(value))) return "";
          const text = String(value);
          return /[\t\r\n"]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
        };
        // New basis fields follow the prior complete schema, including session metadata.
        const header = [...columns, "row_index", ...metadataColumns, "probe_order", ...basisColumns];
        const numRows = allColumns.reduce((count, column) => Math.max(count, dataObj[column].length), 0);
        const metadataValues = metadataColumns.map(column => metadata[column]);
        const rows = [header.map(cell).join("\t")];
        for (let i = 0; i < numRows; i++) {
          rows.push([...columns.map(column => dataObj[column][i]), i + 1, ...metadataValues, MRT_PROBE_ORDER, ...basisColumns.map(column => dataObj[column][i])].map(cell).join("\t"));
        }
        return rows.join("\n") + "\n";
      }
      function play_metronome_tick() {
        if (pause) return;
        metronomeAudio.currentTime = 0;
        metronomeAudio.play();
      }
      function cancelPendingTapTick() {
        if (pendingTapTick !== null) clearTimeout(pendingTapTick);
        pendingTapTick = null;
      }
      function scheduleTapTick() {
        cancelPendingTapTick();
        pendingTapTick = setTimeout(function() {
          pendingTapTick = null;
          play_metronome_tick();
        }, lag_time);
      }
      function pauseTapping() {
        pause = true;
        cancelPendingTapTick();
        metronomeAudio.pause();
        metronomeAudio.currentTime = 0;
      }

      // ---------------- Pause Functionality ----------------
      let pause_trial = {
        type: jsPsychHtmlKeyboardResponse,
        stimulus: `<p style='text-align:center;font-size:100px;'>⏸️</p>
                     <p style='text-align:center;'>Press <strong>[P]</strong> to continue.</p>`,
        choices: ["p"],
        response_ends_trial: true,
        trial_duration: null,
        on_start: function() {
          pauseStart = performance.now();
        },
        on_finish: function() {
          pause = false;
          let pauseEnd = performance.now();
          let pauseSec = (pauseEnd - pauseStart) / 1000;
          savePauseTrial(pauseSec);
        }
      };
      let pause_node = {
        timeline: [pause_trial],
        conditional_function: function() { return pause; }
      };

      // ---------------- PRACTICE TAPPING ----------------
      let practice_tapping_main = {
        type: jsPsychHtmlKeyboardResponse,
        stimulus: "",
        choices: [" ", "p"],
        response_ends_trial: true,
        trial_duration: 1300,
        on_start: function() {
          practiceLastRT = null;
          scheduleTapTick();
        },
        on_finish: function(data) {
          if(data.response === "p") {
            pauseTapping();
            practiceLastRT = null; 
          } else if(data.response === " " && Number.isFinite(data.rt) && data.rt >= 0) {
            practiceLastRT = data.rt;
          } else {
            practiceLastRT = null;
          }
        }
      };
      let practice_tapping_pad = {
        type: jsPsychHtmlKeyboardResponse,
        stimulus: function() {
          if (practiceLastRT === null || pause) return "";
          return '<div class="plus">+</div>';
        },
        // SPACE has already been accepted for this cycle; only P may interrupt feedback.
        choices: ["p"],
        response_ends_trial: true,
        trial_duration: function() {
          if (practiceLastRT === null) {
            return 0;
          }
          let leftover = 1300 - practiceLastRT;
          return leftover > 0 ? leftover : 0;
        },
        on_finish: function(data) {
          if(practiceLastRT === null) {
            if (data.response !== "p") {
              saveTappingTrial("", "practice trial");
              practiceConsecutiveMisses++;
            }
          } else {
            let score = practiceLastRT - lag_time;
            saveTappingTrial(score, "practice trial");
            practiceConsecutiveMisses = 0;
          }
          if (data.response === "p") pauseTapping();
        }
      };
      let practice_pad_node = {
        timeline: [practice_tapping_pad],
        conditional_function: function() {
          return !pause;
        }
      };

      let practice_tapping_trial = {
        timeline: [practice_tapping_main, practice_pad_node, pause_node]
      };

      let break_trial = {
        type: jsPsychHtmlKeyboardResponse,
        stimulus: `
          <p style="color:white; font-size:20pt; text-align:left;">
            You have finished the first half of this task. Nice job!<br><br>
            You may now take a short break (up to 2-3 mins max) to use the bathroom, stand up, stretch, etc. if needed.
          </p>
          <p style="color:white; text-align:center;">
            You have a little over 10 minutes left.
            Press SPACE to continue with the second half of this task.
          </p>
        `,
        choices: [" "],
        on_start: function() {
          // Record the break start time (using a global variable or within the trial data)
          window.breakStartTime = performance.now();
        },
        on_finish: function(data) {
          // Calculate the break duration in seconds
          let breakDuration = (performance.now() - window.breakStartTime) / 1000;
          // Attach break duration to this trial’s data if you like
          data.break_duration = breakDuration;
          // And record it in your customData object
          customData.break_time.push(breakDuration.toFixed(3));
        }
      };


      let practice_miss_node = {
        timeline: [
          {
            type: jsPsychHtmlKeyboardResponse,
            stimulus: "<p>You haven't pressed SPACE for the last 4 trials.<br>Remember to press SPACE in time with the metronome.<br><br>Press SPACE to continue.</p>",
            choices: [" "],
            on_finish: function() {
              practiceConsecutiveMisses = 0;
            }
          }
        ],
        conditional_function: function() {
          return practiceConsecutiveMisses >= 4;
        }
      };
      const numPracticeTrials = 30;
      let practice_trial_counter = 0;
      let practice_block = {
        timeline: [
          {
            timeline: [practice_tapping_trial, practice_miss_node],
            loop_function: function() {
              practice_trial_counter++;
              return (practice_trial_counter < numPracticeTrials);
            }
          }
        ]
      };
      let practiceProbeAttempt = 0;
      const practiceProbeData = { task: "mrt", phase: "practice", practice_probe: 1, thought_probe: 0 };
      const practiceCertaintyTrial = buildMrtCertaintyTrial(jsPsych, data => {
        tempProbeRT2 = (data.rt / 1000).toFixed(3);
        tempConfidence = data.confidence_rating;
        tempConfidenceLabel = data.confidence_label;
        saveThoughtProbeTrial(tempBasis, tempBasisRT, true);
      }, { basisOrder });
      practiceCertaintyTrial.data = {
        ...practiceCertaintyTrial.data, ...practiceProbeData, event: "practice_probe_certainty"
      };
      practiceCertaintyTrial.on_start = trial => {
        trial.data = { ...trial.data, practice_attempt: practiceProbeAttempt };
      };
      // Practice the same three controls, with separate records and no main-task
      // probe counter, instructed-response check, or fast-response tracking.
      const practice_probe = {
        timeline: [
          {
            type: jsPsychHtmlKeyboardResponse,
            stimulus: `<section class="mrt-probe-screen mrt-focus-screen">
              <p class="mrt-probe-question">How on task were you just before this screen appeared?</p>
              ${MRT_FOCUS_RESPONSE_HTML}
            </section>`,
            choices: ["1", "2", "3", "4", "5", "6"],
            data: { ...practiceProbeData, event: "practice_probe_focus", probe_question: 1, probe_kind: "focus", ...responseMetadata() },
            on_start: trial => {
              practiceProbeAttempt++;
              trial.data = { ...trial.data, practice_attempt: practiceProbeAttempt };
            },
            on_finish: data => {
              tempPerformance = data.response;
              tempProbeRT1 = (data.rt / 1000).toFixed(3);
            }
          },
          {
            type: jsPsychHtmlKeyboardResponse,
            stimulus: `<section class="mrt-probe-screen mrt-basis-screen">
              <p class="mrt-probe-question">When you chose your task-focus rating, what did you mainly base it on?</p>
              ${basisOptionsHtml}
              <p class="mrt-basis-hint">Press C, F, or O to indicate your response.</p>
            </section>`,
            choices: ["c", "f", "o", "C", "F", "O"],
            data: { ...practiceProbeData, event: "practice_probe_basis", probe_question: 2, probe_kind: "basis", ...responseMetadata() },
            on_start: trial => {
              trial.data = { ...trial.data, practice_attempt: practiceProbeAttempt };
            },
            on_finish: data => {
              data.main_basis = { c: "remembered_thoughts", f: "general_feeling", o: "other" }[data.response.toLowerCase()];
              data.probe3_rt = (data.rt / 1000).toFixed(3);
              tempBasis = data.main_basis;
              tempBasisRT = data.probe3_rt;
            }
          },
          practiceCertaintyTrial
        ]
      };
      let practice_prompt = {
        type: jsPsychHtmlKeyboardResponse,
        stimulus: `<p>The practice trials are now over.<br><br>If you would like to redo the practice trials, press <strong>[Left Arrow]</strong>.<br><br>If you are ready to ${practiceOnly ? "continue" : "begin the main experiment"}, press <strong>[Right Arrow]</strong>.</p>`,
        choices: ["arrowleft", "arrowright"],
        on_finish: function(data) {
	          if(data.response === "arrowleft") {
	            repeatPractice = true;
	            practice_trial_counter = 0;
	            params._state.trialNum = 0;
	            practiceConsecutiveMisses = 0;
	          } else {
            repeatPractice = false;
          }
        }
      };
      let practice_node = {
        timeline: [practice_block, practice_probe, practice_prompt],
        loop_function: function() { return repeatPractice; }
      };
      let instructedResponseExpected = 1;
      const instructed_response_trial = buildMrtCertaintyTrial(jsPsych, function(data) {
              const numericResponse = Number(data.response);
              const response = Number.isInteger(numericResponse) && numericResponse >= 1 && numericResponse <= 4 ? numericResponse : "";
              data.instructed_response_expected = instructedResponseExpected;
              data.instructed_response_expected_label = MRT_CERTAINTY_LABELS[instructedResponseExpected - 1];
              data.instructed_response_correct = response === instructedResponseExpected;
              data.instructed_response_rt_ms = data.rt;
              
              // 1) Increment your trial counter
	              const trialNum = ++params._state.trialNum;
	              // 2) Add a row to customData with the actual response
	              customData.subject.push(subjectID);
              customData.trial.push(trialNum);
              customData.task.push("instructed_response");
              customData.trial_num.push(trialNum);

              // Usually no tapping data for this trial:
              customData.RT_from_metronome.push("NA");
              customData.omission.push("FALSE");

              // Not a probe or pause, so push "NA" for those:
              customData.performance_rating.push("NA");
              customData.probe1_rt.push("NA");
              customData.probe2_rt.push("NA");
              customData.confidence_rating.push("NA");
              customData.pause_time.push("NA");

              // Record the instructed choice separately from actual confidence.
              customData.instructed_response.push(response);
              saveProbeMetadata("NA", "NA", "NA", {
                expected: instructedResponseExpected,
                correct: data.instructed_response_correct,
                rt: data.rt
              });
            }, {
              instructedResponse: true,
              basisOrder,
              data: { instructed_response_format: "confidence-options-v1" }
            });
      instructed_response_trial.on_start = function(trial) {
        const checkIndex = Math.max(0, Math.floor(params._state.probeBlockCounter / 10) - 1);
        instructedResponseExpected = (checkIndex % MRT_CERTAINTY_LABELS.length) + 1;
        const label = MRT_CERTAINTY_LABELS[instructedResponseExpected - 1];
        trial.stimulus = mrtConfidenceStimulus(`To ensure quality responses are being given, please select “${label}”.`, "mrt-instructed-response-screen");
        trial.data = {
          ...trial.data,
          instructed_response_expected: instructedResponseExpected,
          instructed_response_expected_label: label
        };
      };
      let main_miss_node = {
        timeline: [{
          type: jsPsychHtmlKeyboardResponse,
          stimulus: "<p>You haven't pressed SPACE for the last 4 trials.<br>Remember to press SPACE in time with the metronome.<br><br>Press SPACE to continue.</p>",
          choices: [" "],
          on_finish: function() {
            mainConsecutiveMisses = 0;
          }
        }],
        conditional_function: function() {
          return mainConsecutiveMisses >= 4;
        }
      };

      // ---------------- Thought Probe Block ----------------
      let thought_probe_block = {
        timeline: [
          {
            // Small trial to increment the counter for each probe block
            type: jsPsychHtmlKeyboardResponse,
            stimulus: "",
            choices: "NO_KEYS",
	            trial_duration: 1,
	            on_start: function() {
	              params._state.probeBlockCounter++;
	            }
	          },
          {
            type: jsPsychHtmlKeyboardResponse,
            stimulus: `<section class="mrt-probe-screen mrt-focus-screen">
              <p class="mrt-probe-question">How on task were you just before this screen appeared?</p>
              ${MRT_FOCUS_RESPONSE_HTML}
            </section>`,
            choices: ["1", "2", "3", "4", "5", "6"],
            data: { probe_question: 1, probe_kind: "focus", thought_probe: 1, ...responseMetadata() },
            on_finish: function(data) {
              tempPerformance = data.response;
              tempProbeRT1 = (data.rt / 1000).toFixed(3);
              Object.assign(data, StudyResponses.recordSpeed('mrt_focus', data.rt));
              tempFocusFast = data.fast_response;
            }
          },
          {
            type: jsPsychHtmlKeyboardResponse,
            stimulus: `<section class="mrt-probe-screen mrt-basis-screen">
              <p class="mrt-probe-question">When you chose your task-focus rating, what did you mainly base it on?</p>
              ${basisOptionsHtml}
              <p class="mrt-basis-hint">Press C, F, or O to indicate your response.</p>
            </section>`,
            choices: ["c", "f", "o", "C", "F", "O"],
            data: { probe_question: 2, probe_kind: "basis", thought_probe: 1, ...responseMetadata() },
            on_finish: data => {
              data.main_basis = { c: "remembered_thoughts", f: "general_feeling", o: "other" }[data.response.toLowerCase()];
              data.probe3_rt = (data.rt / 1000).toFixed(3);
              Object.assign(data, StudyResponses.recordSpeed('mrt_basis', data.rt));
              tempBasisFast = data.fast_response;
              tempBasis = data.main_basis;
              tempBasisRT = data.probe3_rt;
            }
          },
          buildMrtCertaintyTrial(jsPsych, data => {
            tempProbeRT2 = (data.rt / 1000).toFixed(3);
            tempConfidence = data.confidence_rating;
            tempConfidenceLabel = data.confidence_label;
            saveThoughtProbeTrial(tempBasis, tempBasisRT);
          }, { basisOrder }),
          // Keep the existing instructed-response check after the three ratings,
          // but only on every 10th probe block.
          {
	            timeline: [instructed_response_trial],
	            conditional_function: function() {
	              return (params._state.probeBlockCounter % 10 === 0);//only occurs when trial count is divisible by 10, so it occurs on every 10th block.
	            }
	          },
          {
            type: jsPsychHtmlKeyboardResponse,
            stimulus: `<p style="font-size:24pt; text-align:center;">Press the spacebar to continue and resume clicking along to the metronome.</p>`,
            choices: [" "],
            data: { task: 'mrt', event: 'probe_resume' },
            on_start: trial => {
              const kinds = StudyResponses.takeReminder('mrt_');
              trial.stimulus = `${kinds.length ? StudyResponses.reminderHtml() : ''}<p style="font-size:24pt; text-align:center;">Press the spacebar to continue and resume clicking along to the metronome.</p>`;
              trial.data = { ...trial.data, speed_reminder_shown: kinds.length > 0, reminder_kinds: kinds };
              if (lastProbeRow !== null) {
                customData.speed_reminder_shown[lastProbeRow] = kinds.length > 0;
                customData.speed_reminder_kinds[lastProbeRow] = kinds.join('|');
              }
            }
          },
          {
            type: jsPsychHtmlKeyboardResponse,
            stimulus: "",
            choices: [" "],
            trial_duration: 650,
            prompt: "<img src='images/sound-icon.png'>",
            response_ends_trial: false,
            data: { thought_probe: 1 }
          }
        ]
      };
      let tapping_main = {
        type: jsPsychHtmlKeyboardResponse,
        stimulus: "", 
        choices: [" ", "p"],
        response_ends_trial: true,
        trial_duration: 1300,
        on_start: function() {
          mainLastRT = null;
          scheduleTapTick();
        },
        on_finish: function(data) {
          if(data.response === "p") {
            pauseTapping();
            mainLastRT = null;
          } else if(data.response === " " && Number.isFinite(data.rt) && data.rt >= 0) {
            mainLastRT = data.rt;
          } else {
            mainLastRT = null;
          }
        }
      };
      let tapping_pad = {
        type: jsPsychHtmlKeyboardResponse,
        stimulus: function() {
          if(mainLastRT === null || pause) {
            return "";
          }
          return '<div class="plus">+</div>';
        },
        choices: ["p"],
        response_ends_trial: true,
        trial_duration: function() {
          if(mainLastRT === null) {
            return 0;
          }
          let leftover = 1300 - mainLastRT;
          return leftover > 0 ? leftover : 0;
        },
        on_finish: function(data) {
          if(mainLastRT === null) {
            if (data.response !== "p") {
              saveTappingTrial("");
              mainConsecutiveMisses++; // Increment counter on a no response
            }
          } else {
            let score = mainLastRT - lag_time;
            saveTappingTrial(score);
            mainConsecutiveMisses = 0;  // Reset counter on a valid response
          }
          if (data.response === "p") pauseTapping();
        }
      };
      let main_pad_node = {
        timeline: [tapping_pad],
        conditional_function: function() {
          return !pause;
        }
      };
      let tapping_trial = {
        timeline: [tapping_main, main_pad_node, pause_node]
      };
      let countdown_main = [
        add_countdown("Main trials starting in 3..."),
        add_countdown("Main trials starting in 2..."),
        add_countdown("Main trials starting in 1..."),
        add_countdown("Go!", 650)
      ];
      function generateJitteredIntervals(numBlocks, baseTime, jitterRange) {
        let jitters = [];
        for (let i = 0; i < numBlocks; i++) {
          jitters.push(Math.random() * 2 * jitterRange - jitterRange);
        }
        const sumJitters = jitters.reduce((acc, val) => acc + val, 0);
        const avgJitter = sumJitters / numBlocks;
        const adjustedJitters = jitters.map(x => x - avgJitter);
        return adjustedJitters.map(j => baseTime + j);
      }
      
      
      // ---- Build MRT blocks so we can interleave with meta-emotion calibration ----
      // Each block ends with task focus, main basis, confidence, and the existing resume routine.
      let mrt_blocks = [];
      const numBlocks = (params.numBlocks !== undefined) ? params.numBlocks : 6; //35 was original number
      const baseTime = 40;
      const jitterRange = 15;

      const intervals = practiceOnly ? [] : generateJitteredIntervals(numBlocks, baseTime, jitterRange);

      for (let i = 0; i < intervals.length; i++) {
        let blockTimeline = [];
        let intervalSeconds = intervals[i];
        let nTappingTrials = Math.round((intervalSeconds * 1000) / 1300);

        for (let j = 0; j < nTappingTrials; j++) {
          blockTimeline.push(tapping_trial);
          blockTimeline.push(main_miss_node);
        }

        blockTimeline.push(thought_probe_block);
        

        if ((params.includeMidBreak !== false) && (i === Math.ceil(numBlocks / 2) - 1)) {
          blockTimeline.push(break_trial);
          blockTimeline.push(add_countdown_pad());
          blockTimeline = blockTimeline.concat(countdown_main);
        }

        mrt_blocks.push(blockTimeline);
      }

      // Cursor used to resume MRT blocks after switching away
      if (params._state.mrtCursor === undefined) params._state.mrtCursor = 0;

      function takeMrtBlocks(nBlocks){
        const out = [];
        for (let k = 0; k < nBlocks && params._state.mrtCursor < mrt_blocks.length; k++) {
          out.push(...mrt_blocks[params._state.mrtCursor]);
          params._state.mrtCursor += 1;
        }
        return out;
      }

      // Build the MRT portion requested for this call
      const blocksToTake = params.blocksToTake ?? mrt_blocks.length;
      const mrt_main = practiceOnly ? [] : takeMrtBlocks(blocksToTake);

      let timeline = [];

      // ---- Run MRT instructions + practice only on first entry ----
      if (!params._state.mrtInitialized) {
        // 1. Approved recap
        timeline = timeline.concat(instructionsTrials);

        // 2. Countdown before practice (exact original)
        timeline.push(add_countdown_pad());
        timeline.push(add_countdown("Practice trials starting in 3..."));
        timeline.push(add_countdown("Practice trials starting in 2..."));
        timeline.push(add_countdown("Practice trials starting in 1..."));
        timeline.push(add_countdown("Go!", 650));

        // 3. Tapping practice and one three-question practice probe
        timeline.push(practice_node);

        params._state.mrtInitialized = true;
      }

      // The first main countdown is scheduled separately from early practice.
      if (!practiceOnly && mrt_main.length > 0 && !params._state.mrtMainStarted) {
        // Explicit user gesture for audio resume after the picture task.
        timeline.push({
          type: jsPsychHtmlKeyboardResponse,
          stimulus: `<div class="center" style="font-size:22px; line-height:1.35;">
            <p><b>Metronome Task</b></p>
            <p>You will now have some metronome tapping trials.</p>
            <p>Press <b>SPACE</b> to continue to the next set of Metronome Task trials.</p>
          </div>`,
          choices: [" "],
          on_finish: async () => {
            try { metronomeAudio.currentTime = 0; await metronomeAudio.play(); metronomeAudio.pause(); metronomeAudio.currentTime = 0; } catch(e) {}
            try { if (typeof bellAudio !== "undefined" && bellAudio) { bellAudio.currentTime = 0; await bellAudio.play(); bellAudio.pause(); bellAudio.currentTime = 0; } } catch(e) {}
          },
          data: { task: "mrt", event: "practice_to_main_continue" }
        });

        // 4. Countdown before main (exact original)
        timeline.push(add_countdown_pad());
        timeline = timeline.concat(countdown_main);

        params._state.mrtMainStarted = true;
      }

      // ---- Append the requested MRT blocks for this chunk ----
      timeline = timeline.concat(mrt_main);

      // 6. Save data
      // timeline.push(osfSaveData); // handled by main pipeline

      // 7. Demographic survey
      // timeline.push(demographics);

      // 8. Debrief (IMPORTANT: don't include debrief in every chunk; see note below)
      // timeline.push(debrief);

params._state.convertToCSV = convertToCSV;
      params._state.customData = customData;
      return { timeline, customData, convertToCSV, getSubjectID: ()=>subjectID };
      
    
}
      
