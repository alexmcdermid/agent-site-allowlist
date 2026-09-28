const elements = Object.fromEntries([
  "status", "mode", "hosts", "empty-list", "add-form", "domain", "add", "save", "message", "history", "empty-history",
].map((id) => [id, document.getElementById(id)]));
let baseHosts = [];
let draftHosts = [];
let editingEnabled = false;
let busy = true;

function message(text, error = false) {
  elements.message.textContent = text;
  elements.message.dataset.error = String(error);
}

async function request(type, data = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...data });
  if (!response?.ok) throw new Error(response?.error || "The extension could not complete the request.");
  return response;
}

function hasUnsavedChanges() {
  return JSON.stringify(draftHosts) !== JSON.stringify(baseHosts);
}

function updateControls() {
  const disabled = busy || !editingEnabled;
  elements.domain.disabled = disabled;
  elements.add.disabled = disabled;
  elements.save.disabled = disabled || !hasUnsavedChanges();
  for (const button of elements.hosts.querySelectorAll("button")) button.disabled = disabled;
}

function renderHosts() {
  elements.hosts.replaceChildren();
  elements["empty-list"].hidden = draftHosts.length !== 0;
  for (const domain of draftHosts) {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = domain;
    item.append(label);
    if (editingEnabled) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove ${domain}`);
      remove.addEventListener("click", () => {
        if (busy) return;
        draftHosts = draftHosts.filter((host) => host !== domain);
        message("Unsaved changes. Removing agent service domains may disconnect your agent.");
        renderHosts();
      });
      item.append(remove);
    }
    elements.hosts.append(item);
  }
  updateControls();
}

function renderState(state) {
  baseHosts = [...state.hosts];
  draftHosts = [...state.hosts];
  editingEnabled = state.editingEnabled;
  elements.mode.textContent = editingEnabled
    ? "Editing enabled. Changes take effect when you save."
    : "Editing is locked by the extension configuration.";
  elements["add-form"].hidden = !editingEnabled;
  elements.save.hidden = !editingEnabled;
  renderStatus(state.status);
  elements.history.replaceChildren();
  elements["empty-history"].hidden = state.history.length !== 0;
  for (const entry of [...state.history].sort((a, b) => b.timestamp - a.timestamp)) {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = `${entry.action === "added" ? "Added" : "Removed"} ${entry.domain}`;
    const time = document.createElement("time");
    time.dateTime = new Date(entry.timestamp).toISOString();
    time.textContent = new Date(entry.timestamp).toLocaleString();
    item.append(label, time);
    elements.history.append(item);
  }
  renderHosts();
}

function renderStatus(status) {
  elements.status.textContent = status.code;
  elements.status.dataset.code = status.code;
  elements.status.title = status.message;
  elements.status.setAttribute("aria-label", status.message);
}

// Keep long-lived panels current without discarding unsaved domain edits or pasted text.
function refreshView() {
  request("getState").then((state) => {
    if (!busy && !hasUnsavedChanges() && !elements.domain.value.trim()) renderState(state);
    else renderStatus(state.status);
  }).catch((error) => {
    renderStatus({ code: "ERR", message: error.message });
  });
}

chrome.proxy.settings.onChange.addListener(refreshView);
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.hosts) refreshView();
});

elements["add-form"].addEventListener("submit", (event) => {
  event.preventDefault();
  if (busy || !editingEnabled) return;
  try {
    const domains = expandDomainInput(elements.domain.value);
    const additions = domains.filter((domain) => !draftHosts.includes(domain));
    if (additions.length === 0) throw new Error("Those domains are already in the list.");
    draftHosts = normalizeHosts([...draftHosts, ...additions]);
    elements.domain.value = "";
    const added = additions.length === 1 ? additions[0] : `${additions.length} domains`;
    message(`Added ${added} to the draft. Select Save changes to apply.`);
    renderHosts();
    elements.domain.focus();
  } catch (error) {
    message(error.message, true);
  }
});

elements.save.addEventListener("click", async () => {
  if (busy || !editingEnabled) return;
  busy = true;
  updateControls();
  message("Saving…");
  try {
    const state = await request("saveHosts", { hosts: draftHosts, baseHosts });
    renderState(state);
    message(state.status.code === "ON" ? "Saved and applied." : `List saved. ${state.status.message}`, state.status.code !== "ON");
  } catch (error) {
    message(error.message, true);
  } finally {
    busy = false;
    updateControls();
  }
});

request("getState").then((state) => {
  renderState(state);
  if (state.status.code !== "ON") message(state.status.message, true);
}).catch((error) => {
  elements.mode.textContent = "Could not load the allowlist.";
  elements.status.textContent = "ERR";
  elements.status.dataset.code = "ERR";
  message(error.message, true);
}).finally(() => {
  busy = false;
  updateControls();
});
