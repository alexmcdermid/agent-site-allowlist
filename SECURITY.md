# Security Policy

## Reporting a vulnerability

When this repository is hosted on GitHub with private vulnerability reporting enabled, use **Security** → **Report a vulnerability**. If that option is unavailable, ask the maintainer for a private reporting channel without publishing exploit details. Please don't open a public issue describing a bypass.

Include the Chrome version, OS, your `ALLOWED` list (redacted if needed), and steps to reproduce.

This is a volunteer project; reports are handled on a best-effort basis.

## In scope

- An unlisted host reached through a connection governed by the active PAC script
- Unexpected direct fallback for requests governed by the mandatory PAC script
- A badge that incorrectly reports the expected proxy configuration as active
- An editor message accepted while editing is locked (for saves), from another extension or website, or from a regular tab
- The extension affecting profiles other than the one it's installed in

## Out of scope

Known limits documented in the [README](README.md#limits):

- Disabling or removing the extension
- Loopback and link-local traffic that Chrome exempts from PAC routing
- WebRTC UDP from a loaded page
- Existing sessions, cookies, cached content, and already-open pages
- Loss of enforcement while another extension or policy controls the proxy (failure to warn is in scope)
- Independently configured Incognito settings
- Alteration of local history by someone who can modify extension files or storage
- Proxy or storage changes through privileged debugger access to extension pages or the service worker; the editor lock cannot restrict those Chrome APIs
- Data sent to, or actions taken on, an allowed host, including an allowed sign-in host
- Traffic from tools outside the Chrome profile, such as a coding agent's shell or web fetch
- Attacks requiring local OS access
