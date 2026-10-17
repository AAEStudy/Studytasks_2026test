import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../js/pipe-save-status.js", import.meta.url), "utf8");
const endpoint = "https://pipe.jspsych.org/api/data/";
const plain = value => JSON.parse(JSON.stringify(value));

function runtime(fetchResponse) {
  const requests = [];
  class Pipe {
    static saveData() { throw new Error("The original transport must be replaced."); }
  }
  const context = vm.createContext({
    jsPsychPipe: Pipe,
    console,
    fetch: async (url, options) => {
      requests.push({ url, ...options });
      return await fetchResponse(url, options);
    }
  });
  vm.runInContext(source, context);
  return { requests, save: (...args) => Pipe.saveData(...args) };
}

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

test("201 stored, 202 queued and other2xx accepted preserve response fields and the exact upload payload", async () => {
  const text = 'subject\tnote\nSID4187372347\t"a\tb\nquoted"\n';
  for (const [status, body, expected] of [
    [201, { error: null, message: "Created", filename: "MRT.tsv" }, "stored"],
    [202, { error: null, code: "CONTENTION", message: "Queued", receipt: { id: "ack-1" } }, "queued"],
    [200, { error: null, message: "Accepted" }, "accepted"]
  ]) {
    const run = runtime(async () => response(status, body));
    const result = await run.save("experiment12", "MRT.tsv", text);
    assert.deepEqual(plain(result), { ...body, http_status: status, save_state: expected, error: null });
    assert.equal(run.requests.length, 1, "an accepted or queued upload must never be retried");
    assert.equal(run.requests[0].url, endpoint);
    assert.equal(run.requests[0].method, "POST");
    assert.deepEqual(plain(run.requests[0].headers), { "Content-Type": "application/json", Accept: "*/*" });
    assert.equal(run.requests[0].body, JSON.stringify({ experimentID: "experiment12", filename: "MRT.tsv", data: text }));
  }
});

test("HTTP failures cannot appear successful even without an explicit body error", async () => {
  for (const [status, body, expected] of [
    [400, { error: "Rejected", code: "INVALID" }, "rejected"],
    [409, { error: "Filename exists", code: "DUPLICATE" }, "rejected"],
    [429, { error: null, message: "Rate limited" }, "rejected"],
    [500, { message: "Storage unavailable", code: "UPSTREAM" }, "unconfirmed"],
    [503, { error: { message: "Unavailable" }, code: "UPSTREAM" }, "unconfirmed"]
  ]) {
    const run = runtime(async () => response(status, body));
    const result = await run.save("experiment12", "MRT.tsv", "column\nvalue\n");
    assert.equal(result.http_status, status);
    assert.equal(result.save_state, expected);
    assert.equal(typeof result.error, "string");
    assert.ok(result.error.trim());
    assert.equal(result.code, body.code);
    assert.equal(result.message, body.message);
    assert.equal(run.requests.length, 1, "a rejected or uncertain request must never be retried");
  }
});

test("a truthy error on2xx remains unconfirmed and safe for the original plugin's error check", async () => {
  for (const error of ["Save failed", true, { message: "Save failed", code: "BROKEN" }]) {
    const run = runtime(async () => response(202, { error, code: "BROKEN", message: "Not confirmed" }));
    const result = await run.save("experiment12", "MRT.tsv", "column\nvalue\n");
    assert.equal(result.save_state, "unconfirmed");
    assert.equal(result.http_status, 202);
    assert.equal(typeof result.error, "string");
    assert.ok(result.error.trim());
    assert.equal(result.code, "BROKEN");
    assert.equal(result.message, "Not confirmed");
    assert.equal(run.requests.length, 1);
  }
});

test("network rejection and malformed JSON resolve to failure objects without retries", async () => {
  for (const [fetchResponse, status] of [
    [async () => { throw new TypeError("Failed to fetch"); }, null],
    [async () => ({ status: 201, json: async () => { throw new SyntaxError("Unexpected token"); } }), 201],
    [async () => ({ status: 502, json: async () => { throw new SyntaxError("Unexpected token"); } }), 502]
  ]) {
    const run = runtime(fetchResponse);
    const result = await run.save("experiment12", "MRT.tsv", "column\nvalue\n");
    assert.equal(result.http_status, status);
    assert.equal(result.save_state, "unconfirmed");
    assert.equal(typeof result.error, "string");
    assert.ok(result.error.trim());
    assert.equal(run.requests.length, 1);
    // This is the exact success test in plugin0.3's run(); it must finish as false.
    assert.equal(result.error ? false : true, false);
  }
});

test("missing required inputs return before any POST", async () => {
  const run = runtime(async () => assert.fail("missing inputs must not reach fetch"));
  for (const args of [[], [null, "MRT.tsv", "x"], ["experiment12", "", "x"], ["experiment12", "MRT.tsv", ""], ["experiment12", "MRT.tsv", undefined]]) {
    const result = await run.save(...args);
    assert.deepEqual(plain(result), { http_status: null, save_state: "unconfirmed", error: "Missing required parameter(s)." });
  }
  assert.equal(run.requests.length, 0);
});

test("valid JSON primitive, null and array bodies always become safe result objects", async () => {
  for (const body of [null, true, 7, "Accepted", ["Accepted"]]) {
    const run = runtime(async () => response(202, body));
    const result = await run.save("experiment12", "MRT.tsv", "column\nvalue\n");
    assert.deepEqual(plain(result), { response_body: body, http_status: 202, save_state: "queued", error: null });
    assert.equal(result.error ? false : true, true);
    assert.equal(run.requests.length, 1);
  }
});
