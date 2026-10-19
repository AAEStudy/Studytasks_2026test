import { readFile, writeFile } from 'node:fs/promises';
import { createSessionZip } from '../js/session-bundle.mjs';
import { createQualtricsCodec, validateReceiverUrl, postQualtricsBundle } from '../js/qualtrics-bundle.mjs';

const receiver = validateReceiverUrl('https://usf.az1.qualtrics.com/jfe/form/SV_b7rI1T6DVd3u0dw');
const receiverJS = await readFile(new URL('../qualtrics/receiver-question-complete.js', import.meta.url),'utf8');
const script = [createSessionZip, createQualtricsCodec, validateReceiverUrl, postQualtricsBundle]
  .map(fn => fn.toString()).join('\n\n') + `
var receiverUrl = ${JSON.stringify(receiver)};
var fields = null;
var manifest = null;
var preparing = 0;
var getElement = function (id) { return document.getElementById(id); };
getElement('receiver-code').value = ${JSON.stringify(receiverJS)};
getElement('copy-code').onclick = async function () {
  var area = getElement('receiver-code');
  getElement('code-panel').open = true;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(area.value);
    } else {
      area.focus(); area.select();
      if (!document.execCommand('copy')) throw new Error('Copy unavailable');
    }
    getElement('copy-status').textContent = 'Copied. Replace the entire question JavaScript with this code, save, and publish.';
  } catch (error) {
    area.focus(); area.select();
    getElement('copy-status').textContent = 'Code selected. Press Command+C on Mac or Ctrl+C on Windows, then paste into the question JavaScript editor.';
  }
};
function rememberManifest() {
  try { localStorage.setItem('fae_receiver_probe_manifest', JSON.stringify(manifest)); } catch (error) {}
}
async function prepareOfflineProbe() {
  var generation = ++preparing;
  getElement('send').disabled = true;
  getElement('details').disabled = true;
  fields = null;
  getElement('status').textContent = 'Preparing synthetic files...';
  try {
    var random = new Uint8Array(12);
    crypto.getRandomValues(random);
    var randomId = Array.from(random, function (n) { return ('0' + n.toString(16)).slice(-2); }).join('');
    var session = 'probe_' + Date.now() + '_' + randomId;
    var budget = Number(getElement('size').value);
    var specifications = [
      ['MRT/probe.tsv', 'subject\\ttrial\\ttask\\tRT_from_metronome\\n', 'SYNTHETIC\\t1\\tmetronome\\t0.025\\n'],
      ['Image_practice/probe.csv', 'subject,pic1,pic2,RT\\n', 'SYNTHETIC,1,2,0.625\\n'],
      ['Calibration/probe.csv', 'subject,pic1,pic2,RT\\n', 'SYNTHETIC,3,4,0.750\\n'],
      ['Final_judgments/probe.csv', 'subject,pic,confidence\\n', 'SYNTHETIC,1,3\\n']
    ];
    var files = specifications.map(function (spec) {
      return { filename:spec[0], text:spec[1] + spec[2].repeat(Math.ceil(budget / 4 / new TextEncoder().encode(spec[2]).length)) };
    });
    files.push({filename:'Diagnostics/probe.json', text:JSON.stringify({synthetic_only:true,session_id:session,created_at_utc:new Date().toISOString()})});
    var zip = createSessionZip(files);
    var prepared = await createQualtricsCodec().build(zip, {
      filename:'FAE_' + session + '.zip', sessionId:session, subjectId:'SYNTHETIC', runMode:'probe'
    });
    if (generation !== preparing) return;
    fields = prepared;
    manifest = {receiver:receiverUrl, session_id:session, filename:fields.fae_filename,
      zip_bytes:zip.length, sha256:fields.fae_zip_sha256, chunk_count:Number(fields.fae_chunk_count),
      files:files.map(function (file) { return {filename:file.filename, utf8_bytes:new TextEncoder().encode(file.text).length}; })};
    rememberManifest();
    getElement('status').textContent = 'Ready. No data has been sent.';
    getElement('summary').textContent = JSON.stringify(manifest, null, 2);
    getElement('send').disabled = false;
    getElement('details').disabled = false;
  } catch (error) {
    getElement('status').textContent = 'Could not prepare the test: ' + error.message;
  }
}
getElement('size').onchange = prepareOfflineProbe;
getElement('details').onclick = function () {
  if (!manifest) return;
  var address = URL.createObjectURL(new Blob([JSON.stringify(manifest,null,2) + '\\n'],{type:'application/json'}));
  var link = document.createElement('a');
  link.href = address; link.download = manifest.session_id + '_expected.json';
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(function () { URL.revokeObjectURL(address); },1000);
};
getElement('send').onclick = async function () {
  getElement('send').disabled = true;
  getElement('size').disabled = true;
  try {
    rememberManifest();
    getElement('status').textContent = 'Sending this synthetic session to the receiver...';
    await postQualtricsBundle(fields,receiverUrl);
  } catch (error) {
    getElement('status').textContent = error.message;
    getElement('send').disabled = false;
    getElement('size').disabled = false;
  }
};
try {
  var previous = localStorage.getItem('fae_receiver_probe_manifest');
  if (previous) getElement('previous').textContent = 'Previous test details: ' + previous;
} catch (error) {}
var preparation = prepareOfflineProbe();
`;
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>FAE Qualtrics receiver test</title>
<style>
body{font:18px/1.5 system-ui,sans-serif;max-width:780px;margin:48px auto;padding:0 24px;color:#142b39;background:#f5f9fb}
label{display:block;margin-top:24px}select,button{font:inherit;padding:12px;border-radius:6px;margin:8px 8px 12px 0}
button{background:#174c68;color:#fff;border:0;cursor:pointer}button:disabled{opacity:.5;cursor:default}
#details{background:#e2ebf0;color:#173e53}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#fff;padding:20px;border:1px solid #cfdae1;font-size:14px}
#status{font-weight:600}small{overflow-wrap:anywhere}details{margin:20px 0}
textarea{box-sizing:border-box;width:100%;height:240px;font:13px/1.4 monospace;padding:12px}
</style></head><body>
<h1>Test your Qualtrics receiver</h1>
<p>This sends five synthetic task files bundled in one ZIP to your separate test survey. It contains no participant data and needs no account token.</p>
<small>Receiver: ${receiver}</small>
<h2>Install the updated receiver first</h2>
<p>Import the updated field file into this survey. Keep the new <strong>Automatic data receiver - JS fields</strong> block, remove the old receiver block, and place the new embedded fields above the question. Field names must begin with <code>__js_fae_</code>.</p>
<button id="copy-code">Copy corrected receiver JavaScript</button><p id="copy-status" role="status"></p>
<details id="code-panel"><summary>Receiver JavaScript for the new fields</summary><textarea id="receiver-code" readonly aria-label="Corrected receiver JavaScript" spellcheck="false"></textarea></details>
<h2>Send a synthetic test after publishing</h2>
<label for="size">Test size</label><select id="size"><option value="65536">64 KiB — start here</option><option value="2097152">2 MiB — after the first test passes</option></select>
<p id="status" role="status">Preparing synthetic files...</p>
<button id="send" disabled>Send test ZIP to Qualtrics</button><button id="details" disabled>Download expected test details</button>
<p>The send button opens the Qualtrics receiver in this tab. After it finishes, export the receiver's responses as CSV with all fields. The export must match the expected checksum below.</p>
<details open><summary>Expected test details</summary><pre id="summary"></pre></details>
<details><summary>Previous test details</summary><pre id="previous">No previous test recorded in this browser.</pre></details>
<script>${script.replace(/<\/script/gi, '<\\/script')}</script></body></html>\n`;
const output = new URL('../qualtrics/FAE_Receiver_Test.html', import.meta.url);
await writeFile(output, html);
await writeFile(new URL('../qualtrics/FAE_Receiver_Test_v2.html', import.meta.url), html);
console.log('Created self-contained test page: ' + output.pathname);
