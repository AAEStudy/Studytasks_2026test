import { readFile, writeFile } from 'node:fs/promises';

const source = await readFile(new URL('../qualtrics/receiver-question-complete.js', import.meta.url), 'utf8');
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const html = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect task saving to the questionnaires</title>
<style>body{max-width:850px;margin:40px auto;padding:0 24px;font:18px/1.6 system-ui;color:#222}li{margin:20px 0}code,textarea{font-family:monospace}textarea{width:100%;height:180px;box-sizing:border-box}button{font:inherit;padding:10px 18px;cursor:pointer}a{color:#174ea6}</style>
<h1>Connect task saving to the questionnaires</h1>
<p>The 2 MiB ZIP test passed. These changes add the return to your questionnaires after Qualtrics submits the task response.</p>
<ol>
<li>In the existing <b>receiver survey</b>, open <b>Survey Flow</b>. In the Embedded Data element above the receiver block, add one text field named <code>__js_fae_return_url</code>. Leave its value unset so it is received from the task.</li>
<li>Open the receiver question's JavaScript editor. Replace its entire contents with the code below, then save.<p><button id="copy" type="button">Copy updated receiver JavaScript</button> <span id="status" role="status"></span></p><details><summary>View complete JavaScript</summary><textarea id="source" readonly spellcheck="false">${escape(source)}</textarea></details></li>
<li>In <b>Survey Flow</b>, add a <b>Branch after the receiver block</b>. Its conditions should be <code>__js_fae_receiver_status</code> <b>Is Equal To</b> <code>verified</code> <b>AND</b> <code>__js_fae_return_url</code> <b>Is Not Empty</b>. Inside that branch add <b>End of Survey</b>. Choose <b>Customize → Override Survey Options → Redirect to a URL</b>, and enter exactly:<p><code>\${e://Field/__js_fae_return_url}</code></p>Keep response recording enabled: leave <b>Do NOT record survey response</b> unchecked. Apply the Flow changes and <b>Publish</b>. Leave the default thank-you ending for probes without a return URL.</li>
</ol>
<p>After publishing, <a href="../?subjectID=IDQUALTRICS_TEST&id=QUALTRICS_TEST&saveTo=qualtrics">run the actual shortened task integration test</a>. At the end it should save automatically and reach the questionnaires with <code>id=QUALTRICS_TEST</code>. Export the receiver CSV with all fields afterward for verification. The current task is still configured for 6 calibration comparisons and 1 MRT block.</p>
<p>This page changes no settings and sends no data. The test starts only when you open the test link.</p>
<script>
document.getElementById('copy').onclick = async function () {
  var source = document.getElementById('source');
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(source.value);
    else { source.closest('details').open = true; source.focus(); source.select(); if (!document.execCommand('copy')) throw new Error('Copy unavailable'); }
    document.getElementById('status').textContent = 'Copied. Paste into the receiver question JavaScript editor.';
  } catch (error) {
    source.closest('details').open = true; source.focus(); source.select();
    document.getElementById('status').textContent = 'Press Command+C on Mac or Ctrl+C on Windows to copy the selected code.';
  }
};
</script></html>`;
await writeFile(new URL('../qualtrics/FAE_Receiver_Return_Setup.html', import.meta.url), html);
console.log('Created receiver return setup page.');
