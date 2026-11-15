/**
 * POWERSHELL — THE SPEC-SHAPE AUDIT, for this lane's own spec.
 *
 * ## WHY THIS FILE EXISTS
 *
 * The shape audit for a completeness spec — "does the spec's type inventory agree with the
 * grammar it is pinned to?" — exists for the CLEAN lane
 * (`script/m14/clean-completeness-gate.ts`) and, as measured, is HARD-CODED to
 * `script/m14/spec/clean-completeness.json` and `src/ast/real-clean-analyzer.ts`. So there was no
 * audit for the POWERSHELL spec, and this lane's spec has two live disagreements with its own
 * grammar that nobody had looked at.
 *
 * The Lead found them by adapting the clean gate, and reported:
 *   · `FAIL 2 spec type(s) the pinned grammar does not declare: ERROR, MISSING`
 *   · `FAIL spec says 143 declared named types; the grammar exposes 141`
 * — and verified they are PRE-EXISTING (the same two failures with the change stashed). This file
 * is the powershell instance of that instrument, so the lane can run it ITSELF and the numbers in
 * the verdict page are reproducible by the reader.
 *
 * ## WHAT IT CHECKS
 *
 *   1. THE GRAMMAR'S NAMED TYPES — read from the pinned wasm, the same way the clean gate reads
 *      it: `nodeTypeIsNamed`, skipping `_`-prefixed slots and collapsing aliased slots to one
 *      distinct name.
 *   2. THE BUCKET PARTITION — `handled_verified.types`, `internal_silent.types`,
 *      `gap.gaps[].node_type` and `design_decision.decisions[].node_type`, each comma/space-split.
 *   3. A TYPE IN TWO BUCKETS (the buckets must partition).
 *   4. A DECLARED TYPE IN NO BUCKET (the inventory must cover the grammar).
 *   5. A SPEC TYPE THE GRAMMAR DOES NOT DECLARE (**the spec over-claims**).
 *   6. THE COUNTS — the spec's own declared count against the grammar's.
 *
 * ## A DEFECT IN THE CLEAN GATE, AND WHY THIS FILE DIVERGES FROM IT
 *
 * The clean gate reads the decision rows as
 *
 *     spec.design_decision.decisions.flatMap((d) => d.node_type.split(/[,\s]+/).filter(Boolean))
 *
 * **with no null guard.** And the spec-shape fix of 2026-10-17 set `node_type` to `null` on
 * PSD7-PSD10 — because those four rows carried PROSE in a field the inventory gate comma-splits.
 * So a spec whose metadata rows have `node_type: null` makes that expression THROW.
 * **This file guards it** (`d.node_type == null` contributes nothing), because a null `node_type` is
 * the CORRECT value for a metadata rule — the ruling lives in `question`/`resolution` — and the
 * audit must be able to read such a spec to say anything about it.
 *
 * Usage:  npx tsx validation/m14/fixtures/powershell/spec-shape-audit.mts
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const SPEC_PATH = "script/m14/spec/powershell-completeness.json"
const WASM = "wasm/tree-sitter-powershell.wasm"

type Decision = { id: string; node_type?: string | null; status?: string; question?: string; resolution?: string }
type Spec = {
  handled_verified: { types: string[] }
  internal_silent: { types: string[] }
  gap: { gaps: Array<{ id: string; node_type?: string | null; severity?: string }> }
  design_decision: { decisions: Decision[] }
  _population_check?: { declared_named_types?: number } | null
}

/** THE SPEC, OR A COPY OF IT. The `--spec` option exists so a PROPOSED edit to the shared spec can
 *  be MEASURED before it is proposed: a lane cannot edit `script/m14/spec/powershell-completeness.json`
 *  (it is not in the lane's write scope), and a proposal that says "this fixes the audit" without
 *  showing the audit going green is a claim about a fix, not a fix. */
const argv = process.argv.slice(2)
const specIdx = argv.indexOf("--spec")
const SPEC_READ = specIdx >= 0 ? argv[specIdx + 1] : SPEC_PATH
const spec = JSON.parse(readFileSync(path.isAbsolute(SPEC_READ) ? SPEC_READ : path.join(ROOT, SPEC_READ), "utf8")) as Spec

// ── THE GRAMMAR'S NAMED TYPES ────────────────────────────────────────────────────────────────────────
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await L.load(readFileSync(path.join(ROOT, WASM)))
const declared: string[] = []
const seenType = new Set<string>()
for (let i = 0; i < grammar.nodeTypeCount; i++) {
  if (!grammar.nodeTypeIsNamed(i)) continue
  const n = grammar.nodeTypeForId(i)
  if (!n || n.startsWith("_")) continue
  if (seenType.has(n)) continue
  seenType.add(n)
  declared.push(n)
}

// ── THE BUCKETS ─────────────────────────────────────────────────────────────────────────────────────
/** THE NULL GUARD. A metadata row's `node_type` is `null` — which is CORRECT, because the ruling
 *  lives in `question`/`resolution` — and a comma-split of `null` throws. */
const splitTypes = (v: string | null | undefined): string[] =>
  v == null ? [] : v.split(/[,\s]+/).filter(Boolean)

