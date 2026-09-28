# M44 Spot-Check Pack (§8.5) — for the owner

The achieved/not-achieved verdict for The Understandable Hub (IDE v7) is the
owner's, never the gate's (IDE Honesty Contract §8.5). This pack is what to
try and what is known-not-done, so the verdict can be made on evidence.

## What to try (each item is machine-verified already; try them by hand)

1. Index any project in a wave-1 language, open it in VS Code with the built
   extension, and click **Open in graph** on a hover: the hub panel opens
   with list-by-file / list-by-caller / call-tree views; every row is
   name-first with a visible click affordance (chevron + hover highlight),
   group headers carry counts, and the header counts match the rendered
   rows (never raw-row drift).
2. Click a hub row → the editor reveals that symbol's index-stored line.
   Stale rows navigate and are labeled — never blocked, never silent.
3. Hover a symbol with more usages than fit: click **+N more — show all
   usages** → the editor's native references view (or, when unavailable,
   our usages list) — never a message-only dead end.
4. Hover a constructor / `new Greeter(…)` and click **Impact analysis**:
   the impact set renders with the owning-declaration note
   (`resolved through owning declaration`) — not the old
   `symbol "constructor" is not in the index` error.
5. Check the ONE legend in the hub panel: five evidence tiers + the
   enrichment row + the staleness section (fresh/stale/missing/unknown),
   visually distinct and consistent with the hover legend.
6. Edit a file → the stale marker appears; after the debounced reindex it
   returns fresh (honesty follows the index, §4).
7. Run the same checks in a fork (Cursor/Antigravity if installed) — the
   same VSIX drives the same server there.

## Known-not-done (recorded, not silent)

- **OpenVSX publish / listing regeneration**: not executed — the publish
  token is owner-held. Run `npx ovsx publish` from ide/vscode with OVSX_PAT
  set when ready, then regenerate the listing from the precision ledger.
- **Windsurf fork leg**: blocked with reason (CLI not installed on this
  box) — install and re-run `npx tsx script/m25/run-fork-e2e.mts`, or
  accept the blocked record for v7.
- **darwin/windows in-repo machine records**: the os-matrix workflow runs
  the native legs on push; in-repo persistence of verified records is an
  owner/CI action (win32 budget variance already owner-waived, M42 record).
- **Tool-surface unification (M44 co-agent track)**: the IDE lane consumes
  the unified surfaces as they land; IDE-side verification here is
  limited to the IDE lane's own surfaces.
- **The final achieved/not-achieved verdict**: this box. Record it here or
  in the X1 issue when you have run the checks above.

## Verdict

_Owner fills this in after the spot check._
