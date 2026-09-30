const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const settle = () => new Promise(setImmediate);

// Minimal DOM and Chrome doubles for panel interactions; not a browser lifecycle test.
function element(tag = "") {
  return {
    tag, children: [], listeners: {}, dataset: {}, attributes: {}, value: "", disabled: false,
    append(...children) { this.children.push(...children); },
    replaceChildren() { this.children = []; },
    querySelectorAll(selector) {
      return this.children.flatMap((child) => [
        ...(child.tag === selector ? [child] : []), ...child.querySelectorAll(selector),
      ]);
    },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, callback) { this.listeners[name] = callback; },
    fire(name) { return this.listeners[name]({ preventDefault() {} }); },
    focus() { this.focused = true; },
  };
}

async function openPanel({ editing = false, loadError = null, loadBarrier = null } = {}) {
  const html = fs.readFileSync(path.join(ROOT, "popup.html"), "utf8");
  const elements = Object.fromEntries([...html.matchAll(/<([a-z][\w-]*)\b[^>]*\bid="([^"]+)"[^>]*>/gi)]
    .map(([markup, tag, id]) => [id, Object.assign(element(tag), {
      disabled: /\sdisabled[\s>]/.test(markup), hidden: /\shidden[\s>]/.test(markup),
    })]));
  const panel = {
    elements, requests: [], reloads: 0, timers: [],
    saved: { hosts: ["docs.example.com"], history: [], status: { code: "ON", message: "Active" } },
  };
  const chrome = {
    runtime: {
      sendMessage: async (request) => {
        panel.requests.push(structuredClone(request));
        if (request.type === "getState") {
          if (loadBarrier) await loadBarrier;
          if (loadError) return { ok: false, error: loadError };
        } else if (request.type === "saveHosts") {
          if (panel.saveBarrier) await panel.saveBarrier;
          panel.saved.hosts = structuredClone(request.hosts);
        } else throw new Error(`Unexpected request: ${request.type}`);
        return { ok: true, ...structuredClone(panel.saved), editingEnabled: editing };
      },
      reload: () => {
        if (panel.reloadError) throw new Error(panel.reloadError);
        panel.reloads++;
      },
    },
    proxy: { settings: { onChange: { addListener() {} } } },
    storage: { onChanged: { addListener() {} } },
  };
  const context = vm.createContext({
    chrome, URL,
    document: { getElementById: (id) => elements[id], createElement: element },
    // Timers run only when a test calls them.
    setTimeout: (callback, delay) => panel.timers.push({ callback, delay }),
  });
  for (const file of ["rules.js", "popup.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context);
  }
  await settle();
  return panel;
}

test("a locked panel requires explicit reload confirmation without changing saved data", async () => {
  const panel = await openPanel();
  const before = structuredClone(panel.saved);
  assert.equal(panel.elements.reload.disabled, false);
  assert.equal(panel.elements.save.hidden, true);
  assert.equal(panel.elements["reload-confirmation"].hidden, true);
  panel.elements.reload.fire("click");
  assert.equal(panel.reloads, 0);
  assert.equal(panel.elements["reload-confirmation"].hidden, false);
  assert.equal(panel.elements["reload-unsaved"].hidden, true);
  assert.equal(panel.elements["reload-cancel"].focused, true);
  panel.elements["reload-confirm"].fire("click");
  assert.equal(panel.reloads, 1);
  assert.deepEqual(panel.requests.map((request) => request.type), ["getState"]);
  assert.deepEqual(panel.saved, before);
});

test("reload stays unavailable until panel authorization succeeds", async () => {
  let release;
  const panel = await openPanel({ loadBarrier: new Promise((resolve) => { release = resolve; }) });
  assert.equal(panel.elements.reload.disabled, true);
  panel.elements.reload.fire("click");
  panel.elements["reload-confirm"].fire("click");
  assert.equal(panel.reloads, 0);
  release();
  await settle();
  assert.equal(panel.elements.reload.disabled, false);
});

test("a rejected editor cannot trigger reload", async () => {
  const panel = await openPanel({ loadError: "Only the extension side panel can access the editor." });
  assert.equal(panel.elements.reload.disabled, true);
  panel.elements.reload.fire("click");
  panel.elements["reload-confirm"].fire("click");
  assert.equal(panel.reloads, 0);
});

test("cancelling reload preserves both draft edits and unfinished input", async () => {
  for (const addToDraft of [false, true]) {
    const panel = await openPanel({ editing: true });
    panel.elements.domain.value = "new.example.com";
    if (addToDraft) panel.elements["add-form"].fire("submit");
    const before = [...panel.elements.hosts.children.map((item) => item.children[0].textContent)];
    panel.elements.reload.fire("click");
    assert.equal(panel.reloads, 0);
    assert.equal(panel.elements["reload-unsaved"].hidden, false);
    assert.equal(panel.elements.domain.disabled, true);
    assert.equal(panel.elements.save.disabled, true);
    panel.elements["reload-cancel"].fire("click");
    assert.equal(panel.elements["reload-confirmation"].hidden, true);
    assert.equal(panel.elements.domain.disabled, false);
    assert.equal(panel.elements.reload.focused, true);
    panel.elements["reload-confirm"].fire("click");
    assert.equal(panel.reloads, 0);
    assert.deepEqual(panel.elements.hosts.children.map((item) => item.children[0].textContent), before);
    if (!addToDraft) assert.equal(panel.elements.domain.value, "new.example.com");
    panel.elements.reload.fire("click");
    panel.elements["reload-confirm"].fire("click");
    assert.equal(panel.reloads, 1);
    assert.deepEqual(panel.saved.hosts, ["docs.example.com"]);
    assert.equal(panel.requests.some((request) => request.type === "saveHosts"), false);
  }
});

test("reload cannot interrupt a save in the same panel", async () => {
  const panel = await openPanel({ editing: true });
  panel.elements.domain.value = "new.example.com";
  panel.elements["add-form"].fire("submit");
  let release;
  panel.saveBarrier = new Promise((resolve) => { release = resolve; });
  const saving = panel.elements.save.fire("click");
  assert.equal(panel.elements.reload.disabled, true);
  panel.elements.reload.fire("click");
  panel.elements["reload-confirm"].fire("click");
  assert.equal(panel.reloads, 0);
  release();
  await saving;
  assert.deepEqual(panel.saved.hosts, ["docs.example.com", "new.example.com"]);
  assert.equal(panel.elements.reload.disabled, false);
  panel.elements.reload.fire("click");
  assert.equal(panel.reloads, 0);
  panel.elements["reload-confirm"].fire("click");
  assert.equal(panel.reloads, 1);
});

test("a reload failure reports the fallback and restores controls", async () => {
  const panel = await openPanel();
  panel.reloadError = "Extension context invalidated";
  panel.elements.reload.fire("click");
  panel.elements["reload-confirm"].fire("click");
  assert.equal(panel.reloads, 0);
  assert.equal(panel.timers.length, 0);
  assert.equal(panel.elements.reload.disabled, false);
  assert.match(panel.elements.message.textContent, /Manage Extensions/);
  assert.equal(panel.elements.message.dataset.error, "true");
});

test("a reload that leaves the panel open restores controls after a delay", async () => {
  const panel = await openPanel({ editing: true });
  panel.elements.reload.fire("click");
  panel.elements["reload-confirm"].fire("click");
  assert.equal(panel.reloads, 1);
  assert.equal(panel.elements.reload.disabled, true);
  assert.equal(panel.elements.domain.disabled, true);
  assert.equal(panel.timers.length, 1);
  panel.timers[0].callback();
  assert.equal(panel.elements.reload.disabled, false);
  assert.equal(panel.elements.domain.disabled, false);
  assert.equal(panel.elements["reload-confirmation"].hidden, true);
  assert.equal(panel.elements.reload.focused, true);
  assert.match(panel.elements.message.textContent, /did not reload.*Manage Extensions/);
  assert.equal(panel.elements.message.dataset.error, "true");
});
