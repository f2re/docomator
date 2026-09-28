import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// Exercise the production synchronizer, not a copied implementation. Browser
// coverage separately verifies real MutationObserver delivery and interaction.
test("status synchronization does not write its observed state again", async () => {
  const source = await fs.readFile(new URL("../ui/interface-hierarchy.js", import.meta.url), "utf8");
  const start = source.indexOf("  function interfaceSyncStatus() {");
  const end = source.indexOf("  function interfaceSetStepState", start);
  assert.ok(start >= 0 && end > start);
  let stateWrites = 0;
  const dataset = new Proxy<Record<string, string>>({}, {
    set(target, key, value: string) {
      stateWrites += 1;
      target[String(key)] = value;
      return true;
    }
  });
  const classes = new Set<string>();
  const ribbon = { dataset, classList: {
    toggle(name: string, enabled: boolean) {
      if (enabled) classes.add(name); else classes.delete(name);
    }
  } };
  const control = { dataset: {}, title: "", setAttribute() {} };
  const label = { textContent: "" };
  const title = { textContent: "Данные актуальны" };
  const detail = { textContent: "Локальные данные загружены." };
  const nodes: Record<string, unknown> = {
    "#statusRibbon": ribbon, "#systemStatusControl": control,
    "#systemStatusLabel": label, "#statusRibbonTitle": title,
    "#statusRibbonDetail": detail
  };
  let kind = "success";
  const context = vm.createContext({
    interfaceQuery: (selector: string) => nodes[selector] || null,
    interfaceStatusKind: () => kind,
    interfaceStatusExpanded: false,
    interfaceStatusSignature: ""
  });
  const synchronize = new vm.Script(`${source.slice(start, end)}\ninterfaceSyncStatus();`);
  synchronize.runInContext(context, { timeout: 100 });
  assert.equal(label.textContent, "Система готова");
  assert.equal(stateWrites, 1);
  synchronize.runInContext(context, { timeout: 100 });
  assert.equal(stateWrites, 1, "unchanged state must not enqueue another mutation");
  kind = "error";
  title.textContent = "Не удалось обновить данные";
  synchronize.runInContext(context, { timeout: 100 });
  assert.equal(stateWrites, 2);
  assert.equal(label.textContent, title.textContent);
  synchronize.runInContext(context, { timeout: 100 });
  assert.equal(stateWrites, 2);
});

test("optional access status failure cannot reject UI startup", async () => {
  const source = await fs.readFile(new URL("../ui/access-session.js", import.meta.url), "utf8");
  const callbacks: Array<() => Promise<void>> = [];
  const context = vm.createContext({
    URL, Request, AbortController, DOMException, Error,
    location: { pathname: "/", search: "", hash: "", origin: "http://127.0.0.1:18080" },
    fetch: async () => { throw new Error("connection refused"); },
    setTimeout: () => 1,
    clearTimeout: () => undefined,
    document: {
      readyState: "loading",
      addEventListener(_name: string, callback: () => Promise<void>) { callbacks.push(callback); }
    }
  });
  // Replace only the event's fire-and-forget syntax to observe its Promise.
  const observable = source.replace("() => void enhanceAccessUi()", "() => enhanceAccessUi()");
  new vm.Script(observable).runInContext(context, { timeout: 100 });
  assert.equal(callbacks.length, 1);
  await assert.doesNotReject(callbacks[0]!);
});
