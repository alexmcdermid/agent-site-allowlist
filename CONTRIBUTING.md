# Contributing

This project stays small and documents its limits.

## Principles

- **Small and auditable.** Anyone should be able to read the whole extension in a few minutes.
- **No dependencies or build step.**
- **Minimum permissions:** `proxy`, `storage` and `sidePanel`. A new permission needs a strong reason.
- **Editing locked by default.** Check `ENABLE_UI_EDITING` and validate domains in the background. Accept editor messages only from the extension's side panel, never from tabs. Match the sender's document ID only when Chrome provides it. Don't add a page-accessible editing API.
- **Strict blocking.** Keep the PAC script mandatory, with one `HTTPS` proxy entry for unlisted hosts and no `DIRECT` fallback. Report loss of proxy control.

## Default allowlist

Add a host only if an agent extension needs it to work. Include a link to the vendor's docs, or the failing request from Inspect → Network. Telemetry, analytics and support widgets stay blocked.

## Development

1. Load the folder unpacked in a test profile (see [Setup](README.md#setup)).
2. Reload the extension after each edit.
3. Run the tests with Node 22, as CI does:

   ```bash
   node --test
   ```

Add a test for any behavior change, and check the side panel and real browsing in Chrome too. A test fails if `ENABLE_UI_EDITING` is committed as `true`.

## Commits and pull requests

Use [Conventional Commits](https://www.conventionalcommits.org/), such as `fix: block uppercase lookalike hosts`. Keep one change per PR, make sure tests pass, update the README if behavior changes, and describe how you tested it in Chrome.

Report security issues privately, as described in [SECURITY.md](SECURITY.md).
