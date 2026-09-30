# Security Policy

## Reporting

Report privately with GitHub's **Security** → **Report a vulnerability**, or ask the maintainer for a private channel. Don't open a public issue about a bypass.

Include your Chrome version, OS, `ALLOWED` list (redacted if needed) and steps to reproduce. Reports are handled on a best-effort basis.

## In scope

- Reaching an unlisted host through a connection the PAC script governs
- Direct fallback from the mandatory PAC script
- The badge showing `ON` when the expected configuration isn't active
- The editor accepting a save while locked, or a message from another extension, a website or a tab
- A program listening on a local port relaying blocked hosts
- The extension affecting other profiles

## Out of scope

The known [limits](README.md#limits), including:

- Disabling, removing or reloading the extension (a missing warning before a side-panel reload is in scope)
- Loopback and link-local traffic that Chrome sends directly
- WebRTC UDP
- Existing sessions, cached content and open pages
- Another extension or policy controlling the proxy (a missing warning is in scope)
- Incognito windows when the extension isn't allowed there
- Anyone who can change the extension's files or storage, or debug its pages
- Data sent to, or actions taken on, an allowed host
- Traffic from outside the Chrome profile
- Attacks needing local OS access, such as changing certificate trust or Chrome's startup flags
