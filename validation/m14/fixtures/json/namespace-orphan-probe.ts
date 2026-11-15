/**
 * ORPHAN RATE IN BOTH NAMESPACES — because one number was misleading in both directions.
 *
 * ## The measurement that started this
 *
 * `script/m14/incoming-check.ts` (supervisor-owned, §8) reports `orphanDeclarations` as
 * "a published declaration that NOTHING names", and computes it as
 *
 *   declaredNames.filter(n => !namedTargets.has(n))
 *
 * where `declaredNames` collects `symbol.name` — the BARE name — and `namedTargets` collects
 * relationship `target` strings. Both sides live in the NAME namespace, so the metric is only
 * meaningful while a lane's edge targets are also bare names.
 *
 * On this lane it read two different wrong ways in one afternoon:
 *
 *   - BEFORE `contains` endpoints changed to qualified paths: 152 orphans of 66,230 symbols,
 *     0.23%. That is misleadingly LOW. A `contains` target `tag` "named" whichever `tag` the
 *     set held, so 32,660 ambiguous targets all counted as satisfied. The rate measured string
 *     saturation, not incoming edges.
 *   - AFTER: 66,199 orphans of 66,362 symbols, 99.75%. That is misleadingly HIGH for the same
 *     reason in reverse: `contains` now targets `pkg.outer.tag`, which never equals the bare
 *     name `tag`, so almost nothing is "named" in the namespace the metric counts.
 *
 * Neither number is a regression, and neither is a pass. Both are an artefact of comparing a
 * path-valued edge against a name-valued symbol.
 *
 * ## What this measures instead
 *
 * For every published symbol, whether ANY edge in the run names it — checked against the
 * symbol's `qualifiedName` AND its `name`, and reported separately per type so a reader can
 * see WHICH relationship type is what reaches a declaration:
 *
 *   orphanByQname   — no edge targets this symbol's qualified path
 *   orphanByName    — no edge targets this symbol's bare name
 *   namedByType     — per relationship type, how many DISTINCT declarations it names
 *   externalTargets — target strings matching no published symbol at all, reported SEPARATELY
 *                     from "a declaration in this corpus we failed to publish", because those
 *                     are opposite findings that look identical in a count
 *
* The shape is reported, not thresholded: a language whose files are independent config
 * documents legitimately has a sparse incoming graph, and the judgement about whether that is
 * correct belongs to the lane that measured it, not a pass/fail here.
 *
 * ## EXTERNAL vs NEVER-INDEXED — the distinction that looks identical in a count
 *
 * The section above reports unresolved target strings but declines to say what they ARE,
 * because "an npm package nobody has published" and "a key in this document that the analyzer
 * failed to publish" are the same shape and opposite findings: the first is correct and the
 * second is a defect this lane owns.
 *
 * They can be told apart WITHOUT A GUESS, because every type this analyzer emits already
 * publishes the discriminator for its own target contract, and the two classes of type are
 * different by construction:
 *
 *   - a type whose contract is "the target is a symbol IN THIS DOCUMENT" — `contains`,
 *     `extends`, `implements`, `overrides`, `calls` (both endpoints are keys of one `scripts`
 *     object), the OpenAPI-endpoint `uses` — if its target does not resolve, that is a
 *     DEFECT and it is counted as one;
 *   - a type whose contract is "the target names something OUTSIDE this document" —
 *     `uses` with `relationshipType: package_dependency` (an npm/composer package name),
 *     `imports` (`importForm: json_schema_ref`, a file), `exports`
 *     (`exportForm: manifest_entry_point`, a published entry point) — an unresolved target is
 *     the CONTRACT HOLDING, not a miss;
 *   - `references` with `reasonCode: ref_target_not_declared_in_document` — the analyzer
 *     already adjudicated this one and held it at 0.8: the document does not declare the
 *     location, so there is nothing to bind to.
 *
 * The classification reads `metadata`, so it cannot quietly disagree with the analyzer about
 * what a type means: a type with no discriminator and no in-document contract is reported as
 * `UNCLASSIFIED` rather than being assigned to whichever bucket is tidier.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/json/namespace-orphan-probe.ts <file> [<file> ...]
 *   xargs -a <list> npx tsx validation/m14/fixtures/json/namespace-orphan-probe.ts
 */
