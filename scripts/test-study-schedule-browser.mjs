// Local browser checks of the real assembled timeline and break screens.
// No requests reach Qualtrics, DataPipe, GitHub, or other external services.
// Requires the same installed Playwright/Chromium as test-qualtrics-tabs.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const modulePath = process.env.PLAYWRIGHT_MODULE_PATH ||
  (process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
    ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright-core') : 'playwright-core');
const { chromium } = require(modulePath);
const executablePath = process.env.CHROME_EXECUTABLE_PATH || chromium.executablePath();
const screenshotDir = process.env.FAE_SCREENSHOT_DIR;
if (screenshotDir) fs.mkdirSync(screenshotDir, { recursive: true });
let browser, origin;
const errors = [];
const server = http.createServer((request, response) => {
  const url = new URL(request.url, origin);
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  if (pathname === '/qa-plugins.js') {
    // These two plugins are needed only as builder symbols: the selected UI
    // checks never execute image trials or network saves. Instructions are local.
    response.writeHead(200, {'content-type':'application/javascript'});
    return response.end('var jsPsychImageKeyboardResponse = jsPsychHtmlKeyboardResponse; var jsPsychPipe = jsPsychHtmlKeyboardResponse;');
  }
  const filename = path.resolve(root, '.' + pathname);
  if (!filename.startsWith(root) || !fs.existsSync(filename) || fs.statSync(filename).isDirectory()) {
    response.writeHead(404); return response.end('Not found');
  }
  const type = {'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript',
    '.css':'text/css','.csv':'text/csv','.mp3':'audio/mpeg','.png':'image/png','.jpg':'image/jpeg'}[path.extname(filename)] || 'application/octet-stream';
  let body = fs.readFileSync(filename);
  if (path.extname(filename) === '.css') body = body.toString().replace(/@import url\(https?:[^;]+;/g, '');
  if (pathname === '/index.html') {
    body = body.toString().replace(/<link[^>]+https:\/\/fonts\.[^>]+>/g, '')
      .replace(/<script src="https:\/\/unpkg.com\/@jspsych\/plugin-image-keyboard-response[^\"]+"><\/script>/,
        '<script src="/qa-plugins.js"></script>')
      .replace(/<script src="https:\/\/unpkg.com\/@jspsych\/plugin-instructions[^\"]+"><\/script>/,
        '<script src="/js/external/plugin-instructions-custom.js"></script>')
      .replace(/<script src="https:\/\/unpkg.com\/@jspsych-contrib\/plugin-pipe[^\"]+"><\/script>/, '');
  }
  if (pathname === '/main.js') {
    body = body.toString().replace(/start\(\);\s*$/, `
      window.qa = {sharedState, config: STUDY_CONFIG, jsPsych};
      const realRun = jsPsych.run.bind(jsPsych);
      jsPsych.run = timeline => {
        window.qa.timeline = timeline;
        const selected = new URLSearchParams(location.search).get('screen');
        let trials;
        if (selected === 'overview' || selected === 'short') trials = [timeline[0]];
        else trials = [timeline.find(trial => trial.data?.event === 'scheduled_break' && String(trial.data.section) === selected)];
        if (!trials[0]) throw new Error('Missing selected screen');
        // Completion is a local marker; saves and actual navigation cannot run.
        trials.push({type:jsPsychHtmlKeyboardResponse, stimulus:'<p id="qa-after">Next task ready</p>', choices:'NO_KEYS'});
        return realRun(trials);
      };
      start();
    `);
  }
  response.writeHead(200, {'content-type':type, 'cache-control':'no-store'});
  response.end(body);
});

try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({executablePath, headless:true, args:['--no-sandbox']});
  const context = await browser.newContext({ viewport:{width:1440,height:1100} });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin
    ? route.continue() : (errors.push('Blocked unexpected external request: ' + route.request().url()), route.abort()));
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install();
  const go = async (screen, mode='full') => {
    await page.goto(`${origin}/?mode=${mode}&screen=${screen}&subjectID=LOCAL_TEST`);
    await page.waitForFunction(() => window.qa?.timeline);
  };
  const screenshot = async name => { if (screenshotDir) await page.screenshot({path:path.join(screenshotDir, name + '.png'), fullPage:true}); };

  await go('overview');
  assert.match(await page.locator('body').innerText(), /four sections/);
  await screenshot('overview');
  for (const [section, duration] of [[2,180000], [4,300000]]) {
    await go(String(section));
    const next = page.locator('[data-break-action="continue"]');
    await next.waitFor();
    assert.equal(await next.isDisabled(), true);
    await page.keyboard.press('Space');
    assert.equal(await page.locator('#qa-after').count(), 0);
    await page.clock.fastForward(duration - 1500);
    assert.equal(await next.isDisabled(), true);
    await screenshot(`mandatory-${section}-waiting`);
    await page.clock.fastForward(2000);
    assert.equal(await next.isEnabled(), true);
    assert.equal(await page.locator('#qa-after').count(), 0, 'timer must not auto-advance');
    await screenshot(`mandatory-${section}-ready`);
    await next.click();
    await page.locator('#qa-after').waitFor();
    const record = await page.evaluate(() => window.qa.sharedState.scheduledBreaks[0]);
    assert.equal(record.minimum_met, true);
    assert.ok(record.break_duration_ms >= duration);
  }
  await go('1');
  await screenshot('optional-choice');
  await page.locator('[data-break-action="continue"]').click();
  await page.locator('#qa-after').waitFor();
  assert.equal(await page.evaluate(() => window.qa.sharedState.scheduledBreaks[0].skipped), true);

  await go('3');
  await page.locator('[data-break-action="take"]').click();
  await page.clock.fastForward(30000);
  await screenshot('optional-taking');
  await page.locator('[data-break-action="continue"]').click();
  await page.locator('#qa-after').waitFor();
  assert.equal(await page.evaluate(() => window.qa.sharedState.scheduledBreaks[0].ended_early), true);

  await go('short', 'test');
  assert.match(await page.locator('.study-test-banner').innerText(), /SHORT TEST MODE/);
  assert.equal(await page.evaluate(() => window.qa.sharedState.mrtIntervalSchedule[0].tappingTrials), 31);
  assert.equal(await page.evaluate(() => window.qa.timeline.filter(t => t.data?.event === 'scheduled_break').length), 0);
  assert.equal(await page.evaluate(() => window.qa.config.calibrationComparisons), 6);
  await screenshot('short-mode');
  assert.deepEqual(errors, []);
  console.log('Browser checks passed: overview, both mandatory timers, explicit continuation, optional skip/early return, short mode. All traffic stayed local.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
