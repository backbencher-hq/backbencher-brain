# Installing and verifying bb_lsp per editor

One VSIX serves every VS Code-family editor. The verification step is the
same everywhere: **`Backbencher: Show status`** — every fact it renders
carries its claim level and staleness marker. An editor without a pinned run
below is declared unverified, not claimed (contract §1).

The artifact name below is drift-gated: `script/m25/verify-listing.ts` fails
if these instructions stop naming the real built VSIX.

## Artifact

Build or obtain the extension package:

```bash
cd ide/vscode
npx @vscode/vsce package --allow-missing-repository --no-git-tag-version
# -> bb-lsp-vscode-0.1.0.vsix (the exact name the README and this doc name)
```

## VS Code (verified here — I3, pinned 1.85.0, Linux; evidence `validation/m25/results/E5.json`)

```bash
code --install-extension bb-lsp-vscode-0.1.0.vsix
# First run on a clean profile — never over your daily driver the first time:
code --user-data-dir /tmp/bb-try --extensions-dir /tmp/bb-try-ext .
```

Then: open a workspace, run **`Backbencher: Show status`** from the command
palette. Expected: the evidence-tier table renders, the server is reported up
with a version check, and hovering an indexed symbol shows its tier. The
scripted equivalent of these steps runs at verify time
(`script/m25/verify-install-docs.ts`).

## Cursor (verified here — I4, pinned 3.18.9, Linux; evidence `validation/m25/results/F-CURSOR.json`)

```bash
cursor --install-extension bb-lsp-vscode-0.1.0.vsix
cursor --user-data-dir /tmp/bb-try-cursor --extensions-dir /tmp/bb-try-cursor-ext .
```

Verify with the same `Backbencher: Show status` step.

## Antigravity (verified here — I4, pinned 1.107.0, Linux; evidence `validation/m25/results/F-ANTIGRAVITY.json`)

```bash
antigravity --install-extension bb-lsp-vscode-0.1.0.vsix
antigravity --user-data-dir /tmp/bb-try-antigravity --extensions-dir /tmp/bb-try-antigravity-ext .
```

Verify with the same `Backbencher: Show status` step.

## Windsurf (blocked here — no pinned run on this machine)

Not verified. If you have Windsurf, install as above and run
`Backbencher: Show status`; the status surface reports exactly what the
server proves and nothing more. Until a pinned run is recorded (or a waiver
approved), Windsurf carries no claim in the matrix — evidence placeholder:
`validation/m25/results/F-WINDSURF.json`.

## macOS / Windows (not verified — E7 pending)

No OS-matrix run is recorded yet. Install steps are expected to be identical
(the VSIX is platform-independent), but per contract §10 an OS claim needs an
OS-scoped run; none exists, so none is claimed.

## Troubleshooting

- **Server version mismatch visible in status**: update the
  backbencher-brain checkout (or the bundled server). A server that will not
  state its version is never trusted — features stay off with a visible
  message and a restart action.
- **No index yet**: the extension asks with the scale estimate in view before
  indexing anything (`bbLsp.autoIndexMode: ask` is the default; `never` is a
  declared no-op). You can also run `Backbencher: Index this workspace now`.
- **Staleness badge after edits**: that is the declared freshness policy —
  results are marked stale until the debounced reindex lands, then the badge
  clears.
