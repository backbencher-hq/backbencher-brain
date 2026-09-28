# The screenshot protocol (M55)

**Rule (Truth Rule 5):** a claim about the editor is a claim about **the installed bundle**.
The owner's report of 2026-09-12 was, in three of four complaints, a report about a build from
2026-09-06 which predated the work that fixed them. Every M55 visual claim therefore closes on
a fresh-install frame at the evidence HEAD, read through this protocol.

V1 mechanizes this document; G1 pins it and fails if these steps stop matching the tool.

## 1. Build and install the bundle under test

```
cd ide/vscode
node ./esbuild-extension.mjs          # extension bundle
node ./collect-server-deps.mjs        # the bundled server's runtime deps
npx --yes @vscode/vsce package --allow-missing-repository --no-git-tag-version
code --install-extension bb-lsp-vscode-0.1.0.vsix --force
```

Record, in the evidence JSON: the `sha256` of the installed
`~/.vscode/extensions/backbencher.bb-lsp-vscode-0.1.0/dist/extension.js`, its install time, and
the HEAD commit. A frame captured against a bundle whose hash is not the HEAD's build is
**discarded** — that is the exact failure this protocol exists to prevent.

## 2. The capture session (isolated, never the owner's window)

- The installed extension directory is **copied** into an isolated `--extensions-dir`, so the
  session loads precisely what the owner now has and nothing else.
- A fresh `--user-data-dir` with a pinned `settings.json` (zoom level recorded, minimap off,
  workspace trust off, telemetry off) — the render of a frame is only comparable if the
  settings are.
- The **pinned** VS Code from `.vscode-test/vscode-linux-x64-1.85.0`, launched with
  `--disable-gpu` on a virtual display (`Xvfb :99 1920x1080x24`), detached, window moved to
  `0,0` and sized to the screen before any capture. A frame whose window is offset is
  discarded and re-taken — coordinates must be screen coordinates.
- A window that renders the workbench while another instance holds the profile is not a valid
  session: the log must show `_doActivateExtension backbencher.bb-lsp-vscode` before the first
  flow, and the status bar must show `bb`.

## 3. The fixture (external, declared, as-is)

Owner decision 2026-09-12: the demo workspace is **`$HOME/bb-demo-hub`, used as-is**
— not vendored into the repository. The index is the owner's real `BB_DATA_DIR` (`~/.bb`), so
the session sees the same data the owner sees.

Consequences, stated honestly rather than papered over:

- the fixture is **outside the repo**, so every gate that needs it is an external dependency;
- when the workspace (or its index) is **absent**, the gate is **blocked with a declared
  reason** in its evidence file — never green, never silently skipped;
- the fixture's content hash is recorded per run so a fixture edit is visible in the evidence.

## 4. Flows to drive (each one is a frame)

| # | Flow | Why it exists |
|---|---|---|
| 1 | hover a method at its declaration | T3, T4, T5 read the card here |
| 2 | hover the same method **at a call site** (must resolve to the same identity) | T3 (identity), T1 |
| 3 | `Open in graph` from the hover's actions row | the hub list by file (T3, T5) |
| 4 | the `Call tree` view | T2's shape, the grouping |
| 5 | `Impact analysis` on a symbol with zero callers | the declared empty state |
| 6 | hover a **member** (`constructor`) and `Open in graph` from it | T1's substitution label |
| 7 | `Call hierarchy` from a hover | T2's in-editor leg |

## 5. Reading the frames (how a frame becomes evidence)

- Crops are **mapped back to screen coordinates** before anything is claimed; a coordinate is
  derived from the frame being read, never carried over from an earlier frame.
- Link affordances are located by the editor's link colour; the actions row is the lowest row
  of ≥3 colour clusters in the panel region, with intra-link fragments merged (≤ 14 px) and
  links split at > 40 px — the numbers that made the filing run's clicks land.
- The lower card region is routinely clipped by the hover's max height: a claim about a row
  that is not in the frame is not made (the card is scrolled inside its own bounds first).
- OCR of dim/secondary rows is treated as unreliable; a claim resting on such a row is
  re-derived from the **wire** (`wire-truth.json`) and the frame is cited only for what it
  visibly shows.

## 6. Wire truth (the frame's second opinion)

A byte-framed JSON-RPC probe over `dist/lsp/server.js` (Buffer-based framing — string decoding
corrupts multi-byte UTF-8 split across stdout chunks) records, for the same fixture:
hover at a declaration and at a call site, `bb/graph` usages for a method and for a member,
`prepareCallHierarchy` + incoming + outgoing + one expand, and `textDocument/references`.
Output: `validation/m55/frames/<run>/wire-truth.json`.

Where a frame and the wire disagree, the **wire wins** and the frame is re-examined — that
disagreement is itself a finding (it is how the "usages" defect in T3 was pinned).

## 7. Blocked states (never a silent pass)

The gate reports `blocked` with a reason when: the display tooling (`Xvfb`, `import`,
`xdotool`) is missing; the fixture workspace or its index is absent; the pinned VS Code binary
is absent; or the installed bundle hash does not match the HEAD build. A blocked run never
counts as evidence for a closure.

## The filing run (2026-09-12)

Steps 1–6 as above, on head of `main` at the filing commit, with the demo workspace as-is.
Frames and wire truth are checked in under
[`validation/m55/frames/filing-2026-09-12/`](../../validation/m55/frames/filing-2026-09-12/);
the plan's "filing evidence" table lists each artifact's hash.
