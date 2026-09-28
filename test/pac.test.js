const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const BLOCKED = "PROXY 127.0.0.1:9";
const WEEK = 7 * 24 * 60 * 60 * 1000;
const EDITOR_URL = "chrome-extension://test-extension/popup.html";

// Chrome's APIs are stubbed. These tests do not exercise its network stack or side-panel UI.
function loadExtension({ editing = false, stored = {} } = {}) {
  const state = {
    settings: { levelOfControl: "controllable_by_this_extension", value: { mode: "system" } },
    store: structuredClone(stored),
    listeners: {},
    badge: {},
    errors: [],
    setCalls: 0,
    storageWrites: 0,
    getDetails: [],
    contexts: [
      { documentId: "popup-document", documentUrl: EDITOR_URL, contextType: "POPUP", windowId: 1 },
      { documentId: "panel-document", documentUrl: EDITOR_URL, contextType: "SIDE_PANEL", windowId: 1 },
      { documentId: "tab-document", documentUrl: EDITOR_URL, contextType: "TAB", windowId: 1 },
      { documentId: "other-document", documentUrl: "chrome-extension://test-extension/other.html", contextType: "SIDE_PANEL", windowId: 1 },
    ],
    now: 1800000000000,
  };
  const chrome = {
    proxy: {
      settings: {
        set: async (options) => {
          state.setCalls++;
          if (state.setError) throw new Error(state.setError);
          state.config = structuredClone(options);
          if (!["not_controllable", "controlled_by_other_extensions"].includes(state.settings.levelOfControl)) {
            state.settings = {
              levelOfControl: "controlled_by_this_extension",
              value: structuredClone(options.value),
            };
          }
        },
        get: async (details) => {
          state.getDetails.push(details);
          if (state.getError) throw new Error(state.getError);
          return structuredClone(state.settings);
        },
        onChange: { addListener: (fn) => { state.listeners.change = fn; } },
      },
    },
    storage: {
      local: {
        setAccessLevel: async ({ accessLevel }) => { state.accessLevel = accessLevel; },
        get: async (defaults) => {
          if (state.storeGetError) throw new Error(state.storeGetError);
          return { ...structuredClone(defaults), ...structuredClone(state.store) };
        },
        set: async (values) => {
          if (state.storeSetError) throw new Error(state.storeSetError);
          state.storageWrites++;
          Object.assign(state.store, structuredClone(values));
        },
      },
      onChanged: { addListener: (fn) => { state.listeners.storage = fn; } },
    },
    action: {
      setBadgeText: ({ text }) => { state.badge.text = text; },
      setBadgeBackgroundColor: ({ color }) => { state.badge.color = color; },
      setTitle: ({ title }) => { state.badge.title = title; },
    },
    sidePanel: {
      setPanelBehavior: async (options) => { state.panelBehavior = structuredClone(options); },
    },
    runtime: {
      id: "test-extension",
      getURL: (file) => `chrome-extension://test-extension/${file}`,
      getContexts: async (filter) => {
        if (state.contextError) throw new Error(state.contextError);
        return structuredClone(state.contexts.filter((context) =>
          (!filter.documentIds || filter.documentIds.includes(context.documentId)) &&
          filter.documentUrls.includes(context.documentUrl) &&
          filter.contextTypes.includes(context.contextType)));
      },
      onInstalled: { addListener: (fn) => { state.listeners.install = fn; } },
      onStartup: { addListener: (fn) => { state.listeners.startup = fn; } },
      onMessage: { addListener: (fn) => { state.listeners.message = fn; } },
    },
  };
  const context = vm.createContext({
    chrome,
    Date: class extends Date { static now() { return state.now; } },
    console: { log() {}, error: (message) => { state.errors.push(message); } },
    importScripts: (file) => vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context),
  });
  const source = fs.readFileSync(path.join(ROOT, "background.js"), "utf8")
    .replace(/const ENABLE_UI_EDITING = (?:false|true);/, `const ENABLE_UI_EDITING = ${editing};`);
  vm.runInContext(source, context);
  state.ready = vm.runInContext("pending", context);
  // Chrome does not supply documentId or tab for a side-panel sender.
  state.request = (message, sender = { id: chrome.runtime.id, url: EDITOR_URL }) =>
    new Promise((resolve) => state.listeners.message(message, sender, (response) => resolve(structuredClone(response))));
  return state;
}

