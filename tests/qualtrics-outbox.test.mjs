import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { stageQualtricsSession, listPendingQualtricsSessions, completeQualtricsReturn } from '../js/qualtrics-outbox.mjs';

// This transactional fixture commits writes only at transaction completion. It
// can fail a commit after individual requests have succeeded, as browsers can.
function browserStorage({ failCommit = false } = {}) {
  const records = new Map();
  const indexedDB = { open() {
    const request = {};
    queueMicrotask(() => {
      request.result = {
        close() {},
        transaction() {
          const pending = [];
          const tx = {
            objectStore() {
              return {
                put(record) { pending.push(() => records.set(record.sessionId, structuredClone(record))); },
                delete(key) { pending.push(() => records.delete(key)); },
                get(key) { const result = {}; queueMicrotask(() => { result.result = structuredClone(records.get(key)); result.onsuccess(); }); return result; },
                getAll() { const result = {}; queueMicrotask(() => { result.result = [...records.values()].map(record => structuredClone(record)); result.onsuccess(); }); return result; }
              };
            }
          };
          setTimeout(() => {
            if (failCommit && pending.length) { tx.error = new Error('Quota exceeded'); tx.onabort(); }
            else { pending.forEach(commit => commit()); tx.oncomplete(); }
          }, 0);
          return tx;
        }
      };
      request.onsuccess();
    });
    return request;
  } };
  const metadata = new Map();
  const sessionStorage = {
    setItem(key, value) { metadata.set(key, value); },
    getItem(key) { return metadata.get(key) ?? null; },
    removeItem(key) { metadata.delete(key); }
  };
  return { records, metadata, indexedDB, sessionStorage };
}

const subject = 'ID007';
const returnUrl = 'https://usf.az1.qualtrics.com/jfe/form/SV_custom?Q_CHL=qr&id=007&token=a%2Bb%26c#resume';
const receiptBase = 'https://aaestudy.github.io/Studytasks_2026test/qualtrics/saved.html';
const fields = (session = 'session-a', participant = subject) => ({
  fae_session_id: session, fae_subject_id: participant, fae_schema: 'fae-qualtrics-zip-v1',
  fae_zip_0001: 'UEsDBAo=', fae_zip_sha256: 'synthetic'
});
const env = storage => ({ ...storage, crypto: webcrypto, location: { origin: 'https://aaestudy.github.io' }, now: () => 12345 });
const receipt = staged => {
  const url = new URL(staged.fields.fae_return_url);
  return { sessionId: url.searchParams.get('session'), nonce: url.searchParams.get('nonce') };
};

test('durable staging commits an independent snapshot and matching receipt clears it after returning the exact custom URL', async () => {
  const storage = browserStorage();
  const original = fields();
  const staged = await stageQualtricsSession({ fields: original, returnUrl, receiptBase }, env(storage));
  assert.equal(staged.backupRetained, true);
  assert.equal(staged.returnMode, 'receipt');
  assert.equal(storage.records.size, 1, 'stage must await transaction commit');
  assert.equal(Object.hasOwn(original, 'fae_return_url'), false);
  original.fae_zip_0001 = 'changed after staging';
  const pending = await listPendingQualtricsSessions(subject, env(storage));
  assert.equal(pending.length, 1);
  assert.equal(pending[0].fields.fae_zip_0001, 'UEsDBAo=');
  assert.equal(pending[0].createdAt, 12345);
  assert.equal(new URL(staged.fields.fae_return_url).pathname, new URL(receiptBase).pathname);
  assert.equal(await completeQualtricsReturn(receipt(staged), env(storage)), returnUrl);
  assert.equal(storage.records.size, 0);
  await assert.rejects(completeQualtricsReturn(receipt(staged), env(storage)), /No matching save receipt/);
});

test('wrong session or nonce cannot remove a backup; pending payloads are filtered by participant', async () => {
  const storage = browserStorage();
  const staged = await stageQualtricsSession({ fields: fields(), returnUrl, receiptBase }, env(storage));
  await stageQualtricsSession({ fields: fields('session-b', 'ID008'), returnUrl, receiptBase }, env(storage));
  const genuine = receipt(staged);
  for (const invalid of [{ ...genuine, nonce: '0'.repeat(48) }, { ...genuine, sessionId: 'another-session' }]) {
    await assert.rejects(completeQualtricsReturn(invalid, env(storage)), /No matching save receipt/);
    assert.equal(storage.records.size, 2);
  }
  assert.deepEqual((await listPendingQualtricsSessions(subject, env(storage))).map(record => record.sessionId), ['session-a']);
  assert.deepEqual(await listPendingQualtricsSessions('ID009', env(storage)), []);
});

test('an IndexedDB commit failure retains metadata only and never claims a payload backup', async () => {
  const storage = browserStorage({ failCommit: true });
  const staged = await stageQualtricsSession({ fields: fields(), returnUrl, receiptBase }, env(storage));
  assert.equal(staged.backupRetained, false);
  assert.equal(staged.returnMode, 'receipt');
  assert.equal(storage.records.size, 0);
  assert.equal(storage.metadata.size, 1);
  const metadata = JSON.parse([...storage.metadata.values()][0]);
  assert.deepEqual(Object.keys(metadata).sort(), ['nonce', 'returnUrl', 'sessionId']);
  assert.deepEqual(await listPendingQualtricsSessions(subject, env(storage)), []);
  await assert.rejects(completeQualtricsReturn({ ...receipt(staged), nonce: 'f'.repeat(48) }, env(storage)), /No matching/);
  assert.equal(storage.metadata.size, 1);
  assert.equal(await completeQualtricsReturn(receipt(staged), env(storage)), returnUrl);
  assert.equal(storage.metadata.size, 0);
});

