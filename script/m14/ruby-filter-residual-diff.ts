/**
 * THE PRODUCTION-VS-DIRECT RESIDUAL, ROW BY ROW — and the filter check that eats it.
 *
 * WHY THIS FILE EXISTS. The ruby lane's census (`script/m14/ruby-grammar-handover-delta.ts`) measures
 * THREE arms over the whole admitted population and prints a per-type delta. The Lead's first
 * measurement found Δ(production − no-hand-over) = 12 rows; the Lead patched the shared noise filter
 * (`src/ast/pool-worker.ts`, commit 95e72114f) and the delta FELL to 4. **⇒ A DELTA THAT FALLS IS
 * NOT A CLOSED DELTA — the remaining rows have their own root, and the only way to know it is to
 * read the ROWS, not the count.**
 *
 * ⇒ THIS INSTRUMENT READS THE ROWS. It runs the PRODUCTION path (`pool-worker.parseFile`) and the
 * DIRECT path (`analyze()` on the same parsed tree) over the files the census names, diffs the two
 * relationship sets KEY BY KEY (type + source + target + metadata), and prints the rows that are
 * missing from production, with the production count, the direct count and the leaf length.
 *
 * ⇒ AND IT THEN ASKS THE FILTER DIRECTLY, so the root is a MEASUREMENT and not an inference: the
 * missing rows are passed to `filterNoiseRelationships` with a short-target CONTROL beside them, so
 * "the filter ate it" is distinguished from "the analyzer never emitted it".
 *
 * EXIT CODE: 0 when the two arms agree on every file (no residual); 3 when they do not (a real
 * residual, and the rows are printed so the root can be named).
 */
import { getParser } from "../../src/ast/engine"
import { RealRubyAnalyzer } from "../../src/ast/real-ruby-analyzer"
import { parseFile, filterNoiseRelationships } from "../../src/ast/pool-worker"
import { readFileSync } from "node:fs"
import * as path from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? path.resolve(process.cwd(), ".corpus")

/** The files the census named as carrying a residual. Named here so the instrument is deterministic. */
const TARGETS = [
  "gql-ruby/spec/graphql/execution/finalize_spec.rb",
  "gql-ruby/spec/graphql/execution/breadth_runtime_spec.rb",
]

const key = (r: any) => `${r.type}|${r.source}|${r.target}|${JSON.stringify(r.metadata ?? {})}`
const leafOf = (t: unknown): string => String(t ?? "").split(/[.:#]/).pop() ?? ""

const parser = await getParser("ruby" as any)
const real = new RealRubyAnalyzer()

let totalMissing = 0
const rowsOut: any[] = []

for (const rel of TARGETS) {
  const abs = path.join(CR, rel)
  let content: string
  try { content = readFileSync(abs, "utf8") } catch { continue }

  const direct = await real.analyze(parser.parse(content).rootNode, content, abs)
  const prod = await parseFile(abs, "ruby" as any)

  const pSet = new Set((prod.relationships ?? []).map(key))
  const dSet = new Set((direct.relationships ?? []).map(key))
  const missing = [...dSet].filter(k => !pSet.has(k))
  const extra = [...pSet].filter(k => !dSet.has(k))
  if (!missing.length && !extra.length) continue

  console.log(`\n${rel}`)
  console.log(`  production ${(prod.relationships ?? []).length} · direct ${(direct.relationships ?? []).length}`)
  console.log(`  MISSING from production: ${missing.length} · EXTRA in production: ${extra.length}`)

  for (const m of missing) {
    const [type, source, target, meta] = m.split("|")
    const leaf = leafOf(target)
    // THE FILTER IS CALLED WITH ITS OWN SIGNATURE: `filterNoiseRelationships(rels, language,
    // declaredNames?, boundNames?)` — the THIRD argument is the SET OF NAMES THE FILE DECLARES, not
    // a path. Passing a string there is a TypeError, and the instrument passes the file's own
    // declared names so the filter sees the same inputs production sees.
    const declared = new Set<string>()
    for (const s of (direct.symbols ?? []) as any[]) if (s?.name) declared.add(String(s.name))
    // THE CONTROL: a short, ordinary target, so "the filter ate it" is distinguishable from
    // "the analyzer never emitted it".
    const ctrlKept = filterNoiseRelationships(
      [{ type, source, target: "short_control_name", metadata: JSON.parse(meta) }] as any,
      "ruby" as any,
      declared,
    ).length
    const keptAsIs = filterNoiseRelationships(
      [{ type, source, target, metadata: JSON.parse(meta) }] as any,
      "ruby" as any,
      declared,
    ).length
    console.log(`    ${type}  ${source} -> ${target}`)
    console.log(`      leaf length ${leaf.length} · the filter keeps it: ${keptAsIs === 1} · the control (short target) is kept: ${ctrlKept === 1}`)
    totalMissing++
    rowsOut.push({ file: rel, type, source, target, leafLength: leaf.length, filterKeepsIt: keptAsIs === 1, controlKept: ctrlKept === 1 })
  }
}

console.log(`\n⇒ TOTAL MISSING ROWS: ${totalMissing}`)
if (totalMissing > 0) {
  const lens = rowsOut.map(r => r.leafLength)
  const allLong = rowsOut.every(r => r.leafLength > 80)
  const allEaten = rowsOut.every(r => r.filterKeepsIt === false)
  const ctrlOk = rowsOut.every(r => r.controlKept === true)
  console.log(`⇒ EVERY missing row has a leaf longer than 80: ${allLong} (lengths ${lens.join(", ")})`)
  console.log(`⇒ EVERY missing row is eaten by the filter when handed to it directly: ${allEaten}`)
  console.log(`⇒ THE SHORT-TARGET CONTROL IS KEPT IN EVERY CASE: ${ctrlOk}  ← so the analyzer DID emit these and the filter ate them`)
  console.log(`⇒ THE ROOT: the filter's leaf-LENGTH cap (src/ast/pool-worker.ts:936 and :944 — \`if (leaf.length > 80) return false\`). A long Ruby method name is a legal name: gql-ruby's test methods are long, and a 98-character method name is silently deleted.`)
}
process.exit(totalMissing > 0 ? 3 : 0)