async function installed(options) {
  const state = loadExtension(options);
  await state.listeners.install();
  return state;
}

function route(state, host) {
  const dnsDomainIs = (value, suffix) => value.endsWith(suffix);
  const findProxy = new Function("dnsDomainIs", `${state.config.value.pacScript.data}; return FindProxyForURL;`)(dnsDomainIs);
  return findProxy(`https://${host}/`, host);
}

test("sets a mandatory PAC script at regular scope", async () => {
  const state = await installed();
  assert.equal(state.config.scope, "regular");
  assert.equal(state.config.value.mode, "pac_script");
  assert.equal(state.config.value.pacScript.mandatory, true);
});

test("allows listed hosts and their subdomains", async () => {
  const state = await installed();
  for (const host of ["claude.ai", "api.anthropic.com", "bridge.claudeusercontent.com", "chatgpt.com", "cdn.oaistatic.com", "api.oaistatsig.com", "CHATGPT.COM"]) {
    assert.equal(route(state, host), "DIRECT", host);
  }
});

test("PAC blocks unlisted and lookalike hosts", async () => {
  const state = await installed();
  for (const host of ["example.com", "cloudflare.com", "login.microsoftonline.com", "accounts.google.com", "10.0.0.5", "evilclaude.ai", "claude.ai.evil.com", "notchatgpt.com", "statsig.com", "api.statsig.com", "statsigapi.net", "events.statsigapi.net", "featuregates.org"]) {
    assert.equal(route(state, host), BLOCKED, host);
  }
});

test("only reports ON after the expected configuration is active", async () => {
  const state = loadExtension();
  await state.ready;
  assert.equal(state.badge.text, "OFF");
  assert.equal(state.setCalls, 0);
  await state.listeners.install();
  assert.equal(state.badge.text, "ON");
  assert.match(state.badge.title, /regular windows/);
});

test("startup applies the saved list instead of the source defaults", async () => {
  const state = loadExtension({ stored: { hosts: ["docs.example.com"] } });
  await state.listeners.startup();
  assert.equal(route(state, "docs.example.com"), "DIRECT");
  assert.equal(route(state, "claude.ai"), BLOCKED);
  assert.equal(state.badge.text, "ON");
});

test("warns when another extension or policy prevents proxy control", async () => {
  for (const levelOfControl of ["controlled_by_other_extensions", "not_controllable"]) {
    const state = loadExtension();
    state.settings.levelOfControl = levelOfControl;
    await state.listeners.install();
    assert.equal(state.badge.text, "OFF", levelOfControl);
  }
});

test("updates status when control is lost and restored without resetting settings", async () => {
  const state = await installed();
  const active = state.settings;
  state.settings = { levelOfControl: "controlled_by_other_extensions", value: { mode: "direct" } };
  await state.listeners.change();
  assert.equal(state.badge.text, "OFF");
  state.settings = active;
  await state.listeners.change();
  assert.equal(state.badge.text, "ON");
  assert.equal(state.setCalls, 1);
});

test("flags a saved list written outside the editor", async () => {
  const state = await installed({ editing: true });
  const before = await state.request({ type: "getState" });
  const saved = await state.request({ type: "saveHosts", baseHosts: before.hosts, hosts: ["docs.example.com"] });
  await state.listeners.storage({ hosts: { newValue: saved.hosts } }, "local");
  assert.equal(state.badge.text, "ON");
  await state.listeners.storage({ history: { newValue: [] } }, "local");
  state.store.hosts = ["example.com"];
  await state.listeners.storage({ hosts: { newValue: ["example.com"] } }, "local");
  assert.equal(state.badge.text, "ERR");
  assert.equal(route(state, "example.com"), BLOCKED);
  assert.equal(state.setCalls, 2);
});

