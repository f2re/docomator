import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const source = await fs.readFile(new URL("../../apps/api/ui/template-trial.js", import.meta.url), "utf8");
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function harness(api) {
  const nodes = new Map();
  const node = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, {
      innerHTML: "", value: "", className: "", disabled: false, isConnected: true,
      focus() {}, remove() {}, addEventListener() {},
      insertAdjacentHTML(_position, html) { this.innerHTML += html; },
      querySelector: node
    });
    return nodes.get(selector);
  };
  let revision = 0;
  const context = vm.createContext({
    document: { querySelector: node, querySelectorAll: () => [] },
    docomatorCaptureSpaceContext: () => {
      const captured = revision;
      return { spaceId: "A", isCurrent: () => captured === revision };
    },
    docomatorTemplateWizard: { spaceId: () => "A", complete() {} },
    testApi: api
  });
  new vm.Script(source.slice(0, source.indexOf("\nif (trialView) {"))).runInContext(context);
  vm.runInContext(`
    trialFetchJson = testApi;
    createTrialPanel = () => {};
    trialDrafts = [{ id: "draft", title: "Шаблон", status: "draft", fields: [{ id: "field", valueType: "string" }] }];
    globalThis.renderCount = 0;
    renderTrialWorkspace = () => { globalThis.renderCount += 1; };
    renderTrialVersions = () => { globalThis.renderCount += 1; };
  `, context);
  node("#templateTrialDraft").value = "draft";
  node("#templateTrialField").value = "field";
  node("#templateTrialValue").value = "Пробное значение";
  return { context, node, changeSpace: () => { revision += 1; } };
}

test("late draft refresh cannot redraw a submitted trial or erase its error", async () => {
  const held = deferred();
  const { context, node } = harness(async (url, options) => {
    if (options?.method === "POST") throw { message: "Контрольная ошибка", operationId: "trial-error" };
    return held.promise;
  });
  const refresh = context.loadTrialDrafts();
  await context.submitTrialVersion({ preventDefault() {} });
  const error = node("#templateTrialResult").innerHTML;
  assert.match(error, /trial-error/u);
  held.resolve({ data: [] });
  await refresh;
  assert.equal(context.renderCount, 0, "an obsolete draft read must not rebuild the live form");
  assert.equal(node("#templateTrialResult").innerHTML, error);
  assert.equal(node("#templateTrialValue").value, "Пробное значение");
  assert.equal(node("#templateTrialSubmit").disabled, false);
});

test("trial history from an earlier space is never rendered in the new context", async () => {
  const held = deferred();
  const { context, changeSpace } = harness(() => held.promise);
  const history = context.loadTrialVersions();
  changeSpace();
  held.resolve({ data: [{ id: "version-from-A" }] });
  await history;
  assert.equal(context.renderCount, 0);
});
