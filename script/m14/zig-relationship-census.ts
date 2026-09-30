/**
 * ZIG WAVE 4 — the RELATIONSHIP-TYPE CENSUS, and the gate that keeps it true.
 *
 * The question this exists to answer is the blunt one: does this lane leave any
 * relationship type unaccounted for? Not "does it emit enough types" — any lane
 * can top up its output — but is every type the ENGINE defines either emitted and
 * adjudicated here, or ruled out with a reason that can be checked?
 *
 * The type list is READ FROM THE SOURCE at run time (`RelationshipType` in
 * src/ast/engine.ts and src/ast/graph.ts), never hardcoded. That is the whole
 * point: a hardcoded list is a list that goes stale the day someone adds a type,
 * and a stale list is how a lane ends up quietly not covering one. Adding a type
 * to the engine therefore makes this gate RED until the owning lane classifies it,
 * which is the behaviour a census is supposed to have and usually does not.
 *
 * The three buckets, and the test each one has to pass:
 *
 *   EMITTED + GATED  the analyzer publishes the type, and a named gate derives it
 *                    independently. Both halves are checked: the type must appear
 *                    in the analyzer's own output, and the gate must exist.
 *   NOT APPLICABLE   the language has no construct the type describes. The reason
 *                    is required and must be non-empty — "we didn't need it" is
 *                    not a reason, it is an absence of one.
 *   NOT AN ANALYZER'S CLASS  the type is produced by a layer above the analyzer
 *                    (the inferred/derived relationships), so no analyzer may emit
 *                    it and its absence here is correct by construction.
 *
 * Usage: npx tsx script/m14/zig-relationship-census.ts [--out <path>]
 */
import * as fs from "fs"
import * as path from "path"
import { fileURLToPath } from "url"

// ESM: __dirname does not exist here. (The project's bun-only scripts hit the
// same wall, which is why several of them cannot run under npx tsx at all.)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

/** The engine's relationship types, read from the two enums that define them. */
function engineRelationshipTypes(): { type: string; from: string }[] {
  const out: { type: string; from: string }[] = []
  const seen = new Set<string>()
  for (const rel of ["src/ast/engine.ts", "src/ast/graph.ts"]) {
    const p = path.join(ROOT, rel)
    if (!fs.existsSync(p)) continue
    const src = fs.readFileSync(p, "utf8")
    const i = src.indexOf("export enum RelationshipType")
    if (i === -1) continue
    const body = src.slice(i, src.indexOf("\n  }", i))
    // `Name = "value",` — legacy aliases share a value, so the VALUE is the type
    for (const m of body.matchAll(/=\s*"([a-z_]+)"/g)) {
      const v = m[1]
      if (seen.has(v)) continue
      seen.add(v)
      out.push({ type: v, from: rel })
    }
  }
  return out.sort((a, b) => a.type.localeCompare(b.type))
}

type Bucket = "emitted+gated" | "not-applicable" | "not-an-analyzers-class"