test("reports proxy write and read failures", async () => {
  const state = await installed();
  state.setError = "Proxy setting failed";
  await state.listeners.startup();
  assert.equal(state.badge.text, "ERR");
  assert.match(state.badge.title, /Proxy setting failed/);
  state.getError = "Proxy status unavailable";
  await state.listeners.change();
  assert.equal(state.badge.text, "ERR");
  assert.match(state.badge.title, /Proxy status unavailable/);
});

test("does not report ON for an unexpected mode, mandatory flag, or script", async () => {
  const state = await installed();
  for (const value of [
    { mode: "direct" },
    { mode: "pac_script", pacScript: { ...state.config.value.pacScript, mandatory: false } },
    { mode: "pac_script", pacScript: { data: 'function FindProxyForURL() { return "DIRECT"; }', mandatory: true } },
  ]) {
    state.settings.value = value;
    await state.listeners.change();
    assert.equal(state.badge.text, "ERR", JSON.stringify(value));
  }
});

test("an Incognito event still checks regular-window status", async () => {
  const state = await installed();
  await state.listeners.change({ incognitoSpecific: true, levelOfControl: "controlled_by_other_extensions" });
  assert.equal(state.badge.text, "ON");
  assert.equal(state.getDetails.at(-1).incognito, false);
});

test("the committed configuration keeps editing locked", () => {
  const source = fs.readFileSync(path.join(ROOT, "background.js"), "utf8");
  assert.match(source, /^const ENABLE_UI_EDITING = false;$/m,
    "Set ENABLE_UI_EDITING back to false before committing.");
});

test("the background rejects saves while editing is locked", async () => {
  const state = await installed();
  for (const documentId of [undefined, "panel-document"]) {
    const sender = { id: "test-extension", url: EDITOR_URL, documentId };
    const before = await state.request({ type: "getState" }, sender);
    assert.equal(before.editingEnabled, false);
    const response = await state.request({ type: "saveHosts", baseHosts: before.hosts, hosts: ["example.com"] }, sender);
    assert.equal(response.ok, false);
    assert.match(response.error, /locked/);
  }
  assert.equal(state.storageWrites, 0);
  assert.equal(state.setCalls, 1);
});

test("rejects tabs and other callers even when a side panel is open", async () => {
  const state = await installed({ editing: true });
  for (const sender of [
    { id: "another-extension", url: EDITOR_URL },
    { id: "test-extension", url: "https://example.com" },
    { id: "test-extension", url: EDITOR_URL, tab: { id: 1 } },
    { id: "test-extension", url: EDITOR_URL, documentId: "panel-document", tab: { id: 1 } },
    { id: "test-extension", url: EDITOR_URL, documentId: "popup-document" },
    { id: "test-extension", url: EDITOR_URL, documentId: "missing-document" },
    { id: "test-extension", url: EDITOR_URL, documentId: "tab-document", tab: { id: 1 } },
    { id: "test-extension", url: EDITOR_URL, documentId: "tab-document" },
    { id: "test-extension", url: EDITOR_URL, documentId: "other-document" },
  ]) {
    for (const type of ["getState", "saveHosts"]) {
      const response = await state.request({ type, hosts: [] }, sender);
      assert.equal(response.ok, false);
      assert.match(response.error, /Only the extension side panel/);
    }
  }
  assert.equal(state.storageWrites, 0);
  assert.equal(state.accessLevel, "TRUSTED_CONTEXTS");
});