test('blocked IndexedDB uses a metadata receipt; failure of both stores falls through to direct survey return', async () => {
  const storage = browserStorage();
  const blockedDB = { open() { throw new Error('Storage blocked'); } };
  const metadataEnv = { ...env(storage), indexedDB: blockedDB };
  const staged = await stageQualtricsSession({ fields: fields(), returnUrl, receiptBase }, metadataEnv);
  assert.equal(staged.returnMode, 'receipt');
  assert.equal(staged.backupRetained, false);
  assert.equal(await completeQualtricsReturn(receipt(staged), metadataEnv), returnUrl);
  const unavailable = { ...metadataEnv, sessionStorage: { setItem() { throw new Error('Blocked'); } } };
  const direct = await stageQualtricsSession({ fields: fields(), returnUrl, receiptBase }, unavailable);
  assert.equal(direct.returnMode, 'direct');
  assert.equal(direct.backupRetained, false);
  assert.equal(direct.fields.fae_return_url, returnUrl);
  assert.equal(direct.fields.fae_zip_0001, fields().fae_zip_0001);
});

test('untrusted destinations and malformed receipts fail without staging or deleting data', async () => {
  const storage = browserStorage();
  for (const invalidUrl of ['https://evil.example/', 'https://usf.az1.qualtrics.com.evil.example/', 'http://usf.az1.qualtrics.com/', 'https://user:pass@usf.az1.qualtrics.com/']) {
    await assert.rejects(stageQualtricsSession({ fields: fields(), returnUrl: invalidUrl, receiptBase }, env(storage)), /HTTPS Qualtrics/);
  }
  for (const badReceipt of ['https://evil.example/saved.html', receiptBase + '?other=1', receiptBase + '#fragment']) {
    await assert.rejects(stageQualtricsSession({ fields: fields(), returnUrl, receiptBase: badReceipt }, env(storage)), /task's origin/);
  }
  assert.equal(storage.records.size, 0);
  await assert.rejects(completeQualtricsReturn({ sessionId: 'session-a', nonce: 'bad' }, env(storage)), /invalid/);
});

test('separate-tab mode retains a receipt when storage is blocked and keeps the original return in task memory', async () => {
  const unavailable = { indexedDB: undefined, sessionStorage: undefined, crypto: webcrypto, location: { origin: 'https://aaestudy.github.io' } };
  const staged = await stageQualtricsSession({ fields: fields(), returnUrl, receiptBase, returnViaOpener: true }, unavailable);
  assert.equal(staged.returnMode, 'receipt');
  assert.equal(staged.backupRetained, false);
  assert.equal(staged.returnUrl, returnUrl);
  assert.equal(new URL(staged.fields.fae_return_url).searchParams.get('tab'), '1');
  assert.equal(receipt(staged).sessionId, 'session-a');
  await assert.rejects(stageQualtricsSession({ fields: fields(), returnUrl, receiptBase, returnViaOpener: true }, { ...unavailable, crypto: undefined }), /secure/);
});

test('the child receipt notifies the original window without clearing backups or navigating itself; legacy receipts still return directly', async () => {
  const page = readFileSync(new URL('../qualtrics/saved.html', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /fetch\(|\.submit\(|setEmbeddedData|setJSEmbeddedData/);
  const source = page.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^  import .*\n/gm, '');
  for (const tab of ['1', '']) {
    let clears = 0, notifications = 0;
    const navigations = [], elements = new Map();
    const element = id => { if (!elements.has(id)) elements.set(id, {}); return elements.get(id); };
    const parameters = new URLSearchParams({ session: 'session-a', nonce: 'a'.repeat(48) });
    if (tab) parameters.set('tab', tab);
    vm.runInNewContext(source, { URLSearchParams,
      document: { getElementById: element },
      window: { location: { search: '?' + parameters, replace: url => navigations.push(url) }, close() {} },
      completeQualtricsReturn: async value => { clears++; assert.equal(value.sessionId, 'session-a'); return returnUrl; },
      notifyQualtricsOpener: async value => { notifications++; assert.equal(value.nonce, 'a'.repeat(48)); return false; }
    });
    await new Promise(resolve => setImmediate(resolve));
    if (tab) {
      assert.equal(clears, 0); assert.deepEqual(navigations, []); assert.equal(notifications, 1);
      assert.match(element('status').textContent, /Task data submitted/);
      assert.doesNotMatch(element('status').textContent, /failed|could not be confirmed/);
      await element('notify').onclick();
      assert.equal(notifications, 2); assert.equal(clears, 0);
    } else {
      assert.equal(clears, 1); assert.equal(notifications, 0); assert.deepEqual(navigations, [returnUrl]);
    }
  }
});
