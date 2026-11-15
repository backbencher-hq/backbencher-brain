# PROPOSAL — `loadNamedNodeTypes` must union a lane's `companionWasm` (markdown's section A, and two other lanes)

**Lane: markdown · owner: direction-matrix · 2026-10-17 · status PROPOSED.**
**`script/m14/completeness-inventory.ts` is Lead-owned; nothing here is applied to it.** Gate mtime at every
reading below: **2026-10-17T15:24:31**; analyzer mtime `src/ast/real-markdown-analyzer.ts` recorded with each run.

## §1 THE DEFECT, MEASURED

`completeness-inventory.ts --lang markdown` → **rc=1**, and section A is the only line printed:

```
markdown COMPLETENESS FAIL: 19 classified row(s) no longer produced by the wasm (grammar drift?):
  link_text, full_reference_link, collapsed_reference_link, shortcut_link, uri_autolink, email_autolink,
  image, code_span, code_span_delimiter, emphasis, emphasis_delimiter, hard_line_break, html_tag,
  image_description, inline_link, latex_block, latex_span_delimiter, strikethrough, strong_emphasis
```
**This is a GATE DEFECT, not grammar drift.** Markdown is a TWO-GRAMMAR lane: the analyzer loads
`wasm/tree-sitter-markdown.wasm` **and** `wasm/tree-sitter-markdown_inline.wasm` (spec `_comment`: *"Every
public NAMED node type of BOTH pinned wasms is in exactly one bucket"*), and the gate's own config says so:

```ts
companionWasm?: string[]                     // declared at completeness-inventory.ts:61
...
markdown: { wasm: "tree-sitter-markdown.wasm",
            companionWasm: ["tree-sitter-markdown_inline.wasm"], ... }   // set at :926
```
**…but `loadNamedNodeTypes(cfg)` reads only `fs.readFileSync(path.join(ROOT, "wasm", cfg.wasm))` — it never
consults `companionWasm`.** So the inline grammar's node types are invisible to section A, and every inline row
in the spec reads as "no longer produced by the wasm".

**Measured against the correct union (read-only probe, both pinned wasms loaded):**
```
block  wasm: 66 named types · inline wasm: 36 named types · UNION: 72
STALE against the union:       0        <- the 19 rows are real, produced by the companion wasm
UNCLASSIFIED against the union: 0        <- the spec is already correctly reconciled with BOTH grammars
inline-only names: 27                    <- every one of them is classified in markdown-completeness.json
```
**So the markdown spec needs NO edit for section A. Deleting the 19 rows would delete the CORRECT
classification of real node types — which the loader's own comment forbids: *"when they disagree, one of them
is wrong, and the fix is never to delete the correct row."***

**CONSEQUENCE: sections B–H are NOT EVALUATED.** `runLang` aborts before printing them (rc=1, zero `section-`
lines), so markdown's B–H state is unknown until the loader fix lands — that is the one thing standing between
this lane and its section list.

## §2 THE EXACT DIFF (Lead-owned file)

```diff
 async function loadNamedNodeTypes(cfg: LangConfig): Promise<string[]> {
   ...
-  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", cfg.wasm)))
   const named: string[] = []
-  for (let i = 0; i < g.nodeTypeCount; i++) {
-    if (!g.nodeTypeIsNamed(i)) continue
-    const n = g.nodeTypeForId(i)
-    if (n && !n.startsWith("_")) named.push(n)
-  }
+  // THE UNION OF EVERY GRAMMAR THE LANE PINS. `companionWasm` was DECLARED in LangConfig and SET by
+  // markdown's row, but this loader never read it — so a two-grammar lane's companion was invisible to
+  // section A and every node type it produces read as "grammar drift". Measured on markdown: 19 inline
+  // types falsely stale; against the union, 0 stale and 0 unclassified (block 66 + inline 36 = 72).
+  // THREE LANES PIN TWO WASMS (markdown, julia, typescript) — see §3 before landing.
+  for (const w of [cfg.wasm, ...(cfg.companionWasm ?? [])]) {
+    const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", w)))
+    for (let i = 0; i < g.nodeTypeCount; i++) {
+      if (!g.nodeTypeIsNamed(i)) continue
+      const n = g.nodeTypeForId(i)
+      if (n && !n.startsWith("_") && !named.includes(n)) named.push(n)
+    }
+  }
   for (const u of ["ERROR", "MISSING"]) if (!named.includes(u)) named.push(u)
   return named
 }
```

## §3 FLEET IMPACT — THREE LANES PIN TWO WASMS, SO LAND THIS TOGETHER

Measured on the analyzers (`grep -c 'tree-sitter-*.wasm'` per `src/ast/real-*-analyzer.ts`):
**`real-markdown-analyzer.ts`, `real-julia-analyzer.ts`, `real-typescript-analyzer.ts` each load two wasms.**
- **markdown**: ready — 0 stale / 0 unclassified against the union.
- **julia / typescript**: their specs were reconciled against ONE wasm (the loader's view). With the union,
  companion-only types become visible — **they will be UNCLASSIFIED and section A will fail for them unless
  their specs already classify every companion type.** This is the good failure (silence would otherwise stay
  invisible), but it means **the loader fix must be followed by a full `--lang julia --lang typescript` run and,
  if red, a classification pass on those two specs** — the same shape as markdown's, not a regression of the
  fix.

## §4 WHAT THE LANE NEEDS NEXT

1. Lead lands §2 → markdown prints its full section list.
2. This lane closes any red B–H section (config inputs already visible: `requiredKinds`
   `["contains","uses","imports","references"]`, docs `markdown.md` + `markdown.md`,
   `differential-markdown`, `perfKey scala3:markdown`, E/F = Lead's central sweep).
3. Then the `GATED_LANGS` proposal for markdown, carrying the Tailwind-equivalent honesty: whatever the
   section list shows, no section is claimed beyond what the gate reads.
