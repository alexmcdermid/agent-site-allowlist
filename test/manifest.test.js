const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));

test("the minimum Chrome version supports storage.local.setAccessLevel", () => {
  // Chrome 116-139 rejects setAccessLevel for local storage, so every read would fail closed.
  assert.match(fs.readFileSync(path.join(ROOT, "background.js"), "utf8"), /storage\.local\.setAccessLevel/);
  assert.ok(Number(manifest.minimum_chrome_version) >= 140, manifest.minimum_chrome_version);
});

test("the manifest keeps minimum permissions and no page-reachable surface", () => {
  assert.deepEqual([...manifest.permissions].sort(), ["proxy", "sidePanel", "storage"]);
  for (const key of ["host_permissions", "optional_permissions", "optional_host_permissions", "content_scripts", "web_accessible_resources"]) {
    assert.equal(manifest[key], undefined, key);
  }
  assert.deepEqual(manifest.externally_connectable, { ids: [] });
});

test("the editor opens only as the side panel the background authorizes", () => {
  // Without a sender documentId, authorization relies on no other non-tab context loading popup.html.
  assert.equal(manifest.side_panel.default_path, "popup.html");
  assert.match(fs.readFileSync(path.join(ROOT, "background.js"), "utf8"), /chrome\.runtime\.getURL\("popup\.html"\)/);
  assert.equal(manifest.action.default_popup, undefined);
});