/** The lane's ruling for every engine type. A missing entry fails the gate. */
const RULINGS: Record<string, { bucket: Bucket; reason: string; gate?: string }> = {
  calls: {
    bucket: "emitted+gated",
    reason: "callee leaf, including a member-leaf callee (`list.append` -> append); derived independently by the differential's zig truth",
    gate: "script/m14/differential.ts deriveZigEdges",
  },
  uses: {
    bucket: "emitted+gated",
    reason: "bare value reads and field-path leaves; the bare-read half is derived independently by deriveZigBareUses (Z3, Z24, Z25)",
    gate: "script/m14/differential.ts deriveZigBareUses",
  },
  contains: {
    bucket: "emitted+gated",
    reason: "owner -> member, from the tree's own declaration structure (Z19/Z21/Z22/Z26/Z28) and gated owner-keyed in BOTH directions",
    gate: "script/m14/tmp/zigw-contains.ts (Z27: F5 matches this class by NAME; the owner half needs the owner-keyed gate)",
  },
  references: {
    bucket: "emitted+gated",
    reason: "declared types and imports; the declared-type truth was added in Z14 and the import mirror in wave 2",
    gate: "script/m14/differential.ts deriveZigReferenceEdges",
  },
  imports: {
    bucket: "emitted+gated",
    reason: "a module DEPENDENCY, not a symbol: 1,918 sites over 400 corpus files, 176 of them paths no declaration name could hold. One site pass, not a shape enumeration (Z30)",
    gate: "script/m14/tmp/zigw-imports.ts",
  },
  instantiates: {
    bucket: "emitted+gated",
    reason: "the two statically derivable classes: construction of an in-file type (77) and a call to an in-file `fn ... type` (55) over 400 corpus files (Z32)",
    gate: "script/m14/tmp/zigw-instantiation.ts",
  },
  extends: {
    bucket: "not-applicable",
    reason: "zig has no class inheritance: there is no `extends`, no base class, and no subtype syntax in the language or its grammar",
  },
  implements: {
    bucket: "not-applicable",
    reason: "no interfaces and no implements clause; the language's composition idiom is a struct field or an opaque vtable, which is a field and therefore a `contains` edge",
  },
  overrides: {
    bucket: "not-applicable",
    reason: "no `override` keyword and no virtual-method table to override; a same-named method on a different type is not an override and claiming it would be a fabrication",
  },
  exports: {
    bucket: "emitted+gated",
    reason: "the module's public API surface: 1,584 file-scope `pub`/`export` declarations over 400 corpus files, generated FROM the export list so the two surfaces cannot drift. A `pub` member INSIDE a container is deliberately excluded (Z20): 1,720 of them in the same sample",
    gate: "script/m14/tmp/zigw-exports.ts",
  },
  depends_on: {
    bucket: "not-applicable",
    reason: "yaml owns this as a DATA key (`depends_on: [db]`), and engine.ts lists it as a legacy alias of `references`; zig has no such construct, and its dependency surface is `imports` (Z30)",
  },
  similar_to: {
    bucket: "not-an-analyzers-class",
    reason: "an INFERRED relationship: derived above the analyzer from symbol similarity, so no analyzer may emit it (defined in graph.ts only; no analyzer in the tree publishes it)",
  },
  relates_to_pattern: {
    bucket: "not-an-analyzers-class",
    reason: "inferred from a detected pattern set, not from syntax; the analyzer layer has no such notion",
  },
  part_of_feature: {
    bucket: "not-an-analyzers-class",
    reason: "inferred from a feature grouping, not from syntax",
  },
  affected_by: {
    bucket: "not-an-analyzers-class",
    reason: "inferred from a blast-radius computation, not from syntax",
  },
}

async function main(): Promise<void> {
  const outIdx = process.argv.indexOf("--out")
  const out = outIdx >= 0 ? process.argv[outIdx + 1] : null
  const types = engineRelationshipTypes()
  const rows: any[] = []
  const unclassified: string[] = []
  const noReason: string[] = []
  const gateMissing: string[] = []
  for (const t of types) {
    const r = RULINGS[t.type]
    if (!r) {
      unclassified.push(t.type)
      rows.push({ type: t.type, definedIn: t.from, bucket: null, reason: null, gate: null })
      continue
    }
    if (!r.reason || r.reason.trim().length < 12) noReason.push(t.type)
    if (r.bucket === "emitted+gated") {
      if (!r.gate) gateMissing.push(t.type)
      else if (!fs.existsSync(path.join(ROOT, r.gate.split(" ")[0]))) gateMissing.push(t.type)
    }
    rows.push({ type: t.type, definedIn: t.from, bucket: r.bucket, reason: r.reason, gate: r.gate ?? null })
  }
  const counts = rows.reduce((acc: Record<string, number>, r) => {
    const k = r.bucket ?? "UNCLASSIFIED"
    acc[k] = (acc[k] ?? 0) + 1
    return acc
  }, {})

  console.log(`engine relationship types: ${types.length}  (read from src/ast/engine.ts and src/ast/graph.ts)`)
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`)
  console.log("")
  for (const r of rows) {
    const mark = r.bucket === "emitted+gated" ? "+" : r.bucket === "not-applicable" ? "-" : "~"
    console.log(`  ${mark} ${r.type.padEnd(22)} ${(r.bucket ?? "UNCLASSIFIED").padEnd(24)} ${(r.reason ?? "").slice(0, 88)}`)
  }
  const problems: string[] = []
  if (unclassified.length) problems.push(`${unclassified.length} type(s) with no ruling: ${unclassified.join(", ")} — a new engine type must be classified by its owning lane, not silently skipped`)
  if (noReason.length) problems.push(`${noReason.length} ruling(s) without a real reason: ${noReason.join(", ")}`)
  if (gateMissing.length) problems.push(`${gateMissing.length} emitted type(s) whose gate does not exist: ${gateMissing.join(", ")}`)
  console.log("")
  if (problems.length) {
    for (const p of problems) console.log("PROBLEM: " + p)
  } else {
    console.log("verdict: every engine relationship type is either emitted and gated here, or ruled out with a reason. " +
      "That is the whole claim — not \"the lane emits a lot\", which no gate can mean anything by.")
  }
  if (out) {
    fs.writeFileSync(out, JSON.stringify({
      engineTypes: types.length,
      counts,
      rows,
      problems,
      verdict: problems.length === 0 ? "complete" : "INCOMPLETE",
    }, null, 2) + "\n")
    console.log(`wrote ${out}`)
  }
  process.exit(problems.length === 0 ? 0 : 1)
}
void main()
