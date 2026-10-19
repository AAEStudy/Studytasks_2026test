(function () {
function createQualtricsCodec() {
  // Keep this entire factory in ES5 syntax: Qualtrics' editor parses the inlined
  // copy separately from the participant browser. Promises/WebCrypto run there.
  var chunkSize = 18000, maxChunks = 256, schema = 'fae-qualtrics-zip-v1';
  function chunkName(n) { return 'fae_zip_' + ('0000' + n).slice(-4); }
  var metadata = ['fae_schema', 'fae_session_id', 'fae_subject_id', 'fae_filename',
    'fae_zip_bytes', 'fae_zip_sha256', 'fae_chunk_count', 'fae_run_mode', 'fae_return_url'];
  var fieldNames = metadata.slice();
  for (var index = 1; index <= maxChunks; index++) fieldNames.push(chunkName(index));
  function fail(message) { throw new Error(message); }
  function scalar(value, label) {
    if (typeof value !== 'string' || !value || value.length > 256 || /[\r\n\0]/.test(value)) fail('Invalid ' + label);
    return value;
  }
  function filename(value) {
    scalar(value, 'filename');
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\.zip$/.test(value)) fail('Unsafe ZIP filename');
    return value;
  }
  function integer(value, label, max) {
    if (!/^[1-9][0-9]*$/.test(String(value))) fail('Invalid ' + label);
    var n = Number(value);
    if (!isFinite(n) || Math.floor(n) !== n || n > max) fail(label + ' exceeds prototype capacity');
    return n;
  }
  function validateReturnUrl(value) {
    if (value == null || value === '') return '';
    if (typeof value !== 'string' || value.length > 8000) fail('Invalid return URL');
    var url = new URL(value);
    var survey = /(?:^|\.)qualtrics\.com$/.test(url.hostname) && /^\/jfe\/form\/SV_[A-Za-z0-9]+$/.test(url.pathname);
    var receipt = url.origin === 'https://aaestudy.github.io' && url.pathname === '/Studytasks_2026test/qualtrics/saved.html';
    if (url.protocol !== 'https:' || url.username || url.password || (!survey && !receipt)) fail('Invalid return destination');
    return url.href;
  }
  function hash(bytes) {
    var cryptoApi = typeof crypto !== 'undefined' ? crypto : null;
    if (!cryptoApi || !cryptoApi.subtle) fail('Secure browser hashing is unavailable');
    return cryptoApi.subtle.digest('SHA-256', bytes).then(function (digest) {
      var values = new Uint8Array(digest), hex = '';
      for (var n = 0; n < values.length; n++) hex += ('0' + values[n].toString(16)).slice(-2);
      return hex;
    });
  }
  function build(bytes, info) {
    return Promise.resolve().then(function () {
      if (!(bytes instanceof Uint8Array) || !bytes.length) fail('Missing ZIP bytes');
      if (bytes.length > chunkSize * maxChunks * 3 / 4) fail('ZIP exceeds prototype capacity');
      var binary = '';
      for (var n = 0; n < bytes.length; n += 8192) binary += String.fromCharCode.apply(null, bytes.subarray(n, n + 8192));
      var base64 = btoa(binary);
      return hash(bytes).then(function (digest) {
        var fields = {
          fae_schema: schema,
          fae_session_id: scalar(info.sessionId, 'session ID'),
          fae_subject_id: scalar(info.subjectId, 'subject ID'),
          fae_filename: filename(info.filename),
          fae_zip_bytes: String(bytes.length),
          fae_zip_sha256: digest,
          fae_chunk_count: String(Math.ceil(base64.length / chunkSize)),
          fae_run_mode: info.runMode,
          fae_return_url: validateReturnUrl(info.returnUrl)
        };
        if (['test', 'full', 'probe'].indexOf(fields.fae_run_mode) === -1) fail('Invalid run mode');
        for (var n = 0; n < base64.length; n += chunkSize) fields[chunkName(n / chunkSize + 1)] = base64.slice(n, n + chunkSize);
        return verify(fields).then(function () { return fields; });
      });
    });
  }
  function verify(fields) {
    return Promise.resolve().then(function () {
      if (fields.fae_schema !== schema) fail('Unrecognized envelope schema');
      scalar(fields.fae_session_id, 'session ID');
      scalar(fields.fae_subject_id, 'subject ID');
      filename(fields.fae_filename);
      validateReturnUrl(fields.fae_return_url);
      if (['test', 'full', 'probe'].indexOf(fields.fae_run_mode) === -1) fail('Invalid run mode');
      var count = integer(fields.fae_chunk_count, 'chunk count', maxChunks);
      var byteCount = integer(fields.fae_zip_bytes, 'ZIP byte count', chunkSize * maxChunks * 3 / 4);
      if (!/^[a-f0-9]{64}$/.test(fields.fae_zip_sha256 || '')) fail('Invalid SHA-256');
      var chunks = [];
      for (var n = 1; n <= maxChunks; n++) {
        var value = fields[chunkName(n)];
        if (n > count) {
          if (value != null && value !== '') fail('Unexpected extra ZIP chunk');
          continue;
        }
        if (typeof value !== 'string' || !value.length || value.length > chunkSize ||
            (n < count && value.length !== chunkSize)) fail('Missing or truncated chunk ' + n);
        chunks.push(value);
      }
      var base64 = chunks.join('');
      if (base64.length !== 4 * Math.ceil(byteCount / 3) ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) fail('Invalid base64 or length');
      var binary = atob(base64);
      if (btoa(binary) !== base64) fail('Non-canonical base64');
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      if (bytes.length !== byteCount) fail('ZIP byte count mismatch');
      if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 3 || bytes[3] !== 4) fail('Missing ZIP header');
      return hash(bytes).then(function (digest) {
        if (digest !== fields.fae_zip_sha256) fail('ZIP checksum mismatch');
        return bytes;
      });
    });
  }
  return { build: build, verify: verify, validateReturnUrl: validateReturnUrl, fieldNames: fieldNames, chunkSize: chunkSize, maxChunks: maxChunks, schema: schema };
}
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

}());
