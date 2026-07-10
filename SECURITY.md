# Security Policy

Standalone Web Media Analyzer parses untrusted local or remote media bytes in the browser. It is local-first and does not upload local files to a server, but malformed binary inputs can still expose parser bugs, denial-of-service behavior, or browser-specific crashes. Remote URL analysis is different from local-file analysis: the browser fetches the supplied URL directly, so the remote host can see those requests.

## Reporting Security Issues

Please do not publish exploit details, malicious media files, or crash repro payloads in a public issue.

Use GitHub private vulnerability reporting or a private maintainer contact path when available. If there is no private channel available, open a minimal public issue that says security contact is needed, without attaching exploit samples or detailed payload bytes.

Useful private reports include:

- affected browser and OS
- container or codec involved
- whether the issue requires local file input, remote URL input, hosted samples, or source-frame overlay
- minimal reproduction steps
- exported JSON, console logs, or screenshots when safe to share
- a reduced sample file only when it does not contain private or harmful content

## Scope

In scope:

- parser hangs or excessive CPU/memory use from crafted media input
- crashes caused by malformed container or codec metadata
- unsafe handling of remote URL loading, CORS/range fallback, or preview setup
- source-frame overlay behavior that exposes decoded pixels when the browser should have tainted the media canvas
- XSS or DOM injection through parsed metadata fields

Out of scope:

- malformed-file repair requests
- playback bugs caused by the browser media engine itself
- issues requiring DRM bypass, CORS bypass, or server-side control outside this project
- requests to bypass canvas-tainting restrictions for remote source-frame overlay
- attacks that require the user to paste arbitrary script into developer tools

No formal security SLA is provided, but security reports are treated as higher priority than ordinary feature requests.
