importScripts("rules.js");

// Set true and reload to edit the list. Set false and reload to lock it again.
const ENABLE_UI_EDITING = false;

// Initial list, used until the first editor save. Saved lists survive locking and reloads.
// Hosts allowed by the PAC script. Chrome's implicit bypasses still apply.
// Each entry also allows its subdomains.
const ALLOWED = [
  // Claude in Chrome
  "claude.ai",
  "claude.com",
  "anthropic.com",
  "claudeusercontent.com", // extension WebSocket bridge (bridge.*) and artifacts

  // ChatGPT / OpenAI endpoints
  "chatgpt.com",
  "openai.com",
  "oaistatic.com",         // app assets (cdn.*)
  "oaiusercontent.com",    // files
  "oaistatsig.com",        // OpenAI feature flags; see its network recommendations

  // Shared: Cloudflare bot checks on login
  "challenges.cloudflare.com",

  // Deliberately omitted: telemetry and support widgets (sentry, datadog, intercom, stripe).
  // Add endpoints only when needed for your workflow.

  // Your sites: add them through the editor to keep personal hosts out of Git.
  // Don't add SSO / identity-provider login hosts unless your test accounts need them.
];

const HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
let pending = Promise.resolve();

// Serialize reads/pruning/saves so opening an editor cannot overwrite a concurrent change.
function enqueue(task) {
  const result = pending.then(task);
  pending = result.catch(() => {});
  return result;
}

function showStatus(code, message) {
  chrome.action.setBadgeText({ text: code });
  chrome.action.setBadgeBackgroundColor({ color: code === "ON" ? "#166534" : code === "..." ? "#475569" : "#B91C1C" });
  chrome.action.setTitle({ title: `Agent Site Allowlist: ${message}` });
  return { code, message };
}

function showError(message) {
  console.error(message);
  return showStatus("ERR", `${message} Check the extension's errors and reload it.`);
}

async function readState(prune = false) {
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  const stored = await chrome.storage.local.get({ hosts: ALLOWED, history: [] });
  const hosts = normalizeHosts(stored.hosts);
  if (!Array.isArray(stored.history)) throw new Error("Saved change history is invalid.");
  const cutoff = Date.now() - HISTORY_RETENTION_MS;
  const history = stored.history.filter((entry) => entry &&
    Number.isFinite(entry.timestamp) && entry.timestamp >= cutoff &&
    typeof entry.domain === "string" && ["added", "removed"].includes(entry.action));
  if (prune && history.length !== stored.history.length) {
    await chrome.storage.local.set({ history });
  }
  return { hosts, history };
}

async function refreshStatus(hosts) {
  try {
    const config = buildConfig(hosts ?? (await readState()).hosts);
    // Inspect regular windows even if an Incognito setting triggered the event.
    const settings = await chrome.proxy.settings.get({ incognito: false });
    console.log("Proxy control:", settings.levelOfControl);
    if (settings.levelOfControl !== "controlled_by_this_extension") {
      return showStatus("OFF", "Allowlist inactive. Check other proxy extensions and Chrome policies.");
    }
    const current = settings.value;
    if (current.mode !== config.mode ||
        current.pacScript?.mandatory !== true ||
        current.pacScript?.data !== config.pacScript.data) {
      return showError("The expected allowlist proxy settings are not active.");
    }
    return showStatus("ON", "Allowlist proxy active in regular windows. Browser exceptions still apply.");
  } catch (error) {
    return showError(`Cannot check proxy status: ${error.message}`);
  }
}

async function apply(hosts) {
  showStatus("...", "Applying allowlist proxy settings.");
  try {
    await chrome.proxy.settings.set({ value: buildConfig(hosts), scope: "regular" });
    return await refreshStatus(hosts);
  } catch (error) {
    return showError(`Allowlist not applied: ${error.message}`);
  }
}

async function applySaved() {
  try {
    return await apply((await readState()).hosts);
  } catch (error) {
    // Never replace an unreadable saved list with more permissive defaults.
    await apply([]);
    return showError(`Cannot load the saved allowlist: ${error.message}`);
  }
}

async function getEditorState() {
  const state = await readState(true);
  return { ...state, editingEnabled: ENABLE_UI_EDITING, status: await refreshStatus(state.hosts) };
}

async function saveHosts(message) {
  if (!ENABLE_UI_EDITING) throw new Error("Editing is locked by the extension configuration.");
  const hosts = normalizeHosts(message.hosts);
  const baseHosts = normalizeHosts(message.baseHosts);
  const current = await readState();
  if (JSON.stringify(baseHosts) !== JSON.stringify(current.hosts)) {
    throw new Error("The list changed while this editor was open. Close and reopen the editor before saving.");
  }
  const timestamp = Date.now();
  const changes = [
    ...hosts.filter((domain) => !current.hosts.includes(domain)).map((domain) => ({ timestamp, domain, action: "added" })),
    ...current.hosts.filter((domain) => !hosts.includes(domain)).map((domain) => ({ timestamp, domain, action: "removed" })),
  ];
  const history = [...current.history, ...changes];
  // Persist the list and its history together before changing network access.
  await chrome.storage.local.set({ hosts, history });
  const status = await apply(hosts);
  return { hosts, history, editingEnabled: ENABLE_UI_EDITING, status };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const editorUrl = chrome.runtime.getURL("popup.html");
  const denied = "Only the extension side panel can access the editor.";
  if (sender.id !== chrome.runtime.id || sender.url !== editorUrl || sender.tab) {
    respond({ ok: false, error: denied });
    return false;
  }
  if (!message || !["getState", "saveHosts"].includes(message.type)) {
    respond({ ok: false, error: "Unknown editor request." });
    return false;
  }
  enqueue(async () => {
    // Chrome omits documentId for non-tab senders. Reject tabs above, and require
    // a live side panel at the private editor URL. Match documentId when supplied.
    const [context] = await chrome.runtime.getContexts({
      ...(sender.documentId ? { documentIds: [sender.documentId] } : {}),
      documentUrls: [editorUrl],
      contextTypes: ["SIDE_PANEL"],
    });
    if (!context) throw new Error(denied);
    return message.type === "getState" ? getEditorState() : saveHosts(message);
  }).then(
    (state) => respond({ ok: true, ...state }),
    (error) => respond({ ok: false, error: error.message }),
  );
  return true;
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(`Cannot enable the toolbar side panel: ${error.message}`));

chrome.runtime.onInstalled.addListener(() => enqueue(applySaved)); // install and reload
chrome.runtime.onStartup.addListener(() => enqueue(applySaved));   // browser start
chrome.proxy.settings.onChange.addListener(() => enqueue(() => refreshStatus()));
// A list written outside the editor no longer matches the proxy, so the badge reports ERR
// until the next reload or browser start applies it. Editor saves apply before this runs.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.hosts) return enqueue(() => refreshStatus());
});
enqueue(() => refreshStatus()); // refresh the badge whenever the service worker wakes
