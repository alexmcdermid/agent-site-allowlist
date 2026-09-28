# Contributing

Thanks for helping. This project is a browsing guardrail, so it stays deliberately small and documents its limits.

## Principles

- **Small and auditable.** Anyone should be able to read the whole extension in a few minutes.
- **Zero dependencies, no build step.** Plain JavaScript that Chrome loads as-is.
- **Minimum permissions.** The extension requests `proxy` for routing, `storage` for the local list/history, and `sidePanel` for the persistent editor. A new permission needs a strong reason in the PR.
- **Keep editing locked by default.** Enforce `ENABLE_UI_EDITING` in the background, validate domains there, reject tab senders, and require the extension ID, private editor URL, and a live side-panel context. Chrome does not supply a sender document ID for side panels; only filter on it when provided. Do not add a page-accessible editing API.
- **Preserve blocking behavior.** Keep the PAC script mandatory and never add a `DIRECT` fallback for unlisted hosts. Surface loss of proxy control; do not claim that proxy routing prevents Chrome's documented exceptions.

## Changing the default allowlist

Only add hosts an agent extension needs to **function**. Each addition needs one of:

- A link to the vendor's documentation listing the host, or
- A description of what breaks without it (the failing request from Inspect → Network).

Telemetry, analytics and support widgets stay blocked.

## Development

1. Load the folder unpacked in a test profile (see [README](README.md#setup)).
2. After editing, click reload on the extension card.
3. Run the tests (Node 22, matching CI; no install needed):

   ```bash
   node --test
   ```

Add or update a test in `test/` for routing, status, editor authorization, persistence, or history behavior. Unit tests stub Chrome's APIs and evaluate the PAC script; verify the side panel, real browser behavior, and browser-agent access separately. Keep editing disabled in committed configuration; a unit test fails while `ENABLE_UI_EDITING` is `true`.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add allowlist entry for X
fix: block uppercase lookalike hosts
docs: clarify incognito setup
test: cover IP address hosts
chore: update CI workflow
```

## Pull requests

- One change per PR.
- Tests pass (`node --test`); [CI](.github/workflows/ci.yml) runs syntax checks and tests on pushes and pull requests when hosted on GitHub.
- Update the README if behavior or setup changes.
- Describe how you verified it in a real Chrome profile.

## Security issues

Don't open a public issue for a bypass. Follow [SECURITY.md](SECURITY.md).
