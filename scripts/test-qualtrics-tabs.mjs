// Optional real-browser smoke test. All browser traffic stays on loopback;
// actual Qualtrics, DataPipe, and participant records are never contacted.
// Requires OpenSSL and Playwright plus an installed Chromium executable.
// Optional environment: PLAYWRIGHT_MODULE_PATH, CHROME_EXECUTABLE_PATH.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const playwrightPath = process.env.PLAYWRIGHT_MODULE_PATH ||
  (process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
    ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright-core')
    : 'playwright-core');
let chromium;
try { ({ chromium } = require(playwrightPath)); }
catch {
  throw new Error('Playwright is unavailable. Install playwright-core or set PLAYWRIGHT_MODULE_PATH to its module directory. This script does not download dependencies.');
}
const executablePath = process.env.CHROME_EXECUTABLE_PATH || chromium.executablePath();
if (!fs.existsSync(executablePath)) {
  throw new Error('Chromium is unavailable. Set CHROME_EXECUTABLE_PATH to an installed Chrome/Chromium executable. This script does not download a browser.');
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'fae-tabs-smoke-'));
let parentServer, receiverServer, browser, parentOrigin, receiverOrigin;
const submissions = [], failures = [], results = [];
const modes = ['normal', 'coop', 'noReceipt', 'wrong', 'noAck'];
const json = value => JSON.stringify(value).replaceAll('<', '\\u003c');
const allowedModules = new Set([
  '/js/qualtrics-bundle.mjs', '/js/session-bundle.mjs',
  '/js/qualtrics-outbox.mjs', '/js/qualtrics-tab-handoff.mjs'
]);
const send = (response, status, type, body, headers = {}) => {
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...headers });
  response.end(body);
};
const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const close = server => server && server.listening
  ? new Promise(resolve => server.close(resolve)) : Promise.resolve();

function originalTaskFixture() {
  return `<!doctype html><title>Original task tab</title>
<button id="go">Finish and save</button><p id="status">Ready</p>
<script type="module">
import {createQualtricsCodec,postQualtricsBundle} from '/js/qualtrics-bundle.mjs';
import {createSessionZip} from '/js/session-bundle.mjs';
import {stageQualtricsSession,listPendingQualtricsSessions,completeQualtricsReturn} from '/js/qualtrics-outbox.mjs';
import {openQualtricsSaveTab,waitForQualtricsTabReceipt} from '/js/qualtrics-tab-handoff.mjs';
const mode=new URLSearchParams(location.search).get('mode');
// This deliberately fake URL is only stored and compared, never navigated to.
const expectedReturn='https://fixture.qualtrics.com/jfe/form/SV_TEST?ID=123&custom=a%20b#section';
window.pendingCount=async()=> (await listPendingQualtricsSessions('123')).length;
document.getElementById('go').onclick=async()=>{
  // Opening must happen synchronously in this real click gesture.
  const tab=openQualtricsSaveTab(window);
  try {
    const bytes=createSessionZip([{filename:'calibration/fixture.csv',text:'id,value\\n123,1\\n'}]);
    const fields=await createQualtricsCodec().build(bytes,{sessionId:'local-smoke-'+mode,subjectId:'123',filename:'local-smoke.zip',runMode:'test'});
    const pending=await stageQualtricsSession({fields,returnUrl:expectedReturn,
      receiptBase:location.origin+'/Studytasks_2026test/qualtrics/saved.html',returnViaOpener:true});
    const waiter=waitForQualtricsTabReceipt({fields:pending.fields,tab});
    document.getElementById('status').textContent='Waiting for recorded response';
    waiter.promise.then(async receipt=>{
      if(mode==='noAck')return;
      const destination=await completeQualtricsReturn(receipt);
      if(destination!==expectedReturn)throw new Error('Original questionnaire URL changed');
      waiter.acknowledge();
      // The browser assertion checks ID, extra query parameters, and hash.
      location.replace('/questionnaires?ID=123&custom=a%20b#section');
    }).catch(error=>{document.getElementById('status').textContent='ERROR '+error.message;});
    await postQualtricsBundle(pending.fields,${json(receiverOrigin + '/jfe/form/SV_LOCAL')},document,{target:tab.targetName});
  }catch(error){document.getElementById('status').textContent='ERROR '+error.message;console.error(error);}
};
</script>`;
}

function serveTask(request, response) {
  const url = new URL(request.url, parentOrigin);
  if (url.pathname === '/') return send(response, 200, 'text/html', originalTaskFixture());
  if (url.pathname === '/questionnaires') {
    return send(response, 200, 'text/html', '<h1>Questionnaires resumed in original tab</h1>');
  }
  if (url.pathname === '/Studytasks_2026test/qualtrics/saved.html') {
    // Always exercise the real callback page, including its actual tab=1 branch.
    const source = fs.readFileSync(path.join(root, 'qualtrics/saved.html'), 'utf8')
      .replaceAll("'../js/", "'/js/").replaceAll('"../js/', '"/js/');
    return send(response, 200, 'text/html', source);
  }
  if (allowedModules.has(url.pathname)) {
    let source = fs.readFileSync(path.join(root, url.pathname), 'utf8');
    if (url.pathname === '/js/qualtrics-bundle.mjs') {
      // Substitute origin allowlists in memory only. Production files remain
      // unchanged, and every network request is independently restricted below.
      source = source
        .replace(/url\.origin !== 'https:\/\/[^']+\.qualtrics\.com'/, `url.origin !== ${json(receiverOrigin)}`)
        .replace(/url\.origin === 'https:\/\/aaestudy\.github\.io'/, `url.origin === ${json(parentOrigin)}`);
    }
    return send(response, 200, 'application/javascript', source);
  }
  return send(response, 404, 'text/plain', 'Not found');
}

