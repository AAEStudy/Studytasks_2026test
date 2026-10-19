// Only the receipt reached AFTER Qualtrics submission may finish the handoff.
// Closing a tab, HTTP 200, or loss of window.opener is not save confirmation.
const RECEIPT = 'fae-qualtrics-save-receipt';
const ACKNOWLEDGEMENT = 'fae-qualtrics-save-ack';
const CHANNEL_PREFIX = 'fae-qualtrics-save:';

function value(env, name) {
  try { return Object.prototype.hasOwnProperty.call(env, name) ? env[name] : globalThis[name]; }
  catch { return undefined; }
}

function browserWindow(env) {
  const result = value(env, 'window');
  if (!result || !result.location || !result.location.origin) throw new Error('The task window is unavailable.');
  return result;
}

function credentials(sessionId, nonce) {
  if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 256 || /[\r\n\0]/.test(sessionId) ||
      typeof nonce !== 'string' || !/^[a-f0-9]{48}$/.test(nonce)) {
    throw new Error('Invalid Qualtrics receipt.');
  }
  return { sessionId, nonce };
}

function matches(data, type, receipt) {
  return data && typeof data === 'object' && data.type === type &&
    data.sessionId === receipt.sessionId && data.nonce === receipt.nonce;
}

function openChannel(receipt, env) {
  try {
    const BroadcastChannel = value(env, 'BroadcastChannel');
    return typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL_PREFIX + receipt.sessionId) : null;
  } catch { return null; }
}

function post(target, message, origin) {
  try { if (target && typeof target.postMessage === 'function') target.postMessage(message, origin); }
  catch { /* A COOP policy may sever the window reference; the channel still works. */ }
}

/** Call directly in the final keyboard/button gesture, before any await. */
export function openQualtricsSaveTab(windowObject = globalThis.window) {
  const suffix = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
  const targetName = 'fae_save_' + suffix.replace(/[^A-Za-z0-9_]/g, '');
  let windowRef = null;
  try { windowRef = windowObject.open('', targetName, 'popup=no'); }
  catch { /* Popup denial is handled by an explicit button in the task. */ }
  if (windowRef) {
    try {
      windowRef.document.title = 'Saving task data';
      windowRef.document.body.textContent = 'Preparing your task data. Please keep this tab open.';
      windowRef.document.body.style.cssText = 'max-width:700px;margin:15vh auto;padding:24px;font:20px/1.5 system-ui,sans-serif';
    } catch { /* Blank-tab painting is optional and cannot prevent the save. */ }
  }
  return {
    targetName,
    windowRef,
    blocked: !windowRef,
    close() { try { if (windowRef) windowRef.close(); } catch {} }
  };
}

/** Register before POST. The promise intentionally has no guessed-save timeout. */
export function waitForQualtricsTabReceipt({ fields, tab }, env = {}) {
  const windowObject = browserWindow(env);
  const origin = windowObject.location.origin;
  const callback = new URL(fields.fae_return_url);
  const receipt = credentials(callback.searchParams.get('session'), callback.searchParams.get('nonce'));
  if (callback.protocol !== 'https:' || callback.origin !== origin || callback.username || callback.password ||
      callback.searchParams.getAll('session').length !== 1 || callback.searchParams.getAll('nonce').length !== 1 ||
      receipt.sessionId !== fields.fae_session_id || !tab || tab.blocked || !tab.windowRef) {
    throw new Error('The save receipt does not belong to this task window.');
  }
  const channel = openChannel(receipt, env);
  let settled = false, disposed = false, acknowledged = false;
  let resolveReceipt, rejectReceipt;
  const promise = new Promise((resolve, reject) => { resolveReceipt = resolve; rejectReceipt = reject; });
  // Disposal is cancellation; callers may attach their await slightly later.
  promise.catch(() => {});
  function accept(data) {
    if (disposed || settled || !matches(data, RECEIPT, receipt)) return;
    settled = true;
    resolveReceipt(Object.freeze({ ...receipt }));
  }
  const onMessage = event => {
    if (event.origin === origin && event.source === tab.windowRef) accept(event.data);
  };
  const onChannelMessage = event => {
    if (!event.origin || event.origin === origin) accept(event.data);
  };
  windowObject.addEventListener('message', onMessage);
  if (channel) channel.onmessage = onChannelMessage;
  function cleanup() {
    if (disposed) return;
    disposed = true;
    windowObject.removeEventListener('message', onMessage);
    if (channel) { channel.onmessage = null; channel.close(); }
  }
  return {
    promise,
    acknowledge() {
      if (!settled || disposed || acknowledged) return false;
      acknowledged = true;
      const message = { type: ACKNOWLEDGEMENT, ...receipt };
      try { if (channel) channel.postMessage(message); } catch {}
      post(tab.windowRef, message, origin);
      // The child also closes itself after the ACK, covering severed references.
      try { tab.close(); } catch {}
      try { windowObject.focus(); } catch {}
      cleanup();
      return true;
    },
    dispose() {
      cleanup();
      if (!settled) {
        settled = true;
        rejectReceipt(new Error('The save receipt listener was cancelled.'));
      }
    }
  };
}

/** Notify only; no payload deletion, questionnaire navigation, or upload retry. */
export function notifyQualtricsOpener({ sessionId, nonce }, env = {}) {
  const windowObject = browserWindow(env);
  const receipt = credentials(sessionId, nonce);
  const origin = windowObject.location.origin;
  const schedule = value(env, 'setTimeout');
  const cancel = value(env, 'clearTimeout');
  const channel = openChannel(receipt, env);
  let opener;
  try { opener = windowObject.opener; } catch { opener = null; }
  return new Promise(resolve => {
    let settled = false, retryTimer, deadlineTimer;
    function finish(confirmed) {
      if (settled) return;
      settled = true;
      cancel(retryTimer); cancel(deadlineTimer);
      windowObject.removeEventListener('message', onMessage);
      if (channel) { channel.onmessage = null; channel.close(); }
      if (confirmed) { try { windowObject.close(); } catch {} }
      resolve(confirmed);
    }
    function accept(data) {
      if (matches(data, ACKNOWLEDGEMENT, receipt)) finish(true);
    }
    const onMessage = event => {
      if (opener && event.origin === origin && event.source === opener) accept(event.data);
    };
    windowObject.addEventListener('message', onMessage);
    if (channel) channel.onmessage = event => { if (!event.origin || event.origin === origin) accept(event.data); };
    function notify() {
      if (settled) return;
      const message = { type: RECEIPT, ...receipt };
      try { if (channel) channel.postMessage(message); } catch {}
      post(opener, message, origin);
      if (!settled) retryTimer = schedule(notify, 250);
    }
    deadlineTimer = schedule(() => finish(false), 2000);
    notify();
  });
}
