import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const surveyBase = "https://usf.az1.qualtrics.com/jfe/form/SV_8wijLZLkAmgskVE";
const defaultIDs = { subjectID: "SID6092410435", id: "", ResponseID: "R_original" };

function runtime({ href = surveyBase, ids = {}, nextThrows = false, nextMissing = false,
  oldRedirected = true, blockedStorage = false } = {}) {
  let now = 0, sequence = 0, hidden = 0, shown = 0, advanced = 0, storageAccesses = 0;
  const timers = new Map(), navigations = [], ready = [], unload = [], elements = new Map();
  const node = () => ({ textContent: "", hidden: true, style: { display: "none" },
    attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } });
  const status = node();
  elements.set("redirectMessage", status);
  const container = { appendChild(element) { elements.set(element.id, element); } };
  const document = { getElementById: id => elements.get(id) || null,
    createElement: () => node(), body: container };
  const window = { location: { href, replace: url => navigations.push({ url, at: now }) },
    setTimeout(callback, delay) { const id = ++sequence; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id) };
  Object.defineProperty(window, "localStorage", { get() {
    storageAccesses++;
    if (blockedStorage) throw new Error("storage blocked");
    return { getItem: key => key === "alreadyRedirected" ? String(oldRedirected) : null,
      setItem() { assert.fail("the handoff must not use a global storage flag"); } };
  } });
  const question = { getQuestionContainer: () => container,
    hideNextButton() { hidden++; }, showNextButton() { shown++; },
    clickNextButton() { advanced++; if (nextThrows) throw new Error("auto advance unavailable"); } };
  if (nextMissing) delete question.clickNextButton;
  const engine = { addOnReady: callback => ready.push(callback), addOnUnload: callback => unload.push(callback) };
  const context = vm.createContext({ Qualtrics: { SurveyEngine: engine }, window, document, URL, URLSearchParams });
  const values = { ...defaultIDs, ...ids };
  const source = read("qualtrics/launch-task.js").replace(/"\$\{e:\/\/Field\/(subjectID|id|ResponseID)\}"/g,
    (_, key) => JSON.stringify(values[key]));
  vm.runInContext(source, context);
  assert.equal(ready.length, 1);
  ready[0].call(question);
  return { context, status, navigations,
    counts: () => ({ hidden, shown, advanced, storageAccesses, timers: timers.size }),
    unload() { for (const callback of unload) callback.call(question); },
    advance(elapsed) {
      const until = now + elapsed;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= until) { now = timer.at; timers.delete(id); timer.callback(); }
      }
      now = until;
    }
  };
}

function appReturn(taskURL) {
  const context = vm.createContext({ URL, URLSearchParams, console,
    window: { location: { search: new URL(taskURL).search } } });
  const source = read("main.js").replace(/^import .*\n/m, "").split("function sessionStamp")[0];
  vm.runInContext(source + "\nglobalThis.returned = getQualtricsReturnUrl();", context);
  return context.returned;
}

test("the real task return preserves the original Qualtrics query and advances only its matching response", () => {
  const original = `${surveyBase}?Q_CHL=qr&space=a%20b&plus=a+b&encoded=%2b%2F&same=first&same=second`;
  for (const id of ["", "000071"]) {
    const launched = runtime({ href: original, ids: { id } });
    assert.equal(launched.counts().hidden, 1);
    assert.equal(launched.counts().advanced, 0);
    launched.advance(999);
    assert.equal(launched.navigations.length, 0);
    launched.advance(1);
    assert.equal(launched.navigations.length, 1);
    assert.equal(launched.navigations[0].at, 1000);
    const task = new URL(launched.navigations[0].url);
    assert.equal(task.origin + task.pathname, "https://aaestudy.github.io/Studytasks_2026test/");
    assert.equal(task.searchParams.get("subjectID"), defaultIDs.subjectID);
    assert.equal(task.searchParams.get("id"), id || null);
    assert.equal(task.searchParams.get("returnMode"), "resume");
    const intendedReturn = new URL(task.searchParams.get("return"));
    assert.equal(intendedReturn.search, new URL(original).search, "launch must not reserialize the cookie-sensitive original query");
    assert.equal(intendedReturn.searchParams.has("faeTaskComplete"), false);
    const marker = new URLSearchParams(intendedReturn.hash.slice(1));
    assert.equal(marker.get("faeTaskComplete"), "1");
    assert.equal(marker.get("faeResponseID"), defaultIDs.ResponseID);
    assert.equal(marker.get("subjectID"), defaultIDs.subjectID);
    const returnedURL = appReturn(task.href);
    assert.equal(returnedURL, intendedReturn.href, "the actual main.js builder must preserve the complete resume URL");
    const resumed = runtime({ href: returnedURL, ids: { id } });
    assert.equal(resumed.counts().advanced, 1);
    assert.equal(resumed.counts().shown, 1);
    assert.equal(resumed.counts().timers, 0);
    assert.match(resumed.status.textContent, /task is complete/i);
    resumed.advance(5000);
    assert.equal(resumed.navigations.length, 0, "a completed matching response cannot relaunch the task");
  }
});

