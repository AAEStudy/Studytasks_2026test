// Installed into QID1 by build-qualtrics-receiver.mjs, with the codec inlined.
Qualtrics.SurveyEngine.addOnload(function () {
  this.hideNextButton();
  this.hidePreviousButton();
});
Qualtrics.SurveyEngine.addOnReady(function () {
  var question = this;
  var engine = Qualtrics.SurveyEngine;
  var codec = createQualtricsCodec();
  var container = question.getQuestionContainer();
  // Text imports or the editor can strip custom HTML attributes.
  var message = container.querySelector('[data-fae-status]') || container.querySelector('.QuestionText') || container;
  var fields = {};
  function showFailure(error) {
    var reason = String(error.message || error).slice(0,200);
    try {
      engine.setJSEmbeddedData('fae_receiver_status', 'invalid');
      engine.setJSEmbeddedData('fae_receiver_error', reason);
    } catch (ignored) {}
    message.textContent = 'We could not verify the task data. Your upload has not been confirmed. Test diagnostic: ' + reason;
  }
  try {
    if (typeof engine.getJSEmbeddedData !== 'function' || typeof engine.setJSEmbeddedData !== 'function') {
      throw new Error('The new Qualtrics embedded-data methods are unavailable.');
    }
    engine.setJSEmbeddedData('fae_receiver_status', 'checking');
    for (var i = 0; i < codec.fieldNames.length; i++) {
      var name = codec.fieldNames[i];
      fields[name] = engine.getJSEmbeddedData(name);
    }
    if (!fields.fae_schema) {
      throw new Error('Missing JS-visible schema. Check __js_fae_schema above this block in Survey Flow and use the updated test sender.');
    }
  } catch (error) {
    showFailure(error);
    return;
  }
  codec.verify(fields).then(function () {
    // Survey Flow handles this URL only after the response is submitted.
    engine.setJSEmbeddedData('fae_return_url', codec.validateReturnUrl(fields.fae_return_url));
    // "verified" means integrity checked in the browser, not yet durable storage.
    engine.setJSEmbeddedData('fae_receiver_status', 'verified');
    engine.setJSEmbeddedData('fae_receiver_error', '');
    message.textContent = 'Submitting task data. Please keep this window open…';
    question.clickNextButton();
  }).catch(showFailure);
});
