const MRT_CERTAINTY_MIN_MS = 600;
const MRT_CERTAINTY_MIN_MOVE_PX = 20;
const MRT_RESPONSE_FORMAT_VERSION = "mrt-probes-v2";
const MRT_CERTAINTY_LABELS = ["Very uncertain", "Somewhat uncertain", "Somewhat certain", "Very certain"];

// Track the cursor across screens, before a certainty question takes its baseline.
let mrtCursorPosition = null;
function trackMrtCursor(event) {
  if (event.pointerType === "mouse") mrtCursorPosition = { x: event.clientX, y: event.clientY };
}
document.addEventListener("pointermove", trackMrtCursor, true);
document.addEventListener("pointerdown", trackMrtCursor, true);
document.addEventListener("pointerup", trackMrtCursor, true);

function mrtResponseMetadata() {
  return {
    response_format_version: MRT_RESPONSE_FORMAT_VERSION,
    certainty_min_ms: MRT_CERTAINTY_MIN_MS,
    certainty_min_move_px: MRT_CERTAINTY_MIN_MOVE_PX
  };
}

function buildMrtCertaintyTrial(jsPsych, onResponse) {
  let cleanup = () => {};
  return {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: `<section class="mrt-certainty-screen">
      <h2>Certainty</h2>
      <p>How certain are you that the task-focus rating you just provided is accurate?</p>
      <div class="mrt-certainty-options">
        ${MRT_CERTAINTY_LABELS.map((label, index) => `<button type="button" class="mrt-certainty-option" data-value="${index + 1}" aria-disabled="true" tabindex="-1">${label}</button>`).join("")}
      </div>
      <p class="mrt-certainty-hint">Move the mouse to your answer and click.</p>
    </section>`,
    choices: "NO_KEYS",
    data: { probe_question: 2, thought_probe: 1, ...mrtResponseMetadata() },
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
        if (event.pointerType !== "mouse" || event.button !== 0 || !buttons.includes(event.target)) return;
        event.preventDefault();
        if (ready()) pendingPress = event.target;
      };
      const cancelPress = () => { pendingPress = null; };
      const click = event => {
        const pressed = pendingPress;
        pendingPress = null;
        // A new mouse-down on this screen must itself meet both activation conditions.
        if (finished || event.detail === 0 || event.button !== 0 || pressed !== event.target || !pressed || !ready()) return;
        const response = Number(pressed.dataset.value);
        finished = true;
        cleanup();
        jsPsych.finishTrial({
          response,
          rt: performance.now() - onset,
          confidence_rating: response,
          confidence_label: MRT_CERTAINTY_LABELS[response - 1],
          certainty_max_move_px: maxDistance,
          ...mrtResponseMetadata()
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

function buildMRTChunk(params){
const subjectID = params.subjectID;
const metronomeAudio = params.metronomeAudio;
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
          confidence_label: [],
          main_basis: [],
          probe3_rt: [],
          response_format_version: [],
          certainty_min_ms: [],
          certainty_min_move_px: []
        };
        params._state.customData = customData;
      }
      // Flag to ensure we only run instructions + practice once across interleaving
      if (params._state.mrtInitialized === undefined) params._state.mrtInitialized = false;
      const lag_time = 650;
      let tempPerformance = null;
      let tempProbeRT1 = null;
      let tempProbeRT2 = null;
      let tempConfidence = null;
      let tempConfidenceLabel = null;
      let pause = false;
      let pauseStart = 0;
      let justPaused = false;
      let repeatPractice = false;
      let practiceConsecutiveMisses = 0;
      let mainConsecutiveMisses = 0;
      let practiceLastRT = null;
      let mainLastRT = null;

      
      // ---------------- Instructions (from original MRT) ----------------
      const MRT_INSTRUCTION_MIN_VIEW_MS = 10000;
      let cleanupMrtInstructionLock = null;

      let instructions_pages = [
        // Page 1
        `<p>You will now do the same metronome task you did at the beginning of this study but this time for a little over 20 minutes, split into two halves.</p>
        <p>After the first half, you will be able take a short break if needed.</p>
        <p>Please refresh yourself on the instructions in the following pages.</p>
        <p>
        <p><em>Note: Make sure you fully understand the instructions before beginning. Wait for the next button to become available on each page.</em></p>`,
        
        // Page 2
        `<p>In this section of the study, you will engage in a task where you will hear a metronome sound presented at a constant rate via your headphones or external speakers.</p>
        <p>Your task will be to press the spacebar in synchrony with the onset of the metronome so that you press the spacebar exactly when each metronome sound is presented.</p>
        <p>Your accuracy is determined by how close in time your responses match the metronome and how consistent they are</p>
          <p>A plus sign will display after each time you press the spacebar to indicate that your key press registered.</p>`,
        
        // Page 3
        `<p>Every so often, the task and the metronome will temporarily stop, and you will be presented with three questions.</p>
        <p>First, a screen will ask you to indicate how on task you were just prior to us asking (within the last 15 seconds or so) on a scale from 1 (“Least on Task”) to 6 (“Most on Task”).</p>
        <p>The term “on task” refers to how focused you were on keeping your clicks in sync with the metronome versus the extent to which you were distracted or “zoned out.”</p>
        <p>This question should be answered based on your own relative levels of focus throughout this task. ‘Most on Task’ represents what you consider to be your own highest level of focus, and ‘Least on Task’ represents your lowest level of focus when clicking along to the metronome in sync at a constant rate.</p>`,
        
        // Page 4
        `<p> Keep in mind that, each number (1-6) should in theory be selected a roughly (not perfectly) equal number of times since your 'highest' and 'lowest' levels of focus are relative to each other.</p>
        <p>For instance, since there are 6 options, your actual task focus level can only fall into the category of 6 your 'most on task' (the highest possible ranking) during this task for 1/6th of the total task time, and 1 the 'lowest level' 1/6th of the time, or a focus rating of '3' 1/6th of the time and so on for each number.</p>
        <p>It is normal for your level of focus to vary. There will be a dividing line between options 3 and 4 indicating the middle of the scale.</p>
        <p>If you were less focused than what you consider your middle or average level of focus, choose from 1–3; if more focused, choose from 4–6.</p>`,
        
        // Page 5
        `<h2>Certainty</h2>
        <p>After each task-focus rating, you will indicate how certain you are that your rating was accurate. This is different from rating how high or low your task focus was. You can be certain or uncertain about either a high or a low task-focus rating. Choose the response that best describes how certain you are about that particular rating.</p>
        <p>The response options are “Very uncertain,” “Somewhat uncertain,” “Somewhat certain,” and “Very certain.”</p>
        <p>Move the mouse to your answer and click. Each response requires a new mouse movement, and the choices become available after a brief pause.</p>`,

        // Page 6
        `<h2>Main basis</h2>
        <p>You will then be asked what mainly informed your task-focus rating: what you remembered thinking about, a general feeling of how focused or unfocused you had been, or something other than these two.</p>
        <p>Both remembering your thoughts and having a general feeling may contribute to your rating. When both contribute, choose whichever influenced your rating more.</p>
        <p>Your memory does not need to be clear or detailed—it may be partial or vague—but it should include something about what you were thinking about. Remembered thoughts can be related or unrelated to the task. Choose based on what influenced your rating most, rather than simply which experience was clearest or strongest.</p>
        <p>Choose “Something other than these two” only when another source influenced your rating more than either of these. Use C for remembered thoughts, F for a general feeling, or O for something else.</p>
        <p>This part of the experiment will take about 20 minutes. You will begin with practice trials, and then you will be notified when the main trials start.</p>
        <p>If you are ready to begin, press "Next."</p>`
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

            const content = document.querySelector("#jspsych-instructions-content");
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
              const isLastPage = pageMatch && Number(pageMatch[1]) === Number(pageMatch[2]);
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
                : "You may now continue or return to the previous page.";
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
          lockCurrentPage();

          cleanupMrtInstructionLock = function() {
            clearLockTimers();
            observer.disconnect();
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
      function saveProbeMetadata(label = "NA", basis = "NA", basisRT = "NA") {
        customData.confidence_label.push(label);
        customData.main_basis.push(basis);
        customData.probe3_rt.push(basisRT);
        const metadata = mrtResponseMetadata();
        for (const key of Object.keys(metadata)) customData[key].push(metadata[key]);
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
      function saveThoughtProbeTrial(basis, basisRT) {
        const trialNum = ++params._state.trialNum;
        customData.subject.push(subjectID);
        customData.trial.push(trialNum);
        customData.task.push("thought_probe");
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
        tempPerformance = null;
        tempProbeRT1 = null;
        tempProbeRT2 = null;
        tempConfidence = null;
        tempConfidenceLabel = null;
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
      function convertToCSV(dataObj) {
        let columns = Object.keys(dataObj);
        let header = columns.join("\t") + "\n";
        let numRows = dataObj[columns[0]].length;
        let rows = [];
        for (let i = 0; i < numRows; i++) {
          let row = columns.map(col => dataObj[col][i]);
          rows.push(row.join("\t"));
        }
        return header + rows.join("\n");
      }
      function play_metronome_tick() {
        metronomeAudio.currentTime = 0;
        metronomeAudio.play();
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
          justPaused = true;
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
          setTimeout(() => { play_metronome_tick(); }, 650);
        },
        on_finish: function(data) {
          if(data.response === "p") {
            pause = true;
            practiceLastRT = null; 
          } else if(data.response === " ") {
            practiceLastRT = data.rt;
          } else {
            practiceLastRT = null;
          }
        }
      };
      let practice_tapping_pad = {
        type: jsPsychHtmlKeyboardResponse,
        stimulus: function() {
          return '<div class="plus">+</div>';
        },
        choices: [" "],
        response_ends_trial: false,
        trial_duration: function() {
          if (practiceLastRT === null) {
            return 650;
          }
          let leftover = 1300 - practiceLastRT;
          return leftover > 0 ? leftover : 0;
        },
        on_finish: function() {
          if (pause || justPaused) {
            justPaused = false;
            return;
          }
          if(practiceLastRT === null) {
            saveTappingTrial("", "practice trial");
            practiceConsecutiveMisses++;
          } else {
            let score = practiceLastRT - lag_time;
            saveTappingTrial(score, "practice trial");
            practiceConsecutiveMisses = 0;
          }
        }
      };
      let practice_pad_node = {
        timeline: [practice_tapping_pad],
        conditional_function: function() {
          return !pause;
        }
      };

      let practice_tapping_trial = {
        timeline: [practice_tapping_main, pause_node, practice_pad_node]
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
      let practice_prompt = {
        type: jsPsychHtmlKeyboardResponse,
        stimulus: "<p>The practice trials are now over.<br><br>If you would like to redo the practice trials, press <strong>[Left Arrow]</strong>.<br><br>If you are ready to begin the main experiment, press <strong>[Right Arrow]</strong>.</p>",
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
        timeline: [practice_block, practice_prompt],
        loop_function: function() { return repeatPractice; }
      };
      let instructed_response_trial = {
            type: jsPsychHtmlKeyboardResponse,
            stimulus: `
                <div style="text-align: center; color: white;">
                  <!-- Wrap the question text in the same container -->
                  <div style="display: inline-block; white-space: nowrap; width: 1050px; text-align: left; margin-bottom: 50px;">
                    <p style="font-size: 20pt; margin: 0;">
                      4. Select option six so we can ensure the quality of your responses.
                      </p>
                  </div>
                  <!-- The response options container -->
                  <div style="display: inline-block; width: 1050px; margin-top: 100px;">
                      <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
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
                            Please choose the instructed option so that we can ensure quality responses are being given. Press a key (1–6) for your response.</div>
                      </div>
                  </div>
                </div>`,
            choices: ["1", "2", "3", "4", "5", "6"],
            data: { instructed_response_probe: 1 },
            on_finish: function(data) {
              
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

              // The key line: push the actual response
              customData.instructed_response.push(data.response);
              saveProbeMetadata();
            }
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
            stimulus: `
                <div style="text-align: center; color: white;">
                  <!-- Wrap the question text in the same container -->
                  <div style="display: inline-block; width: 1050px; text-align: left; margin-bottom: 50px;">
                    <p style="font-size: 20pt; margin: 0;">
                      1. How on task were you just before this screen appeared?
                    </p>
                  </div>
                  <!-- The response options container -->
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
                </div>`,
            choices: ["1", "2", "3", "4", "5", "6"],
            data: { probe_question: 1, thought_probe: 1, ...mrtResponseMetadata() },
            on_finish: function(data) {
              tempPerformance = data.response;
              tempProbeRT1 = (data.rt / 1000).toFixed(3);
            }
          },
          buildMrtCertaintyTrial(jsPsych, data => {
            tempProbeRT2 = (data.rt / 1000).toFixed(3);
            tempConfidence = data.confidence_rating;
            tempConfidenceLabel = data.confidence_label;
          }),
          {
            type: jsPsychHtmlKeyboardResponse,
            stimulus: `<section class="mrt-basis-screen">
              <h2>Main basis</h2>
              <p>What mainly informed the task-focus rating you just provided?</p>
              <ul class="mrt-basis-options">
                <li>[C] What I remembered thinking about.</li>
                <li>[F] A general feeling of how focused or unfocused I had been.</li>
                <li>[O] Something other than these two.</li>
              </ul>
            </section>`,
            choices: ["c", "f", "o", "C", "F", "O"],
            data: { probe_question: 3, thought_probe: 1, ...mrtResponseMetadata() },
            on_finish: data => {
              data.main_basis = { c: "remembered_thoughts", f: "general_feeling", o: "other" }[data.response.toLowerCase()];
              data.probe3_rt = (data.rt / 1000).toFixed(3);
              saveThoughtProbeTrial(data.main_basis, data.probe3_rt);
            }
          },
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
            choices: [" "]
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
          setTimeout(() => { play_metronome_tick(); }, 650);
        },
        on_finish: function(data) {
          if(data.response === "p") {
            pause = true;
            mainLastRT = null;
          } else if(data.response === " ") {
            mainLastRT = data.rt;
          } else {
            mainLastRT = null;
          }
        }
      };
      let tapping_pad = {
        type: jsPsychHtmlKeyboardResponse,
        stimulus: function() {
          if(mainLastRT === null) {
            return "";
          }
          return '<div class="plus">+</div>';
        },
        choices: [" "],
        response_ends_trial: false,
        trial_duration: function() {
          if(mainLastRT === null) {
            return 0;
          }
          let leftover = 1300 - mainLastRT;
          return leftover > 0 ? leftover : 0;
        },
        on_finish: function() {
          if (pause || justPaused) {
            justPaused = false;
            return;
          }
          if(mainLastRT === null) {
            saveTappingTrial("");
            mainConsecutiveMisses++; // Increment counter on a no response
          } else {
            let score = mainLastRT - lag_time;
            saveTappingTrial(score);
            mainConsecutiveMisses = 0;  // Reset counter on a valid response
          }
        }
      };
      let main_pad_node = {
        timeline: [tapping_pad],
        conditional_function: function() {
          return !pause;
        }
      };
      let tapping_trial = {
        timeline: [tapping_main, pause_node, main_pad_node]
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
      // Each block ends with task focus, certainty, main basis, and the existing resume routine.
      let mrt_blocks = [];
      const numBlocks = (params.numBlocks !== undefined) ? params.numBlocks : 6; //35 was original number
      const baseTime = 40;
      const jitterRange = 15;

      const intervals = generateJitteredIntervals(numBlocks, baseTime, jitterRange);

      for (let i = 0; i < numBlocks; i++) {
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
      // Build the MRT portion requested for this call
      const blocksToTake = params.blocksToTake ?? mrt_blocks.length;
      const mrt_main = takeMrtBlocks(blocksToTake);

      let timeline = [];

      // ---- Run MRT instructions + practice only on first entry ----
      if (!params._state.mrtInitialized) {
        // 1. Instructions (exact original)
        timeline = timeline.concat(instructionsTrials);

        // 2. Countdown before practice (exact original)
        timeline.push(add_countdown_pad());
        timeline.push(add_countdown("Practice trials starting in 3..."));
        timeline.push(add_countdown("Practice trials starting in 2..."));
        timeline.push(add_countdown("Practice trials starting in 1..."));
        timeline.push(add_countdown("Go!", 650));

        // 3. Practice node (exact original)
        timeline.push(practice_node);

        // Transition to main trials (explicit user gesture for audio resume)
        timeline.push({
          type: jsPsychHtmlKeyboardResponse,
          stimulus: `<div class="center" style="font-size:22px; line-height:1.35;">
            <p>Practice complete.</p>
            <p>Press <b>SPACE</b> to begin the main trials.</p>
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

        params._state.mrtInitialized = true;
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
      
