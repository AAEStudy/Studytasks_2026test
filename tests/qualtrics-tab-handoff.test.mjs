import test from 'node:test';
import assert from 'node:assert/strict';
import { openQualtricsSaveTab, waitForQualtricsTabReceipt, notifyQualtricsOpener } from '../js/qualtrics-tab-handoff.mjs';

const origin = 'https://aaestudy.github.io';
const sessionId = 'completed-session';
const nonce = 'a'.repeat(48);
const fields = {
  fae_session_id: sessionId,
  fae_return_url: origin + '/Studytasks_2026test/qualtrics/saved.html?session=' + sessionId + '&nonce=' + nonce + '&tab=1'
};
const receipt = { type: 'fae-qualtrics-save-receipt', sessionId, nonce };

function clock() {
  let now = 0, counter = 0;
  const timers = new Map();
  return {
    timers,
    setTimeout(callback, delay) { const id = ++counter; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    advance(elapsed) {
      const until = now + elapsed;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= until).sort((a,b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) break;
        timers.delete(next[0]); now = next[1].at; next[1].callback();
      }
      now = until;
    }
  };
}

function windows() {
  const create = () => {
    const listeners = new Set();
    return {
      location: { origin }, opener: null, listeners,
      document: { title: '', body: { textContent: '', style: {} } },
      closeCount: 0, focusCount: 0, navigations: [], posts: [],
      addEventListener(type, callback) { assert.equal(type, 'message'); listeners.add(callback); },
      removeEventListener(type, callback) { assert.equal(type, 'message'); listeners.delete(callback); },
      dispatch(event) { for (const listener of [...listeners]) listener(event); },
      close() { this.closeCount++; },
      focus() { this.focusCount++; }
    };
  };
  const parent = create(), child = create();
  child.opener = parent;
  parent.postMessage = (data, targetOrigin) => {
    parent.posts.push({ data, targetOrigin });
    queueMicrotask(() => parent.dispatch({ data, origin, source: child }));
  };
  child.postMessage = (data, targetOrigin) => {
    child.posts.push({ data, targetOrigin });
    queueMicrotask(() => child.dispatch({ data, origin, source: parent }));
  };
  parent.open = () => child;
  return { parent, child };
}

function channels() {
  const instances = new Set();
  class BroadcastChannel {
    constructor(name) { this.name = name; this.closed = false; instances.add(this); }
    postMessage(data) {
      for (const target of instances) {
        if (target !== this && target.name === this.name && !target.closed) {
          queueMicrotask(() => { if (!target.closed && target.onmessage) target.onmessage({ data, origin }); });
        }
      }
    }
    close() { this.closed = true; instances.delete(this); }
  }
  return { BroadcastChannel, instances };
}

function env(window, time, BroadcastChannel = null) {
  return { window, BroadcastChannel, setTimeout: time.setTimeout, clearTimeout: time.clearTimeout };
}

test('a new named tab is opened synchronously and popup denial is explicit', () => {
  const { parent, child } = windows();
  const calls = [];
  parent.open = (...args) => { calls.push(args); return child; };
  const tab = openQualtricsSaveTab(parent);
  assert.equal(calls.length, 1, 'window.open must run before this function returns');
  assert.equal(calls[0][0], '');
  assert.match(calls[0][1], /^fae_save_[A-Za-z0-9_]+$/);
  assert.equal(calls[0][1], tab.targetName);
  assert.equal(calls[0][2], 'popup=no');
  assert.equal(tab.blocked, false);
  assert.equal(tab.windowRef, child);
  assert.match(child.document.body.textContent, /Preparing your task data/);
  tab.close(); assert.equal(child.closeCount, 1);
  for (const open of [() => null, () => { throw new Error('Blocked'); }]) {
    const denied = openQualtricsSaveTab({ open });
    assert.equal(denied.blocked, true);
    assert.equal(denied.windowRef, null);
    assert.doesNotThrow(() => denied.close());
  }
});