test("the obsolete global alreadyRedirected flag and blocked storage cannot skip or prevent a fresh launch", () => {
  for (const blockedStorage of [false, true]) {
    const run = runtime({ oldRedirected: true, blockedStorage });
    assert.equal(run.counts().storageAccesses, 0);
    assert.equal(run.counts().advanced, 0);
    run.advance(1000);
    assert.equal(run.navigations.length, 1);
    assert.equal(run.counts().storageAccesses, 0);
  }
});

test("missing, unresolved or invalid machine IDs stop safely while an empty optional id is omitted", () => {
  for (const ids of [{ subjectID: "" }, { ResponseID: "" },
    { subjectID: "${e://Field/subjectID}" }, { ResponseID: "${e://Field/ResponseID}" },
    { subjectID: "SID bad" }, { ResponseID: "R_\ninvalid" }, { id: "bad id" }]) {
    const run = runtime({ ids });
    run.advance(10000);
    assert.equal(run.navigations.length, 0, JSON.stringify(ids));
    assert.equal(run.counts().advanced, 0);
    assert.equal(run.counts().shown, 0);
    assert.match(run.status.textContent, /could not verify.*participant information/i);
  }
  const optional = runtime({ ids: { id: "  " } });
  optional.advance(1000);
  assert.equal(new URL(optional.navigations[0].url).searchParams.has("id"), false);
});

test("mismatched, missing or duplicate completion markers never advance or relaunch", () => {
  for (const fragment of [
    "faeTaskComplete=1&faeResponseID=R_other&subjectID=SID6092410435",
    "faeTaskComplete=1&faeResponseID=R_original&subjectID=SID_other",
    "faeTaskComplete=1&subjectID=SID6092410435",
    "faeResponseID=R_original&subjectID=SID6092410435",
    "faeTaskComplete=0&faeResponseID=R_original&subjectID=SID6092410435",
    "faeTaskComplete=1&faeTaskComplete=1&faeResponseID=R_original&subjectID=SID6092410435",
    "faeTaskComplete=1&faeResponseID=R_original&faeResponseID=R_other&subjectID=SID6092410435",
    "faeTaskComplete=1&faeResponseID=R_original&subjectID=SID6092410435&subjectID=SID_other"
  ]) {
    const run = runtime({ href: `${surveyBase}#${fragment}` });
    run.advance(10000);
    assert.equal(run.counts().advanced, 0, fragment);
    assert.equal(run.counts().shown, 0);
    assert.equal(run.navigations.length, 0);
    assert.equal(run.counts().timers, 0);
    assert.match(run.status.textContent, /does not match this survey response/i);
  }
});

test("leaving the Qualtrics handoff page cancels the pending external launch", () => {
  const run = runtime();
  assert.equal(run.counts().timers, 1);
  run.advance(500);
  run.unload();
  assert.equal(run.counts().timers, 0);
  run.advance(10000);
  assert.equal(run.navigations.length, 0);
  assert.equal(run.counts().advanced, 0);
});

test("verified returns leave Next available when automatic advancement is missing or throws", () => {
  const href = `${surveyBase}#faeTaskComplete=1&faeResponseID=R_original&subjectID=SID6092410435`;
  for (const configuration of [{ nextMissing: true }, { nextThrows: true }]) {
    const run = runtime({ href, ...configuration });
    assert.equal(run.counts().shown, 1);
    assert.equal(run.status.hidden, false);
    assert.match(run.status.textContent, /select Next to continue/i);
    run.advance(10000);
    assert.equal(run.navigations.length, 0);
  }
});

test("an existing unrelated Qualtrics fragment is not overwritten or treated as task completion", () => {
  const run = runtime({ href: `${surveyBase}#existing-navigation-state` });
  run.advance(10000);
  assert.equal(run.navigations.length, 0);
  assert.equal(run.counts().advanced, 0);
  assert.match(run.status.textContent, /unsupported fragment/i);
});
