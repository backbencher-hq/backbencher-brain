/**
 * Rewrites `validation/m12/ground-truth/sql.json` onto the CURRENT edge-naming
 * contract, mechanically, from the facts' own fields.
 *
 * WHY THIS EXISTS. `script/m12/verify-analyzer.ts sql` reports
 *
 *   expected 84  truePositive 49  falsePositive 40  falseNegative 35
 *   precision 0.551  recall 0.583  passed FALSE
 *
 * and every one of the 70 discrepancies is a SPELLING difference on an edge the
 * ground truth already asserts. Paired by (file, type, target member name), all 35
 * relationship FNs have exactly one FP counterpart:
 *
 *   truth `rel:Schema.sql:uses:global:users`      observed `…uses:Schema.sql:users`
 *   truth `rel:Schema.sql:contains:teams:id`      observed `…contains:teams:Schema.sql::teams.id`
 *
 * plus 5 symbol FPs, one per fixture: the file's own `module` symbol. So the ground
 * truth is stale against two deliberate contract changes, and it is stale in the one
 * direction that makes the differential FAIL while the analyzer is right.
 *
 * THE TWO CONTRACT CHANGES, each with the measurement that decided it
 *
 *   R1  `global` -> the file's module symbol. The literal `global` published
 *       nothing, so at the store 2,779 edges had `source_symbol_id IS NULL` and
 *       5,799 emitted edges were DELETED by `INSERT OR IGNORE` collapsing rows that
 *       shared a target (`validation/m14/fixtures/sql/measurements/
 *       pass13-store-resolution-BEFORE.json`). A SQL migration is applied per FILE —
 *       psql runs the file, `\i` loads it — so the file is the real owner and is
 *       published as a `module` symbol named for the basename.
 *
 *   R2  a `contains` target names the member by its QUALIFIED name
 *       (`<file>::<owner>.<member>`) instead of the bare member name. The store's
 *       only EXACT match is the qualified name; a bare name bound only through a
 *       same-name-pick rule, and 2,512 of 12,106 `contains` edges (20.8%) were bare.
 *       Measured: `pass14-ambiguity-split-AFTER.json` — k0 bare 2,512 -> 0,
 *       k3 qualified 0 -> 12,105, ambiguous 9,593 -> 428.
 *
 * WHY THIS IS NOT CIRCULAR. The analyzer's output is not read. Each rewrite is a
 * function of fields the hand-audited facts already carry — `file`, `sourceId`,
 * `targetId`, `line`, `kind` — and of the two rules above. The truth file's own note
 * records that it was audited against the SOURCE line by line and never read back
 * from the analyzer; that property survives this migration, because the migration
 * renames identifiers and adds the 5 file-module symbols and copies no count, no
 * edge and no line from `parseFile`.
 *
 * WHAT IT ADDS, and why each addition is a source fact rather than an observed one:
 *   - one `module` symbol per fixture file, at line 1, named for the basename.
 *     `\i include.sql` and `psql -f include.sql` both apply a file; the file is a
 *     declaration unit in SQL, so it is a symbol. All 5 fixtures begin at line 1.
 *
 * The script PRINTS its own diff and refuses to write if any relationship fact would
 * lose its (file, type, member) identity — so a rewrite that changed an edge's
 * subject would abort rather than quietly land.
 *
 * Run: npx tsx validation/m14/fixtures/sql/migrate-m12-truth.ts [--check]
 */

import { readFileSync, writeFileSync } from "node:fs"

const TRUTH = "validation/m12/ground-truth/sql.json"
const CHECK_ONLY = process.argv.includes("--check")

const doc = JSON.parse(readFileSync(TRUTH, "utf8"))
const before = JSON.parse(JSON.stringify(doc))

const fixtures = [...new Set(doc.facts.map((f: any) => f.file))].sort()
const renamedSources: string[] = []
const renamedTargets: string[] = []
const addedSymbols: string[] = []
/** (file|type|member) identity of every relationship fact, for the abort check. */
const identityBefore = new Map<string, number>()

/**
 * `rel:<file>:<type>:<source>:<target>` — four separators, and a QUALIFIED target
 * carries colons of its own (`Schema.sql::teams.id`), so a plain `split(":")` reads
 * the FILE as the target and every R2 fact then looks like it lost its subject. The
 * limit is what makes the qualified spelling parseable, and getting it wrong here
 * would abort a correct migration on a defect in this instrument, which is the same
 * shape as the pass-14 `k3` double-increment: the instrument cannot see the change it
 * is supposed to be checking.
 */