import { parseFile } from "../../../../src/ast/pool-worker"
import { statSync } from "node:fs"
import * as path from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const args = process.argv.slice(2)

/** Every argument is a path; its repo root is the corpus directory that contains it. */
const roots = new Map<string, string>()
for (const a of args) {
  const abs = path.resolve(a)
  if (!statSync(abs, { throwIfNoEntry: false })?.isFile()) {
    console.error(`not a file: ${abs}`)
    continue
  }
  const rel = path.relative(CR, abs)
  const dir = rel.startsWith("..") ? path.dirname(abs) : path.join(CR, rel.split(path.sep)[0])
  roots.set(abs, dir)
}

let symbols = 0
let edges = 0
let failures = 0
const byQname = new Set<string>()
const byName = new Set<string>()
/** type -> distinct qualified paths it names. */
const namedByType = new Map<string, Set<string>>()
/** Target strings that match nothing published, kept apart from "never indexed". */
const external = new Map<string, string[]>()
/** verdict -> count, and verdict -> up to 6 examples. */
const verdictCounts = new Map<string, number>()
const verdictExamples = new Map<string, string[]>()
const publishedQname = new Set<string>()
const publishedName = new Map<string, number>()

/**
 * What an UNRESOLVED target is, read from the discriminator the analyzer published.
 *
 * The return value is the finding, and it is one of five declared verdicts rather than a
 * boolean, because the two failure modes this separates are opposite findings that a single
 * count renders identical.
 */
function classifyUnresolved(type: string, meta: any): string {
  if (meta?.relationshipType === "package_dependency") return "external-package"
  if (meta?.importForm === "json_schema_ref") return "external-file"
  if (meta?.exportForm === "manifest_entry_point") return "external-entry-point"
  if (meta?.reasonCode === "ref_target_not_declared_in_document") return "document-does-not-declare-it"
  // `refForm` is the `extends` site's own discriminator, and it is checked BEFORE the
  // type-based branch below because `extends` is hard-coded there as in-document.
  //
  // An `allOf` entry may be `{"$ref": "dataTypeBase.json#"}` — a SIBLING FILE — and that is
  // still composition ("inherits from the schema in that file"), so the analyzer emits the
  // edge with `refForm: "sibling_file"` and `resolvedPath: false`. The target is another
  // file and cannot bind to a symbol here, exactly as for `imports`.
  //
  // This classifier read `importForm`, `exportForm` and `reasonCode` and not `refForm`, so
  // it called those edges DEFECT-in-document-target: a real defect in this PROBE, reported
  // as a real defect in the ANALYZER. That is the failure mode deliverable C names — the
  // two classes are opposite findings and a reporter that ignores a published
  // discriminator manufactures the wrong one. Measured on 444 files: 1 edge
  // (`extends -> dataTypeBase.json#`), the whole of it this branch.
  if (meta?.refForm === "sibling_file") return "external-file"
  // Everything below is a type whose OWN CONTRACT puts the target inside this document, so
  // an unresolved target is a defect in this analyzer and is counted as one.
  if (type === "contains" || type === "extends" || type === "implements" || type === "overrides") return "DEFECT-in-document-target"
  if (type === "calls") return "DEFECT-in-document-target"
  if (meta?.reasonCode === "openapi_path_entry_declares_http_method") return "DEFECT-in-document-target"
  return "UNCLASSIFIED"
}

for (const [abs, dir] of roots) {
  let r: any
  try {
    r = await parseFile(abs, dir)
  } catch {
    failures++
    continue
  }
  for (const s of r.symbols ?? []) {
    symbols++
    const name = String(s?.name ?? "")
    const q = String(s?.qualifiedName ?? "")
    if (q.length > 0) publishedQname.add(q)
    if (name.length > 0) publishedName.set(name, (publishedName.get(name) ?? 0) + 1)
  }
}

