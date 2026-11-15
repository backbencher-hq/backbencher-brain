# `viz-redesign-final` — the emitted documents this pass was verified against

**These files are OUTPUT, not evidence.** The evidence lives in `validation/m13/results/v10.json` (the
browser-driven gate) and `v11.json` (the code map's published surface). This directory exists so a reader can
LOOK at the artifact the gates drive, on a real payload, outside a test fixture.

Regenerate with:

    npx tsx script/m13/emit-viz-preview.mts [target-dir]     # default: src/ast/visualization

**What each file is**

| file | what it is |
| --- | --- |
| `preview-codemap.html`, `preview-graph-regions.html`, `preview-class.html` | the COMPOSED answer `bb_visualize` returns for that view: the studio frame plus the document it mounts |
| `preview-codemap-raw.html`, `preview-graph-raw.html` | the document a studio slot carries, extracted from the composed page — **this is the file to open in a browser**; the composed page wraps it in a frame, so `window.__bbView` is not on the outer page |
| `preview-codemap.png`, `preview-codemap-raw.png` | screenshots taken over CDP, after the page's own errors were collected |

**The trap this README exists to record.** The first attempt to drive the composed page reported
`api missing … page errors: none` and `drawn: {"cells":0,…}`. Nothing was wrong with the code map: the composed
page is a frame, so the document's API and its cells are inside it. Driving the RAW document is what proved the
artifact works on a real payload:

    api: true
    state: {"visibleSymbols":29,"totalSymbols":29,"visibleFiles":4,"totalFiles":4,"layout":"dir","zoom":0.80,…}
    census: ["files=4","symbols=29","lines spanned=2.7k","directory=1"]
    drawn: {"cells":4,"big":4,"bands":58,"names":4}
    picked: {"visible":true,"title":"CODE_MAP_CSS · constant · code-map-renderer.ts:68"}
    page errors: none

---

## The pass itself, 2026-10-16 (HEAD `368a64289`, branch `analyzers/ontology-laptop-b`)

**Green — every M13 verifier that touches this work, re-run after the last edit:**

    10 × script/m13/verify-visualize-*.ts                     PASS
    script/m13/verify-visualize-browser.ts (npm run verify:viz-browser)
                                                              V10: VERIFIED (53/53 passed, 9 negatives)
    script/m13/verify-evidence.ts                             PASS  (B2/B3 — the M64 records that were
                                                              misfiled in this corpus now live in their own)
    script/m13/verify-contract-authority.ts                   PASS
    script/m13/verify-edit-batch.ts                           PASS  E13: VERIFIED (61/61, 19 negatives)
    script/verify-tool-docs.ts · verify-tool-page-claims.ts · verify-tool-registry.ts ·
    verify-public-surface.ts · verify-integration-docs.ts · m31/* · m35/verify-docs-staleness.ts
                                                              PASS

**Two ledger defects found and fixed in this pass:**

1. **`E13` claimed `issue: "M13.18"`** — which the ledger assigns to bb_search's `S1`. A record whose issue id
   denotes a different issue is exactly what the evidence governance refuses; the batch issue now has its own
   entry, **`M13.66` (E13)**, in `script/m13/issues.ts`, and the record was re-emitted.
2. **The ledger's own tripwire was stuck at 58 while the array held 65** — `bun script/m13/issues.ts --plan`
   threw `expected 58 issues, got 65`, so the ledger's plan/create modes were un-runnable. Now 66 / 66, with
   the duplicate check comparing against the array rather than a second literal.

**One flake, measured rather than assumed.** `script/m31/tool-mode-corpus.ts --check` failed on its first run
of the day (drift in `bb_ask.answer`, `bb_doc.feature`) and passed on the next two, unchanged:

    baseline: "…5 other symbol(s) scored within that margin of the best…"    fresh: "…only 15 of 20 indexed
    symbols (75%) have embeddings…"                                          and 1 file / 1 symbol where the
                                                                             baseline recorded 5 / 15

Both drifting fields describe the harness's OWN fixture index (embedding availability and index scope), not the
tools' shape — a run-to-run state flip in the fixture, not behaviour drift. The committed baseline was updated
in this pass only for the `view`/`layout`/`classMembers` keys the redesign added; `bb_visualize` is not among
the drifting invocations.

---

## §3 · The one gate that went red, and what it turned out to be (CORRECTED)

**The first version of this section named the wrong cause and it is replaced rather than deleted.** It read the
enrichment warning `dangling source edges cannot be enriched {"danglingSources":3,…}` as three broken call edges and
suspected the concurrent lane's indexer edit. Both were wrong, and the measurements that say so are below.

**(a) The warning is not about broken edges.** Querying the fixture's own rows: the three "dangling source" rows are
`exports` rows whose `source_symbol_id` is **NULL** — file-level edges, by design (`source_external = "app"`).
`NOT EXISTS (SELECT 1 FROM brain_symbol s WHERE s.id = r.source_symbol_id)` is TRUE for a NULL source, so the
counter conflates a declared NULL with a dangling reference. On this fixture there are **zero** rows with a non-null
source that names no symbol. Nothing was unresolvable; nothing was ever broken. The warning's number is the
file-level edge count wearing the wrong label.

**(b) The `calls` edge was clean, and the gate still flagged it.** The row is
`calls caller→alive`, confidence **0.9**, evidenceClass **usage_contextual** — an anchored clean edge, which the
two-channel orphan gate treats as decisive. It did not clear. The cause was one layer down, in the **storage
adapter**: under `bun`, `bun:sqlite` reads a named parameter only from a key spelling it `@name`, so the gate's
`BIND = { projectId, minConf, t0…t7 }` bound **nothing** — `usedIds` was empty and every candidate was reported,
with internal numbers that looked perfectly consistent.

**MEASURED, both drivers, one statement:** `bun run` + `{projectId,t0,t1}` → `[]` (silent); `{'@projectId','@t0',…}`
→ the row; `npx tsx` (better-sqlite3) → the row for the un-prefixed spelling and a throw for the prefixed one.
Fixed in `src/storage/db.bun.ts` (the adapter now translates the spelling bun needs, passing existing prefixed keys
through untouched). After the fix, on the same fixture: **3 findings → 2**, and

    bun run script/m13/verify-patterns-e2e-corpus.ts     P4: VERIFIED (60/60 passed, 8 negatives)

**Full write-up, including what un-blinding revealed and how it was attributed by runner:**
[`reviews/BUN-NAMED-PARAMETERS-BIND-NOTHING.md`](../../../../reviews/BUN-NAMED-PARAMETERS-BIND-NOTHING.md).

**Two other gates were green under `bun` for the same reason and are red under `npx tsx` as well**, so they are
standing state, not this change's damage: `script/verify-patterns.ts` (`orphan.ts flagged as orphaned file`) and
`script/m20/verify-patterns-orphan-semantics.ts` (two checks). The first is reporting a real defect: `main.ts`'s
`c.run()` — `c` is a `UsedClass` — is stored as `calls main.ts → run, orphan.ts` at 0.9, i.e. a same-named method
resolved to the other file's declaration, which is what clears the genuinely-dead `orphan.ts`.

**Note the direction of the corpus comparison:** the gate recorded 0 checks mentioning Go before this pass and 9
now — the Go corpus is measured for the first time (see
`validation/m14/verification/THE-CENSUS-ASKED-FOR-A-DIRECTORY-THAT-DOES-NOT-EXIST.md`).