function splitRelId(id: string): { prefix: string; file: string; type: string; source: string; target: string } {
  const parts = id.split(":")
  const prefix = parts[0]
  const file = parts[1]
  const type = parts[2]
  const source = parts[3]
  const target = parts.slice(4).join(":")
  return { prefix, file, type, source, target }
}

/** A qualified `contains` target's MEMBER name — the qualified form is
 *  `<file>::<owner>.<member>`, and the file part contains a dot of its own. */
function memberOf(target: string): string {
  if (!target.includes("::")) return target
  const qualified = target.slice(target.indexOf("::") + 2)
  return qualified.slice(qualified.lastIndexOf(".") + 1)
}

for (const f of doc.facts as any[]) {
  if (f.kind !== "relationship") continue
  const id = f.id as string
  const { prefix, file, type, source, target } = splitRelId(id)
  const member = memberOf(target)
  const key = `${file}|${type}|${member}`
  identityBefore.set(key, (identityBefore.get(key) ?? 0) + 1)

  // R1 — a `global` source is the file's own module symbol.
  if (source === "global") {
    f.sourceId = file
    f.id = `${prefix}:${file}:${type}:${file}:${target}`
    renamedSources.push(id)
  }

  // R2 — a bare `contains` target names its member by qualified name. Only when the
  // target is bare; a fact that already spells a qualified name is left alone, so the
  // script is idempotent.
  if (type === "contains" && !target.includes("::")) {
    f.targetId = `${file}::${source}.${target}`
    f.id = `${prefix}:${file}:${type}:${source}:${f.targetId}`
    renamedTargets.push(id)
  }
}

// The file-module symbol, one per fixture. Line 1 for all five: every fixture begins
// at line 1, and the symbol is the file, not a construct inside it.
for (const file of fixtures) {
  const id = `symbol:${file}:1:module:${file}`
  if ((doc.facts as any[]).some((f) => f.id === id)) continue
  doc.facts.push({
    id,
    layer: "ast_extraction",
    kind: "symbol",
    file,
    line: 1,
    attributes: { name: file, symbolKind: "module" },
  })
  addedSymbols.push(id)
}

// ABORT CHECK — every relationship fact must still assert the same (file, type, member)
// subject it asserted before. A rule that rewrote an edge's subject rather than its
// spelling would show up here as a missing key, and the script refuses to write.
const identityAfter = new Map<string, number>()
for (const f of doc.facts as any[]) {
  if (f.kind !== "relationship") continue
  const { file, type, target } = splitRelId(f.id as string)
  const key = `${file}|${type}|${memberOf(target)}`
  identityAfter.set(key, (identityAfter.get(key) ?? 0) + 1)
}
const lost: string[] = []
for (const [k, v] of identityBefore) if ((identityAfter.get(k) ?? 0) < v) lost.push(k)
const gained: string[] = []
for (const [k, v] of identityAfter) if ((identityBefore.get(k) ?? 0) < v) gained.push(k)

console.log(`facts before          ${before.facts.length}`)
console.log(`facts after           ${doc.facts.length}`)
console.log(`relationship facts    ${(doc.facts as any[]).filter((f) => f.kind === "relationship").length}`)
console.log(`symbol facts          ${(doc.facts as any[]).filter((f) => f.kind === "symbol").length}`)
console.log(`R1 sources renamed    ${renamedSources.length}   (global -> the file's module symbol)`)
console.log(`R2 targets renamed    ${renamedTargets.length}   (bare member -> <file>::<owner>.<member>)`)
console.log(`symbols added         ${addedSymbols.length}   (one module per fixture file)`)
console.log(`identity lost         ${lost.length}  ${lost.join(", ")}`)
console.log(`identity gained       ${gained.length}  ${gained.join(", ")}`)

if (lost.length) {
  console.error("\nABORT: a relationship fact lost its (file, type, member) subject. The rewrite changed an edge, not its spelling.")
  process.exit(1)
}

if (CHECK_ONLY) {
  console.log("\n--check: nothing written")
  process.exit(0)
}

writeFileSync(TRUTH, JSON.stringify(doc, null, 2) + "\n")
console.log(`\nwrote ${TRUTH}`)
console.log("next: npx tsx script/m12/verify-analyzer.ts sql")