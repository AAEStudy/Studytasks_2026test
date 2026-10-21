// Status adapter for the pinned @jspsych-contrib/plugin-pipe@0.3.0 contract.
// Its run() considers only result.error and otherwise may mark a returned native
// fetch Error as success. Always return an object with error null or a message.
// Current DataPipe responses may acknowledge queued work with HTTP 202 and
// error:null (including a CONTENTION code); that is accepted, not a retry signal.
(() => {
  "use strict";
  const SAVE_TIMEOUT_MS = 30000;

  if (typeof jsPsychPipe === "undefined" || typeof jsPsychPipe.saveData !== "function") {
    console.error("Load jsPsychPipe before the DataPipe save-status adapter.");
    return;
  }

  const errorMessage = (value, fallback) => {
    try {
      if (typeof value === "string") return value.trim() ? value : fallback;
      if (value && typeof value.message === "string" && value.message.trim()) return value.message;
      const encoded = JSON.stringify(value);
      if (encoded && encoded !== "null" && encoded !== '""') return encoded;
    } catch (_) {}
    return fallback;
  };

  const save = async function(endpoint, expID, filename, data, options = {}) {
    let httpStatus = null;
    let readingResponse = false;
    let timer;
    let timedOut = false;
    try {
      if (typeof expID !== "string" || !expID.trim()
          || typeof filename !== "string" || !filename.trim()
          || typeof data !== "string" || !data) {
        return { http_status: null, save_state: "unconfirmed", error: "Missing required parameter(s)." };
      }

      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          if (controller) controller.abort();
          reject(new Error("DataPipe save timed out after 30 seconds; storage status is unconfirmed."));
        }, SAVE_TIMEOUT_MS);
      });
      const attempt = async () => {
        // Preserve the plugin's endpoint and payload. Do not automatically retry:
        // an interrupted response can leave server-side storage already accepted.
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "*/*" },
          body: JSON.stringify({ experimentID: expID, filename, data }),
          ...(options.keepalive === true ? { keepalive: true } : {}),
          ...(controller ? { signal: controller.signal } : {})
        });
        if (typeof response.status === "number" && Number.isFinite(response.status)) {
          httpStatus = response.status;
        }
        readingResponse = true;
        const body = await response.json();
        const fields = body !== null && typeof body === "object" && !Array.isArray(body)
          ? { ...body }
          : { response_body: body };
        const successfulStatus = httpStatus >= 200 && httpStatus < 300;
        const bodyError = body !== null && typeof body === "object" ? body.error : null;
        if (successfulStatus && !bodyError) {
          return {
            ...fields,
            http_status: httpStatus,
            save_state: httpStatus === 201 ? "stored" : httpStatus === 202 ? "queued" : "accepted",
            error: null
          };
        }

        const failureMessage = httpStatus === null
          ? "DataPipe returned no HTTP status; the save could not be confirmed."
          : `DataPipe did not confirm the save (HTTP ${httpStatus}).`;
        return {
          ...fields,
          http_status: httpStatus,
          save_state: httpStatus >= 400 && httpStatus < 500 ? "rejected" : "unconfirmed",
          error: bodyError ? errorMessage(bodyError, failureMessage) : failureMessage
        };
      };
      // Include body parsing in the deadline so an accepted connection with a
      // stalled body cannot prevent the independent Qualtrics save from starting.
      return await Promise.race([attempt(), deadline]);
    } catch (error) {
      return {
        http_status: httpStatus,
        save_state: "unconfirmed",
        ...(timedOut ? { code: "CLIENT_TIMEOUT" } : {}),
        error: timedOut ? "DataPipe save timed out after 30 seconds; storage status is unconfirmed."
          : `${readingResponse ? "Could not read the DataPipe response" : "Could not confirm the DataPipe save"}: ${errorMessage(error, "Unknown error.")}`
      };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
  jsPsychPipe.saveData = (expID, filename, data, options) => save("https://pipe.jspsych.org/api/data/", expID, filename, data, options);
  jsPsychPipe.saveBase64Data = (expID, filename, data) => save("https://pipe.jspsych.org/api/base64/", expID, filename, data);
})();