test("the side panel loads and saves without a sender documentId", async () => {
  const state = await installed({ editing: true, stored: { hosts: [] } });
  const before = await state.request({ type: "getState" });
  assert.equal(before.ok, true);
  const saved = await state.request({ type: "saveHosts", baseHosts: before.hosts, hosts: ["docs.example.com"] });
  assert.equal(saved.ok, true);
  assert.equal(saved.status.code, "ON");
  assert.equal(route(state, "docs.example.com"), "DIRECT");
  const reopened = await state.request({ type: "getState" });
  assert.deepEqual(reopened.hosts, saved.hosts);
  assert.deepEqual(reopened.history, [{ timestamp: state.now, domain: "docs.example.com", action: "added" }]);
});

test("a missing side-panel context rejects reads and saves", async () => {
  const state = await installed({ editing: true, stored: { hosts: [] } });
  // Keep a same-URL tab and popup open: neither should authorize a request.
  state.contexts = state.contexts.filter((context) => context.documentId !== "panel-document");
  for (const type of ["getState", "saveHosts"]) {
    const response = await state.request({ type, baseHosts: [], hosts: ["example.com"] });
    assert.equal(response.ok, false);
    assert.match(response.error, /Only the extension side panel/);
  }
  assert.equal(state.storageWrites, 0);
  assert.equal(state.setCalls, 1);
});

test("a failed Chrome context lookup rejects reads and saves", async () => {
  const state = await installed({ editing: true, stored: { hosts: [] } });
  state.contextError = "Context lookup unavailable";
  for (const type of ["getState", "saveHosts"]) {
    const response = await state.request({ type, baseHosts: [], hosts: ["example.com"] });
    assert.equal(response.ok, false);
    assert.match(response.error, /Context lookup unavailable/);
  }
  assert.equal(state.storageWrites, 0);
  assert.equal(state.setCalls, 1);
});

test("saves canonical domains and records only actual additions and removals", async () => {
  const state = await installed({ editing: true });
  const before = await state.request({ type: "getState" });
  const hosts = [...before.hosts.filter((host) => host !== "claude.com"), " DOCS.EXAMPLE.COM ", "docs.example.com"];
  const response = await state.request({ type: "saveHosts", baseHosts: before.hosts, hosts });
  assert.equal(response.ok, true);
  assert.equal(response.status.code, "ON");
  assert.equal(response.hosts.filter((host) => host === "docs.example.com").length, 1);
  assert.deepEqual(response.history, [
    { timestamp: state.now, domain: "docs.example.com", action: "added" },
    { timestamp: state.now, domain: "claude.com", action: "removed" },
  ]);
  assert.deepEqual(state.store.hosts, response.hosts);
  assert.equal(route(state, "docs.example.com"), "DIRECT");
  assert.equal(route(state, "claude.com"), BLOCKED);
  const unchanged = await state.request({ type: "saveHosts", baseHosts: response.hosts, hosts: response.hosts });
  assert.deepEqual(unchanged.history, response.history);
});

test("rejects malformed domains before modifying the stored list or proxy", async () => {
  const state = await installed({ editing: true });
  const before = await state.request({ type: "getState" });
  for (const domain of ["https://example.com", "example.com/path", "example.com:443", "*.example.com", "com", "10.0.0.5", "[::1]", "x..example.com", "-x.example.com", "<img src=x>"]) {
    const response = await state.request({ type: "saveHosts", baseHosts: before.hosts, hosts: [domain] });
    assert.equal(response.ok, false, domain);
  }
  assert.equal(state.storageWrites, 0);
  assert.equal(state.setCalls, 1);
});

test("opening the side panel prunes history older than seven days without expiring domains", async () => {
  const state = loadExtension({ stored: { hosts: ["example.com"] } });
  state.store.history = [
    { timestamp: state.now - WEEK - 1, domain: "old.example.com", action: "removed" },
    { timestamp: state.now - WEEK, domain: "example.com", action: "added" },
    { timestamp: state.now - 1, domain: "recent.example.com", action: "removed" },
  ];
  await state.listeners.install();
  assert.equal(state.store.history.length, 3);
  const response = await state.request({ type: "getState" });
  assert.equal(response.history.length, 2);
  assert.deepEqual(state.store.history, response.history);
  assert.deepEqual(state.store.hosts, ["example.com"]);
  assert.equal(route(state, "example.com"), "DIRECT");
});

