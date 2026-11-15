# PROPOSAL (xml) — section B's "EMITTED" set includes OTHER LANGUAGES' output; filter the fixture dir by the lane's own sources

**From:** xml lane owner · **date:** 2026-10-17 · **branch:** `analyzers/ontology-laptop-b`
**Touches:** `script/m14/completeness-inventory.ts` (Lead-owned — this lane may not edit it).
**Evidence:** the per-file split reproduced with the inventory's own loop; JAVA-STATE-free, self-contained in
this file.

## THE ROW

```
xml SECTION FAIL: section-b-relationship-kinds — EMITTED but absent from requiredKinds: instantiates
```
The Lead's framing offered two branches: *"if the edges are CORRECT → add a fixture pinning them + propose the
one-line contract addition; if they are FALSE edges → remove or gate the emission site."*

**NEITHER BRANCH APPLIES: the xml analyzer does not emit `instantiates` at all.** There is no emission site to
pin and none to remove. The "EMITTED" set is polluted by the fixture directory's own helper instruments.

## THE MEASUREMENT — section B's loop, reproduced exactly, split by DETECTED language

`emittedKinds()` reads `validation/m14/fixtures/xml/`, keeps every file that is not `.json`, and runs
`ASTEngine.parseFile` on each. That directory holds **84 non-.json files**; parsing them yields:

```
files in dir=84 parsed=66 threw=18   (the 18 throws are .txt/.patch/.sh gate transcripts: unsupported extensions, skipped)

typescript      33 file(s)  kinds=[calls, contains, extends, imports, INSTANTIATES, references, uses]
xml             32 file(s)  kinds=[calls, contains, extends, imports, overrides, references, uses]
bash             1 file(s)  kinds=[calls, contains, uses]

UNION (what section B reports): [calls, contains, extends, imports, INSTANTIATES, overrides, references, uses]
XML-ONLY (what the lane actually emits): [calls, contains, extends, imports, overrides, references, uses]
DIFFERENCE (foreign kinds section B attributes to xml): [INSTANTIATES]
```

The 33 TypeScript files are the lane's own instruments (`ontology-census.mts`, `coverage-census.mts`,
`store-determinism.mts`, …). The **typescript** analyzer runs on them and emits `instantiates` from their
`new X()` expressions; section B has no language check, so that kind is billed to xml.

**Two independent confirmations that xml cannot emit it:**
1. `grep -c "RelationshipType.Instantiates" src/ast/real-xml-analyzer.ts` → **0** (also 0 for the bare string
   `"instantiates"` and for any table form). The analyzer's emitted set is exactly the 7 kinds above.
2. The lane's whole-population firing row: `instantiates` is in the SILENT list (see `XML-STATE.md` §3).

**So a `requiredKinds` entry for `instantiates` would name a kind this lane can never emit** — it would make the
row green by writing down something untrue, which is the failure mode this programme exists to catch.

## THE PATCH I RECOMMEND (Lead applies; `completeness-inventory.ts` is yours)

Keep only the fixture sources this lane's analyzer is FOR. The data-driven form, which needs no
lane→language table and cannot silently empty a lane: the lane's source extensions are the extensions of the
files that carry an `.expectation.json` sibling — by construction those are the lane's own sources.

```ts
// in emittedKinds(cfg):
const all = fs.readdirSync(dir).filter((f) => {
  if (f.endsWith(".json")) return false
  try { return fs.statSync(path.join(dir, f)).isFile() } catch { return false }
})
// ONLY THE LANE'S OWN SOURCES. A fixture dir also holds helper instruments (.mts probes,
// .sh gate drivers, .txt censuses). Parsing them runs THEIR language's analyzer, and every
// kind it emits is billed to THIS lane: measured on xml, 33 typescript probes contributed
// `instantiates`, a kind the xml analyzer has no emission site for (0 occurrences of
// RelationshipType.Instantiates). The lane's sources are the files its expectations pair
// with, so take the extension set from those pairs rather than from a hand-kept table.
const paired = fs.readdirSync(dir)
  .filter((e) => e.endsWith(".expectation.json"))
  .map((e) => e.slice(0, -".expectation.json".length))
const laneExts = new Set(
  paired.map((b) => { const m = /\.([A-Za-z0-9]+)$/.exec(b); return m ? m[1].toLowerCase() : "" }).filter(Boolean),
)
const sources = laneExts.size === 0
  ? all                                     // no pairs -> behave exactly as today
  : all.filter((f) => laneExts.has((/([A-Za-z0-9]+)$/.exec(f)?.[1] ?? "").toLowerCase()))
```

**Guard against the vacuous pass** (the other half of the programme's rule): if `laneExts.size === 0`, keep the
old behaviour AND say so in the row's detail (`emitted: … (no expectation pairs; source filter NOT applied)`),
so a lane whose filter excludes everything cannot read as clean.

## FLEET IMPLICATION, STATED NOT FIXED

This is not an xml-only defect: any lane whose fixture directory contains helper instruments is over-reporting
its emitted kinds the same way. The recent central pass that added "THE ROW NOW NAMES WHAT THE ANALYZER
PUBLISHES" (`requiredKinds`) to ~19 lanes ran the same polluted loop, so **some additions may name kinds the
lane's analyzer never emits — and every such addition makes the forward check (required ⇒ pinned) fail only if
the lane has no fixture for the foreign kind.** A one-line filter closes the class. Recommend re-running the
inventory across all lanes after the patch and reading any row whose emitted set SHRINKS as a measurement of
the pollution, not of the lanes.

## WHAT I DID NOT DO

I did not edit `completeness-inventory.ts` (yours), and I did not add `instantiates` to the spec's or the
inventory's required kinds — either would be a false statement about the lane. The lane's own durable negative
is `validation/m14/fixtures/xml/five-kind-boundary-172.xml`, which exercises every kind xml DOES emit and
forbids `instantiates` by name.
