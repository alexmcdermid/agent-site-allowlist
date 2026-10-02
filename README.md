# Agent Site Allowlist

A small Chrome extension that limits a dedicated Chrome profile to a list of sites. Built for browser agents such as Claude in Chrome and Codex.

It's a browsing guardrail with [known gaps](#limits), not full isolation.

## Why

A browser agent can use every session in its profile. One SSO sign-in can open email, files and admin tools, and any page the agent reads can carry injected instructions. This extension limits which sites the profile can reach, so sessions for other sites can't be used.

Pair it with a clean profile: no sync, no personal accounts, only accounts made for the agent.

| Alternative | Why it's not enough alone |
| --- | --- |
| Agent approval prompts | Default-prompt, not default-deny |
| Vendor admin allowlists | Usually need a team or enterprise plan |
| Chrome `URLAllowlist` policy | Needs policy admin and can affect your everyday profile |
| Separate Chrome behind a proxy | Can break agent extension connections |

## What it covers

- Only listed sites load in this profile, whoever drives the browser.
- Tab-controlling agents such as Claude in Chrome and Codex can't open the side panel, extension pages or `chrome://extensions`, so they can't change the list.

Not covered:

- **Programs outside Chrome**, such as an agent's shell. They can read Chrome's session files unless you block that. See [Agents with a command line](#agents-with-a-command-line).
- **Anything on an allowed host.** Entries include subdomains, so keep them specific: `login.microsoftonline.com`, not `microsoftonline.com`. An allowed sign-in host can still be misused, for example through its device-code page.
- **Connectors on the agent's account**, such as Gmail or Drive. They run on the vendor's servers.

## How it works

A mandatory PAC script lets allowed hosts and their subdomains connect directly. Everything else goes to an HTTPS proxy at `127.0.0.1:9` and normally fails with `ERR_PROXY_CONNECTION_FAILED`. Chrome requires a trusted certificate from that proxy, so a program listening on port 9 can't relay blocked requests.

The badge shows `ON` when the expected proxy setting is active in regular windows. Incognito is covered only if the extension is allowed there.

Permissions: `proxy`, `storage` and `sidePanel`. No dependencies or build step. Requires Chrome 140 or later.

## Setup

1. Create a profile: profile icon → Add → **Continue without an account**. Don't turn on sync.
2. Install your agent extensions first; the Chrome Web Store is blocked afterwards. Keep them off in Incognito.
3. Review `ALLOWED` in `background.js`. It lists public agent endpoints such as `claude.ai` and `chatgpt.com`.
   - Vendor entries are whole domains, including account settings and API consoles. Sign in only to the agent's own accounts.
   - Google and Microsoft sign-in hosts are blocked by default. Add identity providers only if your test accounts need them.
   - Add private hosts later in the side panel, not in source.
4. In the agent profile, open `chrome://extensions`, turn on **Developer mode**, select **Load unpacked** and choose this folder. Keep the folder in place, somewhere a coding agent can't write.
5. Pin the extension and check for a green `ON` badge. Click it to open the side panel, which can replace another extension's panel, such as Claude's.

If an older saved list has `statsig.com`, `statsigapi.net` or `featuregates.org`, replace them with `oaistatsig.com`, per [OpenAI's network recommendations](https://help.openai.com/en/articles/9247338-network-recommendations-for-chatgpt-errors-on-web-and-apps).

## Verify

| Check | Expected |
| --- | --- |
| Badge | Green `ON` |
| An allowed site | Loads |
| `https://example.com` | `ERR_PROXY_CONNECTION_FAILED` |
| Extension card → **service worker** → Console | `Proxy control: controlled_by_this_extension` |

`OFF` means the extension doesn't control the proxy, usually because another extension or policy does. `ERR` means applying or checking the setting failed; hover for details. Recheck after a browser restart or a list change.

## Change the list

1. Set `ENABLE_UI_EDITING` to `true` in `background.js`.
2. Select **Reload extension** in the side panel, and reopen the panel if it closes.
3. Add or remove domains, select **Save changes** and check for **Saved and applied**.
4. Set `ENABLE_UI_EDITING` back to `false` and reload again.

Notes:

- Paste a domain or a full URL; only the domain is kept. `app-{1..49}.example.com` adds up to 100 numbered domains. IP addresses and `*` wildcards aren't supported.
- **Reloading pauses blocking** until the extension restarts, and open pages can reach unlisted sites in the meantime. The panel asks for confirmation first. Wait for `ON` before the agent continues.
- `ALLOWED` applies only until the first save. After that, the list saved in the profile wins.
- Moving the extension folder can reset the saved list, so note it first.
- Removing a host doesn't clear its cookies or close its tabs.
- The lock doesn't stop anything that can write to this folder or run code in extension pages. Load the extension from a copy the agent can't write.
- A list changed outside the editor shows `ERR` until the next reload. History doesn't record that change, so check the list before reloading.

The panel shows the last seven days of saved changes. It isn't an audit trail.

## Agents with a command line

The extension can't stop local programs. With your access, a command line can read session tokens from Chrome's files, edit the saved list or extension folder, or restart Chrome with flags that weaken it. Set up file protection in the agent itself; see [Agent security setup](docs/agent-security.md).

## Troubleshooting

- **A page half-loads.** Right-click → **Inspect** → Network. Requests failing with `ERR_PROXY_CONNECTION_FAILED` show the missing hosts.
- **Blocked sites show `ERR_PROXY_CERTIFICATE_INVALID` or `ERR_SSL_PROTOCOL_ERROR`.** Something is listening on port 9. The sites stay blocked; find the program with `lsof -nP -iTCP:9 -sTCP:LISTEN`.
- **Chrome warns about `externally_connectable`.** That's intentional: other extensions and pages can't reach the editor.

## Limits

- Disabling or removing the extension removes blocking; reloading pauses it.
- Chrome sends `localhost`, `*.localhost`, `127.0.0.0/8`, `[::1]`, `169.254.0.0/16` and `[fe80::]/10` directly, so local services stay reachable. See [Chromium's bypass rules](https://github.com/chromium/chromium/blob/main/net/docs/proxy.md#implicit-bypass-rules).
- Another extension or policy can take over the proxy. The badge then shows `OFF`.
- Incognito isn't covered unless the extension is allowed there.
- Existing sessions, cached content and open tabs remain.
- The lock and history are local. Anyone who can change the extension's files or storage, or debug its pages, can bypass them.
- WebRTC UDP isn't proxied.
- A compromised page can still send data to any allowed host.
- Rules match whole domains, not paths.
- It isn't an OS sandbox.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md). Report bypasses privately, as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). Not affiliated with Anthropic, OpenAI or Google.