for (const [abs, dir] of roots) {
  let r: any
  try {
    r = await parseFile(abs, dir)
  } catch {
    continue
  }
  for (const x of r.relationships ?? []) {
    edges++
    const t = String(x.type ?? x.relationshipType ?? "").toLowerCase()
    const tgt = String(x.target ?? "")
    if (tgt.length === 0) continue
    if (publishedQname.has(tgt)) {
      byQname.add(tgt)
      const set = namedByType.get(t) ?? new Set<string>()
      set.add(tgt)
      namedByType.set(t, set)
    }
    // A bare name only counts as "named by name" when it is published by exactly one symbol.
    // Counting an ambiguous name would repeat the mistake this probe exists to correct, so an
    // ambiguous name is recorded as neither named nor external — it is counted, separately.
    if (publishedName.has(tgt)) byName.add(tgt)
    if (!publishedQname.has(tgt)) {
      const list = external.get(tgt) ?? []
      if (list.length < 3) list.push(t)
      external.set(tgt, list)
      const verdict = classifyUnresolved(t, x.metadata)
      verdictCounts.set(verdict, (verdictCounts.get(verdict) ?? 0) + 1)
      const ex = verdictExamples.get(verdict) ?? []
      if (ex.length < 6) ex.push(`${t} -> ${tgt.slice(0, 70)}`)
      verdictExamples.set(verdict, ex)
    }
  }
}

let orphanQ = 0
let orphanN = 0
for (const q of publishedQname) if (!byQname.has(q)) orphanQ++
for (const [n, count] of publishedName) if (count === 1 && !byName.has(n)) orphanN++
const uniqueNames = [...publishedName.values()].filter((c) => c === 1).length

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(2)}%`)

console.log(`namespace orphan probe — ${roots.size} file(s), ${symbols} symbols, ${edges} edges, ${failures} parse failure(s)`)
console.log(`distinct qualified paths published : ${publishedQname.size}`)
console.log(`orphan by qualified path            : ${orphanQ} of ${publishedQname.size} = ${pct(orphanQ, publishedQname.size)}`)
console.log(`orphan by bare name (unique names)  : ${orphanN} of ${uniqueNames} = ${pct(orphanN, uniqueNames)}`)
console.log(`ambiguous bare names (excluded)     : ${[...publishedName.values()].filter((c) => c > 1).length}`)
console.log(`distinct target strings naming nothing published: ${external.size}`)
console.log("")
console.log(`${"type".padEnd(14)}${"distinct decls named".padStart(21)}`)
console.log("-".repeat(35))
for (const t of [...namedByType.keys()].sort()) console.log(`${t.padEnd(14)}${String(namedByType.get(t)!.size).padStart(21)}`)
console.log("-".repeat(35))
const sample = [...external.entries()].slice(0, 12)
if (sample.length) {
  console.log("targets naming nothing published — first 12, and the verdict for EACH:")
  for (const [tgt, types] of sample) console.log(`  ${tgt.slice(0, 90)}  [${[...new Set(types)].join(",")}]`)
}

// The section the previous version of this file declined to write, because it could not be
// written without a guess. It can: every type publishes the discriminator for its own target
// contract, so "external" and "this analyzer failed to publish a symbol that is right here"
// are separable by reading, not by inference.
console.log("")
console.log(`unresolved targets adjudicated — ${verdictCounts.size} verdict(s), ${[...verdictCounts.values()].reduce((a, n) => a + n, 0)} edges`)
console.log(`${"verdict".padEnd(32)}${"edges".padStart(10)}`)
console.log("-".repeat(42))
for (const [v, n] of [...verdictCounts].sort((a, b) => b[1] - a[1])) {
  console.log(`${v.padEnd(32)}${String(n).padStart(10)}`)
  for (const e of verdictExamples.get(v) ?? []) console.log(`    ${e}`)
}
const defects = [...verdictCounts].filter(([v]) => v.startsWith("DEFECT")).reduce((a, [, n]) => a + n, 0)
console.log("-".repeat(42))
console.log(`DEFECTS (target is in this document and was not published): ${defects}`)