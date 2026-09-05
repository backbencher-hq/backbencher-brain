# M42 Spot-Check Pack (§8.5) — for the owner

The achieved/not-achieved verdict for The Interactive Hover (IDE v6) is the
owner's, never the gate's (IDE Honesty Contract §8.5). This pack is what to
try and what is known-not-done, so the verdict can be made on evidence.

## What to try (each item is machine-verified already; try them by hand)

1. Index any project in a wave-1 language, open it in VS Code with the built
   extension, and hover a symbol: the hover shows the evidence tier
   (structural / import_based / usage_contextual / reference_qualified /
   inferred), a staleness marker, the connected summary, clickable usages,
   and the action links (open in graph / impact / call hierarchy).
2. Click a usage link in the hover → the editor reveals the index-stored line.
3. Click "Open in graph" on a hover → the hub panel opens with list-by-file /
   list-by-caller / call-tree views; click a usage row → the editor reveals
   that symbol's line.
4. Open the graph webview: edges carry evidence badges + the legend
   (five tiers + the enrichment annotation row).
5. Edit a file, then hover again: the stale marker appears until reindex
   completes (honesty follows the index, §4).
6. Run "Backbencher: Show status" — every fact carries its claim level.
7. Try the agents' doors: bb_annotate a symbol, hover it — the annotation
   renders author-labeled, never as index fact.

## Known-not-done (recorded, not silent)

- **OpenVSX publish**: not executed — the publish token is owner-held.
  Run `npx ovsx publish` from ide/vscode with OVSX_PAT set when ready.
- **macOS / Windows machine legs**: not executed on this linux dev box —
  the CI workflow (.github/workflows/os-matrix.yml) executes them on
  GitHub-hosted runners at the next push; until a runner goes green the
  machine-blocked records (E7-darwin.json / E7-windows.json) stand.
- **The final achieved/not-achieved verdict**: this box. Record it here or
  in the X1 issue when you have run the checks above.

## Verdict

_Owner fills this in after the spot check._
