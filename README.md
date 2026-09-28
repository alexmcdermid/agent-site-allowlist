# Agent Site Allowlist

A tiny Chrome extension that restricts web connections in a dedicated Chrome profile to a list of trusted hosts. Intended for browser agents such as Claude in Chrome and the Codex Chrome extension.

This is a **browsing guardrail**, with [browser exceptions](#limits). It does not provide complete network or session isolation.

## Why

Browser agents act inside your real Chrome profile, with every session that profile holds. Two things make that riskier than it looks:

- **SSO multiplies sessions.** One single sign-on login usually opens email, chat, file storage and admin tools without another prompt. Signing out of one app rarely ends the identity provider's session, so an agent that reaches one SSO app can often reach them all.
- **Prompt injection turns reach into risk.** Any page the agent reads can carry instructions. The more sites and sessions it can reach, the more an injected instruction can do.

Use two layers:

1. **A clean profile** limits what's *logged in*: no sync, no personal accounts, only test accounts created for the agent.
2. **This allowlist** limits what the profile can *reach*: only the agent endpoints and sites you choose load, so sessions for other sites can't be used.

The agents' own per-site approval prompts still apply on top as a third layer.

### Alternatives considered

| Option | Why it's not enough on its own |
| --- | --- |
| Agents' per-site approval prompts | Default-prompt, not default-deny; relies on you declining every unexpected site |
| Vendor admin allowlists | Typically require a team or enterprise plan |
| Chrome `URLBlocklist` / `URLAllowlist` policy | Requires policy administration; machine-level policies can affect your everyday profile too |
| Separate Chrome instance behind a proxy | Works, but custom data dirs can break agent extension connections |

## What it covers

Only listed sites load in this profile, whoever is driving the browser. An agent can't use a session for an unlisted site, even if the profile is still signed in there. Agent extensions that control tabs, such as Claude in Chrome and the Codex Chrome extension, can't open the side panel, extension pages or `chrome://extensions`, so they can't change the list. Check other agents before relying on that.

It doesn't cover:

- **Tools outside this profile**, such as a coding agent's shell or web fetch. They can reach any site, but without this profile's cookies they can't use its sessions.
- **Anything on an allowed host.** Each entry also allows its subdomains, so keep entries specific: if you allow Microsoft sign-in, add `login.microsoftonline.com`, not `microsoftonline.com`. An allowed sign-in host can still be misused on that host, for example to complete a device-code sign-in that hands a session to someone else.

See [Limits](#limits) for browser exceptions such as loopback addresses.

## Use cases

- **Testing your own web app with an agent.** Allow your dev/test hosts and log in with test accounts. Keep production and work-email hosts out of the list.
- **Keeping work sessions separate.** Leave SSO in your everyday profile and start the agent profile without personal accounts or synced sessions.
- **Research on a fixed set of sites.** Allow a handful of docs or reference sites to reduce unintended navigation.
- **Demos and recordings.** Restrict new web connections to the demo environment and required agent endpoints.

## How it works

It sets a PAC proxy script with `chrome.proxy` at `regular` scope for the profile where it is installed. Regular settings are also inherited by that profile's Incognito windows unless overridden; use regular windows for agent work.

For requests that use the PAC script, allowed hosts and their subdomains connect directly. Other hosts are sent to `127.0.0.1:9`, which must remain unused, and normally fail with `ERR_PROXY_CONNECTION_FAILED`. Setting `mandatory: true` prevents direct fallback when the PAC script is invalid; it does not override Chrome's implicit bypasses or another proxy controller.

The toolbar badge monitors the effective proxy setting for regular windows. It detects loss of proxy control without trying to override another extension or policy. `ON` confirms the expected configuration is active; it is not a connectivity test or a guarantee of isolation.

No dependencies or build step. Three permissions: `proxy` for routing, `storage` for the local allowlist and change history, and `sidePanel` for an editor that can stay open alongside your page. Requires Chrome 116 or later.

## Setup

1. **Create the agent profile.** Chrome → profile icon → Add → **Continue without an account**. Don't turn on sync, or your main account's passwords and history come with it.
2. **Install your browser-agent extensions in this profile first.** The Chrome Web Store is blocked after the allowlist is enabled. Leave the agent extensions off in Incognito and avoid starting agent tasks during setup.
3. **Review the initial allowlist.** `ALLOWED` in `background.js` contains the public service defaults. Keep private test/dev addresses out of source; add them through the side panel after loading (see [Change the list](#change-the-list)). Paste a full `http://` or `https://` website URL, or enter a domain. The editor extracts the domain; each entry allows its subdomains and all paths and ports. IP addresses are not supported. Use ASCII domain names (punycode for internationalized names); pasted URLs are converted automatically.
   - Keep the endpoints needed by the agents you use (`claude.ai`, `claudeusercontent.com`, `chatgpt.com`, `oaistatic.com`, etc.).
   - Use email sign-in where supported. Google and Microsoft login hosts are blocked by default.
   - Add SSO / identity-provider hosts only when your test accounts need them. Blocking a login host does not clear existing sessions.
4. **Load the allowlist extension.** In the agent profile only: `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → select the folder containing `manifest.json`.
5. **Pin Agent Site Allowlist.** Open Chrome's Extensions menu (puzzle piece) and pin it to the toolbar. The badge should show green `ON`; hover over it for status details. Click it to open the side panel directly and view the list and recent changes alongside your page. Editing starts locked. Keep this folder in place because Chrome loads the unpacked extension from it. If a coding agent drives the browser, keep the folder where that agent can't write (see [Change the list](#change-the-list)).

The default feature-flag host is `oaistatsig.com`, listed in [OpenAI's network recommendations](https://help.openai.com/en/articles/9247338-network-recommendations-for-chatgpt-errors-on-web-and-apps). The generic `statsig.com`, `statsigapi.net`, and `featuregates.org` domains are not included. If you already saved a list with those older entries, remove them and add `oaistatsig.com` through the side panel; reloading does not replace a saved list.

## Verify

| Check | Expected |
| --- | --- |
| Toolbar badge | Green `ON`: expected PAC configuration is active for regular windows |
| Open an allowed host | Loads |
| Open `https://example.com` | `ERR_PROXY_CONNECTION_FAILED` |
| Extension card → **service worker** → Console | `Proxy control: controlled_by_this_extension` |

Red `OFF` means this extension does not control the proxy. Red `ERR` means applying or checking the expected setting failed. Hover over the badge, then inspect the extension's errors or service-worker console. Resolve the conflict or error and reload the extension before relying on it. A blank badge or `...` does not confirm protection.

Repeat the allowed/blocked checks after a browser restart and after changing the list. These manual checks complement the unit tests; the unit tests do not exercise Chrome's network stack.

## Change the list

Click the toolbar icon to open the side panel directly. It stays open while you use the page or switch tabs. Opening it may replace another extension's panel, such as Claude's. See [Chrome's Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel).

To enable editing:

1. In `background.js`, change `ENABLE_UI_EDITING` to `true`.
2. Reload the extension at `chrome://extensions`.
3. Click the toolbar icon to open the side panel. Add or remove domains, then select **Save changes**. Unsaved edits live only in that editor; save before closing it or reloading the extension.
4. Confirm that the editor reports **Saved and applied** and the badge shows `ON`. A save can persist even if a proxy conflict prevents application; the editor reports that separately.
5. To lock editing again, set `ENABLE_UI_EDITING` to `false` and reload. The saved list stays active.

The background checks the editing flag on every save through the editor. There is no unlock button in the panel. It requires the sender's extension ID and private editor URL, rejects tab senders, and requires a live side-panel context. Chrome omits the sender's document ID for side panels; it is matched when supplied. Opening the same editor URL in a regular tab does not grant access to this message interface, even while a side panel is open. The editor is not a web-accessible resource.

The edit lock is not a boundary against privileged browser control. Anything that can run JavaScript in an extension page or its service worker can call Chrome's proxy and storage APIs directly. An agent that can operate the real side panel can edit while editing is enabled.

The lock is only as strong as this folder's permissions: anything that can write to it can change `ENABLE_UI_EDITING` or the code. If a coding agent drives the browser, load the extension from a copy that agent can't write to, such as one owned by root.

A list written to storage outside the editor no longer matches the active proxy, so the badge shows `ERR` until the next reload or browser start applies it. History doesn't record such writes, so check the list before reloading after an unexplained `ERR`.

An open panel refreshes saved changes from another window when it has no draft changes or unfinished input. If multiple panels edit the list, the background rejects a stale save rather than overwriting newer changes; reopen that editor to load the latest list.

**Before the first save**, `ALLOWED` in the source is the active list, so source changes take effect on reload. **After the first save**, the locally stored list takes precedence, including an intentionally empty list. Further changes to `ALLOWED` do not replace that saved list. Use the editor to change it. The saved list survives browser restarts, extension reloads, and locking editing; uninstalling the extension removes it.

You can paste a full website URL directly from the address bar, such as `https://docs.example.com:8443/guide?q=setup#install`. Select **Add** to extract and review `docs.example.com`, then **Save changes**. Only the domain is stored and logged; URL paths, queries, fragments, and ports are discarded. The rule allows the whole domain and its subdomains across all paths and ports. Only HTTP/HTTPS URLs are accepted, and URLs containing a username or password are rejected.

For a numbered set of sites, enter a range such as `app-{1..49}.example.com` in the editor and select **Add**. It expands into 49 individual domains for you to review before **Save changes**. The range is inclusive and accepts up to 100 domains, with one range per input and no leading zeros. General wildcards such as `app-*.example.com` are not supported. Each generated entry also allows its subdomains, just like a manually added domain. Additions and removals are logged per domain.

Saved entries and their history stay in Chrome's local extension storage, outside this repository. Private site addresses added there are not written to tracked files or included in Git commits. Use the editor for personal settings; keep real environment addresses out of source, documentation, and tests.

The new list governs subsequent connections that use the PAC script. Removing a host does not clear its cookies, cached content, or already-open pages; close its tabs and clear its stored data when removing access. Removing required agent domains can disconnect the agent.

### Change history

Each successful list save records the domains added or removed and a timestamp. Unchanged entries and unsaved edits are not logged. History describes saved configuration changes, not proof that the proxy applied them, and cannot identify whether a human or agent made them.

The side panel displays a rolling seven days of history, with times shown in your local timezone. Older entries are pruned when an editor loads or refreshes its state, or when saving; they may remain stored while the extension is idle. There is no scheduled task and **domains never expire with the history**. List and history stay in this Chrome profile's local extension storage; they are not synced or sent to a server. No browsing activity is logged.

## Troubleshooting

A side panel is blank or a site half-loads: right-click the panel → **Inspect** → Network tab. Requests failing with `ERR_PROXY_CONNECTION_FAILED` name the missing hosts; add the ones you trust.

Chrome may warn that `externally_connectable` specifies no IDs or matches. This is intentional: external extensions and web pages are not allowed to connect to the editor. It does not block this extension's own internal messages.

## Limits

- **Disabling or removing the extension removes the block.** Check that it is enabled and pinned before agent sessions. This extension does not prevent changes to Chrome's settings.
- **Loopback and link-local destinations bypass PAC routing.** Chrome sends `localhost`, `*.localhost`, `127.0.0.0/8`, `[::1]`, `169.254.0.0/16`, and `[fe80::]/10` directly. Local services may remain reachable. These implicit bypasses cannot be disabled by a PAC script. See [Chromium's proxy documentation](https://github.com/chromium/chromium/blob/main/net/docs/proxy.md#implicit-bypass-rules).
- **Another extension or policy can override the proxy.** The badge warns about loss of regular-window control, but cannot enforce the allowlist while control is lost. Incognito can have different settings; the badge does not validate those. See [Chrome's setting scopes and precedence](https://developer.chrome.com/docs/extensions/reference/api/types#scope_and_lifecycle).
- **Existing content and sessions remain.** This does not sign you out, clear cookies or caches, close tabs, or remove already-loaded content. Start with a clean profile.
- **The edit lock and history are local controls.** They are not a tamper-proof audit trail or proof of human approval. Anyone able to modify extension files or its storage can alter them.
- **Privileged browser tools can bypass the editor.** Debugger access to an extension page or service worker can change the proxy directly, even while editing is locked. This extension cannot constrain tools with that access or permission to disable extensions.
- **WebRTC UDP isn't proxied.** This is not a block on every network transport a loaded page can use.
- **Allowed domains are an egress path too.** Every entry trusts its subdomains and all ports. A compromised page could still send data to an allowed endpoint. Review the list for your workflow.
- **Rules cover whole domains, not pages.** Chrome gives PAC scripts only the host of `https://` URLs. Allowing `figma.com` allows every file the agent's account can open, so limit that account's access instead.
- **Not an OS sandbox.** It does not isolate the profile from other processes or filter local files and Chrome's internal pages. Keep port 9 unused; this extension does not reserve it.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md). Report bypasses privately as described in [SECURITY.md](SECURITY.md), not in public issues.

## License

[MIT](LICENSE)

Not affiliated with Anthropic, OpenAI or Google. Product names are trademarks of their owners.