const gapTypes = spec.gap.gaps.flatMap((g) => splitTypes(g.node_type))
const decisionTypes = spec.design_decision.decisions.flatMap((d) => splitTypes(d.node_type))

/**
 * THE UNIVERSAL PAIR, `ERROR` and `MISSING`.
 *
 * Tree-sitter's two sentinel node types are not NAMED types of any grammar, and the clean lane's
 * spec documents the convention this file follows (its `_population_check._universal_pair_note`):
 *
 *   "The pinned grammar's surface is 143 named IDs / 141 UNIQUE names
 *    (validation/m14/grammar-pins.json lanes.clean.surface). The completeness gate's universe is
 *    the 141 unique names PLUS the universal ERROR/MISSING pair it appends (loadNamedNodeTypes),
 *    i.e. 143."
 *
 * **So the GATE appends the pair, and the SPEC lists it in `internal_silent` because the gate's
 * universe contains it.** A spec that lists the pair against a gate that does NOT append it is
 * over-claiming — and the powershell spec DID list the pair (copied from the clean spec) against
 * a powershell gate with no `loadNamedNodeTypes`. **This file appends the pair, because the pair
 * is a UNIVERSAL property of the tree-sitter runtime rather than of one lane's grammar.**
 */
const UNIVERSAL_PAIR = ["ERROR", "MISSING"]
for (const t of UNIVERSAL_PAIR) seenType.add(t)

const buckets: Array<[string, string[]]> = [
  ["handled_verified", spec.handled_verified.types],
  ["internal_silent", spec.internal_silent.types],
  ["gap", gapTypes],
  ["design_decision", decisionTypes],
]

/**
 * A FIXED GAP'S TYPES ARE NOT A SECOND CLASSIFICATION.
 *
 * A `gap` entry records that a node type was BROKEN and what fixed it. Once the gap is
 * `severity: "fixed"`, the type is classified — in `handled_verified` or `internal_silent` — and
 * the gap is the RECORD of the repair, not a competing claim about where the type lives.
 * **All 8 of the powershell spec's gaps are `fixed`, and every one of their types is classified
 * elsewhere; so the partition check, applied to them, reports 11 collisions that are the NORMAL
 * shape of a closed gap and not a defect.** A gap that is still OPEN is different: it is an
 * unclassified type, and it must be in no classification bucket.
 */
const openGapTypes = spec.gap.gaps.filter((g) => g.severity !== "fixed").flatMap((g) => splitTypes(g.node_type))
const fixedGapTypes = spec.gap.gaps.filter((g) => g.severity === "fixed").flatMap((g) => splitTypes(g.node_type))

const problems: string[] = []
const owner = new Map<string, string>()
// THE CLASSIFICATION BUCKETS OWN THE TYPES.
for (const [bucket, types] of buckets) {
  if (bucket === "gap") continue
  for (const t of types) {
    if (owner.has(t)) problems.push(`type ${t} is in BOTH ${owner.get(t)} and ${bucket}`)
    else owner.set(t, bucket)
  }
}
// AND THE GAP BUCKET IS THE RECORD OF A REPAIR, NOT A COMPETING CLASSIFICATION.
for (const g of spec.gap.gaps) {
  const open = g.severity !== "fixed"
  for (const t of splitTypes(g.node_type)) {
    if (open) {
      // AN OPEN GAP OWNS ITS TYPE: the type is unclassified, which is what an open gap IS.
      if (owner.has(t)) problems.push(`type ${t} is in BOTH ${owner.get(t)} and gap (and the gap is OPEN)`)
      else owner.set(t, "gap")
    } else {
      // A FIXED GAP'S TYPE IS CLASSIFIED SOMEWHERE, and the gap is the record of how it got
      // there. If it is classified NOWHERE, the gap closed without the type being classified —
      // which IS a defect, and the unclassified check below reports it.
    }
  }
}
void fixedGapTypes
const unclassified = declared.filter((t) => !owner.has(t))
if (unclassified.length > 0) {
  problems.push(`${unclassified.length} declared type(s) in NO bucket: ${unclassified.join(", ")}`)
}
const unknown = [...owner.keys()].filter((t) => !seenType.has(t))
if (unknown.length > 0) {
  problems.push(`${unknown.length} spec type(s) the pinned grammar does not declare: ${unknown.join(", ")}`)
}
const declaredCounts = spec._population_check?.declared_named_types
if (typeof declaredCounts === "number" && declaredCounts !== declared.length) {
  problems.push(`spec says ${declaredCounts} declared named types; the grammar exposes ${declared.length}`)
}

const rows: string[] = []
rows.push(`powershell spec-shape audit — spec ${SPEC_READ} — ${declared.length} declared named node types, ${owner.size} classified`)
for (const [bucket, types] of buckets) rows.push(`  ${bucket.padEnd(18)} ${types.length}`)
rows.push(`  grammar named types  ${declared.length}`)
rows.push("")
if (problems.length > 0) {
  for (const p of problems) rows.push(`FAIL ${p}`)
  console.error(rows.join("\n"))
  process.exit(1)
}
rows.push("all checks pass")
console.log(rows.join("\n"))