function serveMockReceiver(request, response) {
  if (request.method !== 'POST') return send(response, 404, 'text/plain', 'POST required');
  let body = '';
  request.on('data', chunk => { body += chunk; });
  request.on('end', () => {
    const fields = Object.fromEntries(new URLSearchParams(body));
    const session = fields.__js_fae_session_id || '';
    submissions.push({ session, fields });
    let callback = fields.__js_fae_return_url;
    if (session.endsWith('wrong')) {
      const wrong = new URL(callback);
      wrong.searchParams.set('nonce', 'e'.repeat(48));
      callback = wrong.href;
    }
    // The button explicitly simulates the post-recording End of Survey redirect.
    // COOP on this other port deliberately severs the original opener reference.
    const headers = session.endsWith('coop') ? { 'cross-origin-opener-policy': 'same-origin' } : {};
    return send(response, 200, 'text/html', `<!doctype html><title>Mock receiver</title>
<p>Mock response ready to record</p><button id="complete">Record response</button>
<script>document.getElementById('complete').onclick=()=>location.replace(${json(callback)});</script>`, headers);
  });
}

try {
  const key = path.join(temporary, 'key.pem'), cert = path.join(temporary, 'cert.pem');
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
  } catch {
    throw new Error('OpenSSL is required to generate the temporary loopback HTTPS certificate.');
  }
  const tls = { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
  parentServer = https.createServer(tls, serveTask);
  receiverServer = https.createServer(tls, serveMockReceiver);
  await listen(parentServer);
  await listen(receiverServer);
  parentOrigin = 'https://127.0.0.1:' + parentServer.address().port;
  receiverOrigin = 'https://127.0.0.1:' + receiverServer.address().port;
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });

  for (const mode of modes) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    context.setDefaultTimeout(10000);
    try {
      await context.route('**/*', async route => {
        const origin = new URL(route.request().url()).origin;
        if (origin !== parentOrigin && origin !== receiverOrigin) {
          failures.push('External request was blocked: ' + origin);
          await route.abort();
        } else await route.continue();
      });
      const page = await context.newPage();
      page.on('pageerror', error => failures.push(mode + ': ' + error.message));
      await page.goto(parentOrigin + '/?mode=' + mode);
      const popupPromise = page.waitForEvent('popup');
      await page.click('#go');
      const popup = await popupPromise;
      popup.on('pageerror', error => failures.push(mode + ' popup: ' + error.message));
      await popup.waitForURL(receiverOrigin + '/jfe/form/SV_LOCAL');
      await popup.waitForSelector('#complete');
      assert.equal(page.url(), parentOrigin + '/?mode=' + mode, 'Parent left before the receiver recorded');
      assert.equal(await page.locator('#status').innerText(), 'Waiting for recorded response');
      assert.equal(await page.evaluate(() => window.pendingCount()), 1, 'Unconfirmed payload must remain backed up');
      if (mode === 'coop') assert.equal(await popup.evaluate(() => window.opener === null), true, 'COOP must sever opener');

      if (mode === 'noReceipt') {
        await popup.close();
        await page.waitForTimeout(2300);
        assert.equal(await page.locator('#status').innerText(), 'Waiting for recorded response', 'Closing child cannot claim success or failure');
        assert.equal(await page.evaluate(() => window.pendingCount()), 1);
        results.push({ mode, passed: true, parentStayed: true, backupRetained: true });
      } else if (mode === 'wrong' || mode === 'noAck') {
        await popup.click('#complete');
        await page.waitForTimeout(2300);
        assert.equal(page.url(), parentOrigin + '/?mode=' + mode, 'Unacknowledged receipt cannot redirect parent');
        assert.equal(await page.evaluate(() => window.pendingCount()), 1);
        assert.equal(await page.locator('#status').innerText(), 'Waiting for recorded response');
        assert.match(await popup.locator('#status').innerText(), /^Task data submitted\. Please return to the original task window\./);
        assert.equal(popup.isClosed(), false, 'Without ACK, receipt tab should remain available');
        results.push({ mode, passed: true, parentStayed: true, backupRetained: true, neutralReceiptMessage: true });
      } else {
        await popup.click('#complete');
        await page.waitForURL(parentOrigin + '/questionnaires?ID=123&custom=a%20b#section');
        await page.waitForTimeout(500);
        assert.equal(popup.isClosed(), true, 'Child must close after parent ACK');
        const pending = await page.evaluate(async () => {
          const { listPendingQualtricsSessions } = await import('/js/qualtrics-outbox.mjs');
          return (await listPendingQualtricsSessions('123')).length;
        });
        assert.equal(pending, 0, 'Confirmed matching backup must clear');
        results.push({ mode, passed: true, parentRedirected: true, childClosed: true, backupCleared: true });
      }
    } finally { await context.close(); }
  }
  assert.equal(failures.length, 0, failures.join('\n'));
  assert.equal(submissions.length, modes.length, 'Exactly one POST per run');
  assert.ok(submissions.every(submission => submission.fields.__js_fae_zip_0001), 'Actual prefixed ZIP fields must POST');
  console.log(JSON.stringify({ chromium: await browser.version(), actualReceipt: true, results,
    submissions: submissions.length, externalRequests: failures }, null, 2));
} finally {
  if (browser) await browser.close();
  await Promise.all([close(parentServer), close(receiverServer)]);
  fs.rmSync(temporary, { recursive: true, force: true });
}
