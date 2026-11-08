# Security policy

Backbencher Brain indexes and edits source code on the user's machine. It is
local-first: there is no hosted service, no account and no telemetry, so the security
surface is the program you install plus the install path that delivers it.

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x (current release line) | Yes |
| pre-0.1 internal builds (0.2.x, 0.3.x) and the retired 1.0.x binary line | No — not published, not maintained |

Fixes ship in the newest 0.1.x patch release. Upgrade with
`npm install -g backbencher-brain@latest`.

## Reporting a vulnerability

**Do not open a public issue, PR, discussion, or paste the details into an agent
transcript.**

Use either private channel:

1. **GitHub private vulnerability reporting** — repository **Security** tab →
   **Report a vulnerability**. This opens a private advisory that only the maintainers
   can see. This is the preferred channel.
2. **Email** — `security@backbencher.cc`.
   <!-- PRE-PUBLISH PLACEHOLDER: confirm/create this mailbox before the repo goes public. -->

Include what you need us to know:

- `bb --version`, platform and Node.js version.
- The exact command, MCP tool call, or install step, and what happened.
- A minimal reproduction (repository shape or fixture), or the smallest input that
  demonstrates it.
- Impact: what an attacker gains, and from what starting position (a malicious
  repository? a malicious MCP client? a tampered release?).
- Your disclosure preference and a way to reach you. Redact local paths, tokens and
  user data from any `bb doctor` / log output you attach.

## What is in scope

- **Command execution or file access outside the project.** The engine parses
  untrusted repositories. Parsing must never execute code, load macros, follow
  includes outside the project boundary, or write outside it. Escapes from those
  boundaries are in scope — including through `bb_edit`'s path handling, symlinks,
  archive members, or a grammar's external scanner.
- **Bypassing a stated safety guarantee.** For example: `bb_edit` refusing writes
  under `.git/`, the pre-image/staleness checks, dry-run not mutating anything, the
  index directory not being treated as project source, or the security-scan rules
  claiming coverage the code does not perform.
- **Install-path compromise.** `install.sh`/`install.ps1`, the npm package, and the
  release assets: checksum verification bypass, tag/asset confusion, privilege
  escalation during install, or instructions that would run unverified bytes.
- **Data exposure.** Any path where the index, embeddings, annotations or logs leak to
  a remote destination, or where project data is written to a location the docs do
  not name.
- **Denial of service with attacker-controlled input** in a way that is cheap for the
  attacker and not bounded by the engine's declared limits.
- **The website** (`backbencher.cc`) — XSS, injection, or a tampered generated asset.

## What is not a vulnerability

- A missed vulnerability in code you asked `bb_security` to scan. Static analysis is
  best-effort and the tool states its coverage; report the false negative as an issue
  (with the fixture), not as a security advisory. It becomes a security report only if
  the tool *claims* the coverage it did not provide.
- A crash or poor result on a syntax the analyzers do not support, when the answer
  already declares that limitation.
- Vulnerabilities in third-party dependencies. Report them upstream; we will ship the
  fixed version. Tell us if a pinned dependency makes the fix impossible.
- Local attacks that require the attacker to already have write access to the user's
  account (for example, editing the user's own `bb` config or data directory).
- Anything that requires a modified build of `bb`.

## What to expect

- **Acknowledgment** within 3 business days.
- **Initial assessment** (severity, affected versions, whether it is in scope) within 10
  business days.
- **Fix target**: 30 days for critical/high, 90 days for moderate/low, coordinated with
  your disclosure plan. We will tell you if a fix needs longer rather than going
  silent.
- **Credit** in the release notes if you want it; anonymous reports are fine.
- **No bug bounty.** There is no payout programme, and none should be assumed.

Please give us a reasonable window to ship a fix before public disclosure. If a report
is being actively exploited, say so and we will prioritise triage.

## Hardening for users

- Install from npm, or from the installers served at `https://backbencher.cc` — they
  verify a release binary's sha256 against the release's `checksums.txt` before
  installing it.
- Treat an indexed repository as untrusted input: the index is data, and no command
  executes project code, but a crafted repository is still the main input surface.
- Set `BB_DATA_DIR` on shared or CI machines so the index lands somewhere writable and
  disposable instead of the home directory.
- `bb doctor` and `bb health` are the first things to attach to any report; they state
  the version, configuration and index state without needing the source.
