/* Paste this entire file into the JavaScript editor of a dedicated
 * Qualtrics Text/Graphic question. The preceding page must already have
 * been submitted, and "Allow respondents to finish later" must be enabled.
 * Test a complete round trip in the intended survey layout before use.
 */
(function () {
  var launchTimer = null;
  var unloaded = false;

  Qualtrics.SurveyEngine.addOnUnload(function () {
    unloaded = true;
    if (launchTimer !== null) {
      window.clearTimeout(launchTimer);
      launchTimer = null;
    }
  });

  Qualtrics.SurveyEngine.addOnReady(function () {
    var question = this;
    var subjectID = "${e://Field/subjectID}".trim();
    var participantID = "${e://Field/id}".trim();
    var responseID = "${e://Field/ResponseID}".trim();
    var identifierPattern = /^[A-Za-z0-9_-]+$/;
    var status = document.getElementById("redirectMessage");
    var container = typeof question.getQuestionContainer === "function"
      ? question.getQuestionContainer()
      : null;

    if (!status) {
      status = document.createElement("p");
      status.id = "redirectMessage";
      (container || document.body).appendChild(status);
    }
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");

    function showStatus(message) {
      status.textContent = message;
      status.hidden = false;
      status.style.display = "block";
    }

    if (typeof question.hideNextButton !== "function" ||
        typeof question.showNextButton !== "function") {
      showStatus("The study handoff is not available in this survey layout. Please contact the researcher before continuing.");
      return;
    }
    question.hideNextButton();

    // These fields are controlled, machine-generated identifiers. Reject
    // unexpanded piped text as well as empty or unexpected identifier values.
    if (!identifierPattern.test(subjectID) ||
        !identifierPattern.test(responseID) ||
        (participantID !== "" && !identifierPattern.test(participantID))) {
      showStatus("The study could not verify your participant information. Please contact the researcher; do not restart the task.");
      return;
    }

    var currentURL;
    try {
      currentURL = new URL(window.location.href);
    } catch (error) {
      showStatus("The study could not read the survey return address. Please contact the researcher before continuing.");
      return;
    }

    var fragment = currentURL.hash.slice(1);
    var markers = new URLSearchParams(fragment);
    var hasCompletionMarker = markers.has("faeTaskComplete") ||
      markers.has("faeResponseID");

    if (hasCompletionMarker) {
      var matchedReturn = markers.getAll("faeTaskComplete").length === 1 &&
        markers.get("faeTaskComplete") === "1" &&
        markers.getAll("faeResponseID").length === 1 &&
        markers.get("faeResponseID") === responseID &&
        markers.getAll("subjectID").length === 1 &&
        markers.get("subjectID") === subjectID;

      if (!matchedReturn) {
        showStatus("The completed task does not match this survey response. Please contact the researcher; do not restart the task.");
        return;
      }

      showStatus("Your task is complete. Please select Next to continue if the survey does not advance automatically.");
      question.showNextButton();
      if (typeof question.clickNextButton === "function") {
        try {
          question.clickNextButton();
        } catch (error) {
          // The verified return may still continue using the visible Next button.
        }
      }
      return;
    }

    // Do not overwrite a fragment that may belong to Qualtrics navigation.
    if (fragment !== "") {
      showStatus("The survey return address contains an unsupported fragment. Please contact the researcher so the study handoff can be checked.");
      return;
    }

    var returnURL = new URL(currentURL.href);
    var returnMarkers = new URLSearchParams();
    returnMarkers.set("faeTaskComplete", "1");
    returnMarkers.set("faeResponseID", responseID);
    returnMarkers.set("subjectID", subjectID);
    // Only the fragment changes: preserve the survey query bytes and ordering.
    returnURL.hash = returnMarkers.toString();

    var taskURL = new URL("https://aaestudy.github.io/Studytasks_2026test/");
    taskURL.searchParams.set("subjectID", subjectID);
    if (participantID !== "") taskURL.searchParams.set("id", participantID);
    taskURL.searchParams.set("returnMode", "resume");
    taskURL.searchParams.set("return", returnURL.href);

    showStatus("Opening the study task. You will return here when it is complete.");
    launchTimer = window.setTimeout(function () {
      launchTimer = null;
      if (unloaded) return;
      try {
        window.location.replace(taskURL.href);
      } catch (error) {
        showStatus("The study task could not open. Please contact the researcher before continuing.");
      }
    }, 1000);
  });
}());
