# Agent security setup

The extension limits which sites the agent's Chrome profile can reach. An agent with a command line also needs file protection, because it can read Chrome's session files without making a web request. This guide covers Claude Code and Codex.

Keep the agent's normal approval prompts. Don't copy the site list into an agent's browser policy; keep the extension as the only allowlist.

## What to protect

| Path | Control |
| --- | --- |
| Web connections from the profile | This extension |
| Browser data on disk | Read denies for every agent tool that runs code or reads files |
| Extension folder and saved list | Not writable by the agent |
| Debugger or desktop control | Not given to the agent |
| Upload source files | A tested limit on which files upload tools can read |

## Baseline

1. Use a dedicated profile with only the agent's accounts.
2. Load the extension from a folder the agent can't write, such as an admin-owned copy.
3. Check the `ON` badge, an allowed site and a blocked site.
4. If the agent has a command line, add [file protection](#file-protection).
5. After changing agent settings, check that Chrome tab control still works.

## File protection

Protect every browser you're signed in to. The paths below are for macOS. Merge them into your existing settings.

### Claude Code

Add this to `~/.claude/settings.json`. Replace `~/.local/share/agent-site-allowlist` with the folder Chrome loads the extension from.

```json
{
  "sandbox": {
    "enabled": true,
    "failIfUnavailable": true,
    "allowUnsandboxedCommands": false,
    "filesystem": {
      "denyWrite": ["~/.local/share/agent-site-allowlist"]
    }
  },
  "permissions": {
    "deny": [
      "Read(~/Library/Application Support/Google/**)",
      "Edit(~/Library/Application Support/Google/**)",
      "Read(~/Library/Caches/Google/**)",
      "Edit(~/Library/Caches/Google/**)",
      "Edit(~/.local/share/agent-site-allowlist/**)",
      "mcp__terminal__run_in_terminal",
      "mcp__Claude_Browser__preview_start",
      "mcp__Claude_Code_iOS_Simulator"
    ]
  }
}
```

- **Sandbox:** shell commands run with limited access. `failIfUnavailable` stops Claude Code if the sandbox can't start, and `allowUnsandboxedCommands: false` blocks retries outside it.
- **Browser data:** the `Read` denies cover file tools, sandboxed commands and Claude in Chrome uploads. The `Edit` denies add notebook edits. Add the same pair for each other browser (`Microsoft Edge`, `BraveSoftware`, `Arc`, `Chromium`, `Firefox`). On Linux, use `~/.config/google-chrome` and `~/.cache/google-chrome`.
- **Extension folder:** `denyWrite` and the matching `Edit` deny stop commands and file tools from changing it.
- **Desktop tools:** the last three rules deny the desktop app's tools that can run code outside the sandbox: the terminal panel, browser-pane dev servers and the iOS Simulator tools. After app updates, check for new tools like these.

These still run outside the sandbox: `sandbox.excludedCommands`, hooks, `!` commands and anything you run yourself. A project's settings can override yours. An admin can enforce the settings in `/Library/Application Support/ClaudeCode/managed-settings.json`, and add `"allowManagedHooksOnly": true` to ignore other hooks. Managed settings can't remove `excludedCommands` set elsewhere. See [Claude Code sandboxing](https://code.claude.com/docs/en/sandboxing#keep-developers-from-widening-the-policy).

### Codex

Codex's sandbox modes don't block reads of browser data. An admin can add this to `/etc/codex/requirements.toml`:

```toml
[permissions.filesystem]
deny_read = [
  "~/Library/Application Support/Google",
  "~/Library/Caches/Google",
]
```

Add other browsers' folders. Users can't loosen managed requirements. See [managed requirements](https://learn.chatgpt.com/docs/enterprise/managed-configuration#enforce-deny-read-requirements) and [permission profiles](https://learn.chatgpt.com/docs/permissions).

Keep the usual CLI settings:

```toml
approval_policy = "on-request"
approvals_reviewer = "user"
sandbox_mode = "workspace-write"
```

They cover shell commands, not every MCP server or browser tool. See [permission scope](https://learn.chatgpt.com/docs/permissions#scope-and-enforcement).

## Uploads

Uploads and downloads on allowed sites work normally. The allowlist controls where uploads go, not which local files can be read. To test:

1. Deny the agent a harmless test file, and confirm it can't read it.
2. Upload that file and a readable one to a local page that submits nothing.
3. If the page reads the denied file, the upload tool isn't covered.

Never test with real session files. ChatGPT's integration needs **Allow access to file URLs** to pick local files; see [its upload docs](https://developers.openai.com/codex/app/chrome-extension#upload-files).

## Verify

| Check | Expected |
| --- | --- |
| Allowed site through the agent | Loads; tab control works |
| Unlisted site | Blocked |
| Listing a browser data folder from the agent's command line | Permission denied |
| The same path through a symlink or different case | Denied |
| Writing in a normal workspace | Allowed |
| Writing to the extension folder, by command and by file tool | Denied |
| Reload from the side panel | Confirmation shown; list kept; badge returns to `ON` |
| Desktop app: terminal command, dev server, iOS build | Each refused |
| Uploading a denied test file | Refused, or recorded as untested |
| New session after restart | Same restrictions |

A missing file (`ENOENT`), an unsupported option or a startup error isn't a denial.

## Validation status

Tested on macOS on 2026-09-30. Each result covers only the session named.

| Check | Session | Result | Evidence |
| --- | --- | --- | --- |
| Browser-data read denial; allowed and blocked routing | Codex CLI `0.158.0-alpha.2.1` | Passed | Tool output |
| Reload keeps the list and returns to `ON` | Operator's Chrome profile | Passed | Operator-reported |
| Terminal and `preview_start` denies | Claude desktop app, Claude Code `2.1.284` | Refused before anything ran | Tool output |
| iOS Simulator deny | Same Claude session | `build` and `control` refused; `build` worked before the rule | Tool output |
| Upload under a temporary `Read` deny | Same Claude session | Refused before reaching the page; a readable file uploaded | Tool output |
| Upload denied only in a separate CLI sandbox | ChatGPT Chrome integration | The page read the file | Tool output |

Not tested:

- A Claude upload through a symlink.
- Opening denied files as `file://` pages with the Claude extension's **Allow access to file URLs** on.
- ChatGPT uploads under a restriction in the same Codex session.
- `sandbox.excludedCommands` and other execution paths.

Until these are covered, don't claim full protection against a command-line agent reading browser sessions.