test('postMessage receipt validates exact origin, child source, session and nonce before parent acknowledges', async () => {
  const { parent, child } = windows(), time = clock();
  const tab = openQualtricsSaveTab(parent);
  const waiter = waitForQualtricsTabReceipt({ fields, tab }, env(parent, time));
  let received = false;
  waiter.promise.then(() => { received = true; });
  assert.equal(waiter.acknowledge(), false);
  for (const wrong of [
    { data: receipt, origin: 'https://attacker.example', source: child },
    { data: receipt, origin, source: {} },
    { data: { ...receipt, nonce: 'b'.repeat(48) }, origin, source: child },
    { data: { ...receipt, sessionId: 'another-session' }, origin, source: child }
  ]) parent.dispatch(wrong);
  await Promise.resolve();
  assert.equal(received, false);
  assert.equal(child.closeCount, 0);
  const notified = notifyQualtricsOpener({ sessionId, nonce }, env(child, time));
  assert.deepEqual(await waiter.promise, { sessionId, nonce });
  assert.equal(child.closeCount, 0, 'receipt alone must not close the save tab');
  parent.dispatch({ data: receipt, origin, source: child });
  assert.equal(waiter.acknowledge(), true);
  assert.equal(await notified, true);
  assert.ok(child.closeCount >= 1);
  assert.equal(parent.focusCount, 1);
  assert.equal(waiter.acknowledge(), false, 'duplicate receipts and acknowledgements cannot rerun completion');
  assert.equal(parent.listeners.size, 0);
  assert.equal(child.listeners.size, 0);
  assert.equal(time.timers.size, 0);
  assert.ok([...parent.posts, ...child.posts].every(message => message.targetOrigin === origin));
});

test('BroadcastChannel completes without opener references and never reads the COOP-severed closed property', async () => {
  const { parent, child } = windows(), time = clock(), bus = channels();
  child.opener = null;
  const severed = { postMessage() { throw new Error('COOP'); }, close() {} };
  Object.defineProperty(severed, 'closed', { get() { assert.fail('A severed closed property is not a save status'); } });
  const tab = { windowRef: severed, blocked: false, close() {} };
  const waiter = waitForQualtricsTabReceipt({ fields, tab }, env(parent, time, bus.BroadcastChannel));
  const notified = notifyQualtricsOpener({ sessionId, nonce }, env(child, time, bus.BroadcastChannel));
  assert.deepEqual(await waiter.promise, { sessionId, nonce });
  waiter.acknowledge();
  assert.equal(await notified, true);
  assert.equal(child.closeCount, 1);
  assert.equal(bus.instances.size, 0);
  assert.equal(time.timers.size, 0);
});

test('no acknowledgement returns false after two seconds without closing, navigation, or payload operations', async () => {
  const { parent, child } = windows(), time = clock();
  parent.postMessage = (data, targetOrigin) => { parent.posts.push({ data, targetOrigin }); };
  const notified = notifyQualtricsOpener({ sessionId, nonce }, env(child, time));
  child.dispatch({ data: { type: 'fae-qualtrics-save-ack', sessionId, nonce }, origin: 'https://attacker.example', source: parent });
  child.dispatch({ data: { type: 'fae-qualtrics-save-ack', sessionId, nonce }, origin, source: {} });
  child.dispatch({ data: { type: 'fae-qualtrics-save-ack', sessionId, nonce: 'b'.repeat(48) }, origin, source: parent });
  time.advance(1999);
  assert.equal(child.closeCount, 0);
  time.advance(1);
  assert.equal(await notified, false);
  assert.equal(child.closeCount, 0);
  assert.deepEqual(child.navigations, []);
  assert.ok(parent.posts.length > 1, 'retry only the lightweight receipt message');
  assert.ok(parent.posts.every(message => Object.keys(message.data).sort().join(',') === 'nonce,sessionId,type'));
  assert.equal(child.listeners.size, 0);
  assert.equal(time.timers.size, 0);
});

test('parent waits indefinitely, rejects mismatched callback metadata, and cancels without closing the tab', async () => {
  const { parent, child } = windows(), time = clock(), bus = channels();
  const tab = openQualtricsSaveTab(parent);
  const waiter = waitForQualtricsTabReceipt({ fields, tab }, env(parent, time, bus.BroadcastChannel));
  let completed = false;
  waiter.promise.then(() => { completed = true; }, () => {});
  time.advance(10 * 60 * 1000);
  await Promise.resolve();
  assert.equal(completed, false);
  assert.equal(child.closeCount, 0);
  waiter.dispose();
  await assert.rejects(waiter.promise, /cancelled/);
  assert.equal(bus.instances.size, 0);
  assert.equal(parent.listeners.size, 0);
  assert.equal(child.closeCount, 0);
  for (const badFields of [
    { ...fields, fae_session_id: 'other-session' },
    { ...fields, fae_return_url: fields.fae_return_url.replace(origin, 'https://attacker.example') },
    { ...fields, fae_return_url: fields.fae_return_url + '&nonce=' + nonce }
  ]) assert.throws(() => waitForQualtricsTabReceipt({ fields: badFields, tab }, env(parent, time)), /does not belong/);
});
