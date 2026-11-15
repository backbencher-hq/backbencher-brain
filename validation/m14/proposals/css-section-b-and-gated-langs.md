# PROPOSAL — css section B's `calls` row line, the `emittedKinds` extension filter, and css's GATED_LANGS entry

**Lane: css · owner: direction-matrix · 2026-10-17 · status PROPOSED (all three changes are in Lead-owned files).**
Measured with `completeness-inventory.ts` mtime **2026-10-17T15:08:17**; css spec edit already landed by this lane
(+8 lines, `CSS-L4`); no Lead-owned file has been edited.

## §1 THE MEASUREMENT THAT ORDERS THESE THREE CHANGES

`--lang css` today: **7/8 sections pass; B fails** with `EMITTED but absent from requiredKinds: calls, instantiates`.
Split the same `emittedKinds` call by fixture-source extension:

```
.css (23 sources): contains 47 · imports 19 · references 18 · uses 7 · overrides 6   <- no calls, no instantiates
.ts  (11 probes): calls 1227 · references 134 · imports 99 · uses 60 · contains 57 · instantiates 5
```
**`instantiates` is TypeScript's, not css's.** And **`calls` is genuinely css's but the probe misses it**:
`run-fixtures.ts --lang css` is **23 pass / 0 fail**, and
`keyframes-redefinition-overrides.expectation.json:89` positively pins
`{"type":"calls","source":".spinner","target":"…::fade"}` — an `animation:` reference to a `@keyframes`
declaration, emitted by the production pass and not by raw `ASTEngine.parseFile(file, src)`.

## §2 CHANGE 1 — WITHDRAWN (Lead ruling 2026-10-17): css's `calls` is recorded as an OPEN LIMITATION, not a row line

**The Lead's ruling: do not fabricate a row line for a kind the gate's own reader cannot observe.** The
production-only `calls` emission (keyframes reference) stays under-described by exactly one kind and is recorded
as an open limitation in `CSS-STATE.md` §1; the remedy is a gate reader that runs the production path, not a row
edit. The diff below is kept only as the record of what was considered and why it was NOT applied.

### (withdrawn) the row line as originally proposed

```diff
-    requiredKinds: ["uses", "references", "contains", "imports", "overrides"],
+    // `calls` is ADDED: the analyzer emits it in production for a keyframes reference (`animation: fade` ->
+    // the `fade` @keyframes declaration), and the lane's own `keyframes-redefinition-overrides` fixture
+    // positively pins the edge (run-fixtures --lang css: 23/23). The section-B reverse check cannot see it
+    // through raw `parseFile`, so this line closes the gap the check reports, with the pin as evidence.
+    // `instantiates` is deliberately NOT added: measured 5, all from the lane's `.ts` probe scripts, zero from
+    // any `.css` source — css has no instantiation construct, and naming it would fabricate a contract row.
+    requiredKinds: ["uses", "references", "contains", "imports", "overrides", "calls"],
```

## §3 CHANGE 2 — `emittedKinds` must read the LANE'S sources, not every file in the dir

**Current behaviour:** `readdirSync(cfg.fixturesDir)` keeps every non-`.json` regular file and runs
`ASTEngine.parseFile(dir/file, src)`, which **routes by extension** — so a lane's `.ts` / `.mts` / `.py` probe
scripts are parsed by ANOTHER language's analyzer and their relationship kinds are attributed to the lane.
That is a false positive for every lane with probes in its fixtures dir (and the same section's forward half is
unaffected). **Two defects in one measurement, and it is likely why some of the 41-kind wave was needed.**

```diff
   const sources = fs.readdirSync(dir).filter((f) => {
     if (f.endsWith(".json")) return false
     try { return fs.statSync(path.join(dir, f)).isFile() } catch { return false }
+  }).filter((f) => {
+    // ONLY THE LANE'S OWN SOURCES. `ASTEngine.parseFile` routes by extension, so a `.ts` probe in a css
+    // fixture dir is parsed by the TYPESCRIPT analyzer and its kinds are charged to css. The emitted set
+    // must describe the lane's analyzer over the lane's inputs, not the fleet over a directory listing.
+    const ext = path.extname(f).slice(1).toLowerCase()
+    return cfg.sourceExtensions.has(ext)   // declared per lane beside `wasm`/`fixturesDir`
   })
```
`sourceExtensions` is not a new concept — the lane config already knows its grammar (`wasm`) and every other
consumer of the lane's population filters by extension. Alternatively, the gate can call the lane's analyzer
directly instead of the router; either closes it.

**A second, smaller residual:** even filtered, raw `parseFile` does not run production post-passes (that is why
`calls` was invisible). The row line in §2 covers css; **a lane that needs the same evidence for a
production-only kind should be able to record it in a declared `emittedKinds` list** — proposed only if you want
a generic mechanism, not required for css.

## §4 CHANGE 3 — add css to `GATED_LANGS` once 8/8

**After Changes 1–2**, `--lang css` is expected **8/8** (E/F are your central sweep and already pass:
`svelte:css missing=0 unexplained=0`, `1.408 ms/file`). Then:

```diff
-const GATED_LANGS = [ ... "scss", ... ]   // whatever the current list is
+const GATED_LANGS = [ ... "scss", "css", ... ]
```
**Evidence carried with the entry:** fixtures **23 pass / 0 fail**; docs section passes; section A is
84 grammar types in disjoint buckets with 0 gaps; section D pins 3 evidence classes; section H has 12
cross-language checks; **and the Tailwind surface is recorded as `CSS-L4` in the lane's spec with 2,939 `@apply`
occurrences measured invisible — a declared gap, so the certificate does not overclaim.**

## §5 WHAT IS NOT PROPOSED

* **Not** an `instantiates` row line — measured to be another language's kind.
* **Not** the `@apply`-utility emission pass in this wave — it is priced in `CSS-L4` with its falsifier
  (~2,939 references over the 28 measured files) and belongs to a separate lane iteration, not to the
  gate-closing wave.
* **Not** any fixture edit — the 23/23 suite is the evidence, not an obstacle.
