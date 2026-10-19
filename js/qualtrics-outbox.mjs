// Browser backup for the final Qualtrics handoff. A receipt is issued by the
// survey's End of Survey redirect, after the response has been submitted.
const DATABASE = "FAEQualtricsOutbox";
const STORE = "sessions";
const RECEIPT_PREFIX = "FAE:qualtrics-receipt:";

function environmentValue(env, name) {
  try { return Object.prototype.hasOwnProperty.call(env, name) ? env[name] : globalThis[name]; }
  catch { return undefined; }
}

function identifier(value, label) {
  if (typeof value !== "string" || !value || value.length > 256 || /[\r\n\0]/.test(value)) {
    throw new TypeError(`Invalid ${label}.`);
  }
  return value;
}

function validateReturnUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".qualtrics.com") || url.username || url.password) {
    throw new TypeError("The return destination must be an HTTPS Qualtrics URL.");
  }
  return url.href;
}

function validateReceiptBase(value, env) {
  const url = new URL(value);
  const location = environmentValue(env, "location");
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      (location && location.origin && url.origin !== location.origin)) {
    throw new TypeError("The receipt page must be an HTTPS page on the task's origin.");
  }
  return url;
}

function copyFields(fields) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new TypeError("Missing task data.");
  const copy = {};
  for (const [name, value] of Object.entries(fields)) {
    if (typeof value !== "string") throw new TypeError("Task data fields must be strings.");
    copy[name] = value;
  }
  identifier(copy.fae_session_id, "session ID");
  identifier(copy.fae_subject_id, "subject ID");
  return copy;
}

function nonceFor(env) {
  const crypto = environmentValue(env, "crypto");
  if (!crypto || typeof crypto.getRandomValues !== "function") return null;
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), value => value.toString(16).padStart(2, "0")).join("");
}

function openDatabase(env) {
  return new Promise((resolve, reject) => {
    const indexedDB = environmentValue(env, "indexedDB");
    if (!indexedDB || typeof indexedDB.open !== "function") return reject(new Error("Browser backup is unavailable."));
    let settled = false;
    const timer = setTimeout(() => finish(new Error("Browser backup did not open.")), 2000);
    function finish(error, database) {
      if (settled) { if (database) database.close(); return; }
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(database);
    }
    let request;
    try { request = indexedDB.open(DATABASE, 1); }
    catch (error) { finish(error); return; }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE, { keyPath: "sessionId" });
    };
    request.onsuccess = () => finish(null, request.result);
    request.onerror = () => finish(request.error || new Error("Browser backup did not open."));
    request.onblocked = () => finish(new Error("Browser backup is blocked."));
  });
}

async function transaction(env, mode, operation) {
  const database = await openDatabase(env);
  return new Promise((resolve, reject) => {
    let result;
    let tx;
    try {
      tx = database.transaction(STORE, mode);
      tx.oncomplete = () => { database.close(); resolve(result); };
      tx.onerror = tx.onabort = () => { database.close(); reject(tx.error || new Error("Browser backup was not committed.")); };
      operation(tx.objectStore(STORE), value => { result = value; });
    } catch (error) { database.close(); reject(error); }
  });
}

function receiptKey(sessionId) { return RECEIPT_PREFIX + sessionId; }

function storeReceiptMetadata(record, env) {
  try {
    const storage = environmentValue(env, "sessionStorage");
    if (!storage) return false;
    const value = JSON.stringify({ sessionId: record.sessionId, nonce: record.nonce, returnUrl: record.returnUrl });
    storage.setItem(receiptKey(record.sessionId), value);
    return storage.getItem(receiptKey(record.sessionId)) === value;
  } catch { return false; }
}

/** Commit the payload before leaving the task. Storage failure never claims a backup. */
export async function stageQualtricsSession({ fields, returnUrl, receiptBase }, env = {}) {
  const original = copyFields(fields);
  const destination = validateReturnUrl(returnUrl);
  const receipt = validateReceiptBase(receiptBase, env);
  const nonce = nonceFor(env);
  if (!nonce) return { fields: { ...original, fae_return_url: destination }, backupRetained: false, returnMode: "direct" };
  receipt.searchParams.set("session", original.fae_session_id);
  receipt.searchParams.set("nonce", nonce);
  const stagedFields = Object.freeze({ ...original, fae_return_url: receipt.href });
  const now = environmentValue(env, "now");
  const record = {
    sessionId: original.fae_session_id,
    subjectId: original.fae_subject_id,
    fields: stagedFields,
    returnUrl: destination,
    nonce,
    createdAt: typeof now === "function" ? now() : Date.now(),
    backupRetained: true
  };
  try {
    // Resolve only on transaction completion, not the earlier put-success event.
    await transaction(env, "readwrite", store => { store.put(record); });
    return { fields: stagedFields, backupRetained: true, returnMode: "receipt" };
  } catch {
    if (storeReceiptMetadata(record, env)) {
      return { fields: stagedFields, backupRetained: false, returnMode: "receipt" };
    }
    return { fields: { ...original, fae_return_url: destination }, backupRetained: false, returnMode: "direct" };
  }
}

/** Return only records that actually retain the payload, filtered by participant. */
export async function listPendingQualtricsSessions(subjectId, env = {}) {
  identifier(subjectId, "subject ID");
  try {
    const records = await transaction(env, "readonly", (store, result) => {
      const request = store.getAll();
      request.onsuccess = () => result(request.result);
    });
    return records.filter(record => record.subjectId === subjectId && record.backupRetained && record.fields)
      .sort((a, b) => a.createdAt - b.createdAt);
  } catch { return []; }
}

/** A receipt can clear only its own staged session, after its nonce matches. */
export async function completeQualtricsReturn({ sessionId, nonce }, env = {}) {
  identifier(sessionId, "session ID");
  if (typeof nonce !== "string" || !/^[a-f0-9]{48}$/.test(nonce)) throw new Error("This save receipt is invalid.");
  let destination;
  try {
    destination = await transaction(env, "readwrite", (store, result) => {
      const request = store.get(sessionId);
      request.onsuccess = () => {
        const record = request.result;
        if (!record || record.nonce !== nonce) return;
        let returnUrl;
        try { returnUrl = validateReturnUrl(record.returnUrl); }
        catch { return; }
        store.delete(sessionId);
        result(returnUrl);
      };
    });
  } catch { /* A metadata receipt can still return when browser backup is blocked. */ }
  const storage = environmentValue(env, "sessionStorage");
  try {
    const metadata = storage && JSON.parse(storage.getItem(receiptKey(sessionId)) || "null");
    if (metadata && metadata.sessionId === sessionId && metadata.nonce === nonce) {
      const metadataUrl = validateReturnUrl(metadata.returnUrl);
      if (!destination) destination = metadataUrl;
      storage.removeItem(receiptKey(sessionId));
    }
  } catch { /* Do not trust malformed metadata or turn an unmatched receipt into success. */ }
  if (!destination) throw new Error("No matching save receipt was found in this browser. Keep this window open and contact the researcher.");
  return destination;
}