test("saving prunes expired history and keeps the new change", async () => {
  const state = await installed({ editing: true, stored: { hosts: ["example.com"] } });
  state.store.history = [{ timestamp: state.now - WEEK - 1, domain: "old.example.com", action: "removed" }];
  const response = await state.request({ type: "saveHosts", baseHosts: ["example.com"], hosts: ["example.com", "docs.example.com"] });
  assert.deepEqual(response.history, [{ timestamp: state.now, domain: "docs.example.com", action: "added" }]);
});

test("saved lists survive reload with editing locked again", async () => {
  const state = await installed({ editing: true });
  const before = await state.request({ type: "getState" });
  await state.request({ type: "saveHosts", baseHosts: before.hosts, hosts: ["docs.example.com"] });
  const reloaded = await installed({ stored: state.store });
  const response = await reloaded.request({ type: "getState" });
  assert.equal(response.editingEnabled, false);
  assert.deepEqual(response.hosts, ["docs.example.com"]);
  assert.equal(route(reloaded, "claude.ai"), BLOCKED);
  assert.equal(route(reloaded, "docs.example.com"), "DIRECT");
});

test("an empty saved list stays empty after reload", async () => {
  const state = await installed({ stored: { hosts: [] } });
  assert.equal(route(state, "claude.ai"), BLOCKED);
  assert.deepEqual((await state.request({ type: "getState" })).hosts, []);
});

test("a storage failure leaves the previous proxy and history unchanged", async () => {
  const state = await installed({ editing: true });
  const before = await state.request({ type: "getState" });
  state.storeSetError = "Storage full";
  const response = await state.request({ type: "saveHosts", baseHosts: before.hosts, hosts: ["example.com"] });
  assert.equal(response.ok, false);
  assert.match(response.error, /Storage full/);
  assert.equal(state.storageWrites, 0);
  assert.equal(state.setCalls, 1);
  assert.equal(route(state, "example.com"), BLOCKED);
});

test("a proxy failure after saving reports that the saved list is not applied", async () => {
  const state = await installed({ editing: true });
  const before = await state.request({ type: "getState" });
  state.setError = "Proxy setting failed";
  const response = await state.request({ type: "saveHosts", baseHosts: before.hosts, hosts: ["example.com"] });
  assert.equal(response.ok, true);
  assert.equal(response.status.code, "ERR");
  assert.deepEqual(state.store.hosts, ["example.com"]);
  assert.equal(route(state, "example.com"), BLOCKED);
});

test("concurrent stale editors cannot overwrite a saved change or its history", async () => {
  const state = await installed({ editing: true, stored: { hosts: ["example.com"] } });
  const [first, second] = await Promise.all([
    state.request({ type: "saveHosts", baseHosts: ["example.com"], hosts: ["example.com", "first.example.com"] }),
    state.request({ type: "saveHosts", baseHosts: ["example.com"], hosts: ["example.com", "second.example.com"] }),
  ]);
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.match(second.error, /list changed/);
  assert.deepEqual(state.store.hosts, first.hosts);
  assert.deepEqual(state.store.history, first.history);
});

test("invalid or unreadable saved lists do not fall back to permissive defaults", async () => {
  for (const stored of [{ hosts: null }, { hosts: ["*"] }]) {
    const state = await installed({ stored });
    assert.equal(state.badge.text, "ERR");
    assert.equal(route(state, "claude.ai"), BLOCKED);
  }
  const state = loadExtension();
  state.storeGetError = "Storage unavailable";
  await state.listeners.startup();
  assert.equal(state.badge.text, "ERR");
  assert.equal(route(state, "claude.ai"), BLOCKED);
});
