/**
 * ZIG — WHICH PRODUCER OWNS THE 4 FILES OVER 1 MB, AND WHAT IT EMITS.
 *
 * ## The question
 *
 * `unannotated-edge-probe.ts` found 15 edges of 432,468 (0.00347%) carrying no `targetScope`,
 * all of them `calls`, all with `metadata: {line, method: "regex"}` and no
 * `metadata.relationshipType`. The pair `{line, method:"regex"}` is written in exactly three
 * places in `src/` and none of them is `real-zig-analyzer.ts`:
 *
 *     src/ast/pool-worker.ts:305   new Class(      -> instantiates, conf 0.6, isNew:true
 *     src/ast/pool-worker.ts:321   obj.method(     -> calls,        conf 0.4
 *     src/ast/pool-worker.ts:347   func(           -> calls,        conf 0.5
 *
 * All three live inside `extractBasicRelationships` (`src/ast/pool-worker.ts:266-352`), which
 * has exactly one caller: `extractFallback` (`:374`). `extractFallback` has three call sites,
 * all of them the PRE-ANALYZER size and error routes in `parseFile`:
 *
 *     :811  sizeBytes > FULL_AST_LIMIT (1 MB)  -> read first 256 KB, regex-extract
 *     :1234 parse threw, error looked expected
 *     :1236 parse threw, error did not look expected
 *
 * So the mechanism is size routing: `real-zig-analyzer.ts` never ran on the residue files at
 * all, which is why `annotateTargetScope` (`:1240`, inside the analyzer) never saw them. Pass
 * 24 §H.3 could not separate this from a call-order bug because both of its candidate
 * mechanisms are in `real-zig-analyzer.ts` — code that, on these files, does not execute.
 *
 * ## What this probe measures
 *
 * For every `.zig` file over 1 MB: which of the two size routes it took, whether the Zig
 * analyzer produced anything, and what the fallback emitted. The population is derived, not
 * hardcoded — `FULL_AST_LIMIT` and `STRUCTURAL_LIMIT` are read out of `pool-worker.ts` so the
 * bands cannot drift away from the constants they are supposed to mirror.
 *
 * The 256 KB truncation is the part with a cost: the 5 MB band returns NOTHING, and the 1-5 MB
 * band is regex-scanned over a 256 KB prefix of a file up to 10.9 MB, i.e. as little as 2.4% of
 * it. So both routes publish a per-file symbol count that is a fraction of the file, and
 * nothing downstream can tell that from a complete parse.
 *
 * ## Instrument
 *
 * Production `parseFile` from `src/ast/pool-worker`, on the exact file set the size guards
 * admit. Usage: npx tsx validation/m14/fixtures/zig/large-file-route.ts [root]
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { parseFile } from "../../../../src/ast/pool-worker"

const root = process.argv[2] ?? "/home/ishaq2321/bb_tests/repositories"

/** Read the two size constants out of the shared source so the bands cannot drift. */
function sizeConstants(): { fullAst: number; structural: number } {
  const src = readFileSync("src/ast/pool-worker.ts", "utf8")
  const full = src.match(/const FULL_AST_LIMIT\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/)
  const structural = src.match(/const STRUCTURAL_LIMIT\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/)
  return {
    fullAst: full ? Number(full[1]) : 1,
    structural: structural ? Number(structural[1]) : 5,
  }
}

const { fullAst, structural } = sizeConstants()

const all = execFileSync("bash", ["-lc", `find ${root} -name '*.zig' -type f -printf '%s\\t%p\\n' | sort -rn`], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
})
  .split("\n")
  .filter(Boolean)
  .map((l) => {
    const tab = l.indexOf("\t")
    return { size: Number(l.slice(0, tab)), path: l.slice(tab + 1) }
  })

const overFullAst = all.filter((f) => f.size > fullAst * 1024 * 1024)
const overStructural = overFullAst.filter((f) => f.size > structural * 1024 * 1024)

console.log(`corpus .zig files                ${all.length}`)
console.log(`FULL_AST_LIMIT                   ${fullAst} MB   (above it: ${overFullAst.length} files)`)
console.log(`STRUCTURAL_LIMIT                 ${structural} MB   (above it: ${overStructural.length} files)`)
console.log("")

/** Which producer wrote these edges — the metadata fingerprint, resolved to a code site. */
const REGEX_METHOD = /"method"\s*:\s*"regex"/
function producerOf(rel: any): "regex-fallback" | "zig-analyzer" {
  return REGEX_METHOD.test(JSON.stringify(rel?.metadata ?? {})) ? "regex-fallback" : "zig-analyzer"
}

const rows: any[] = []
for (const f of overFullAst) {
  const route = f.size > structural * 1024 * 1024 ? "empty-5MB-band" : "regex-256KB-prefix"
  let pf: any
  try {
    pf = await parseFile(f.path, root)
  } catch (e: any) {
    rows.push({ file: f.path, size: f.size, route, parseThrew: String(e?.message ?? e).slice(0, 160) })
    continue
  }
  const rels: any[] = Array.isArray(pf?.relationships) ? pf.relationships : []
  const syms: any[] = Array.isArray(pf?.symbols) ? pf.symbols : []
  const byProducer = new Map<string, number>()
  let unannotated = 0
  for (const r of rels) {
    const p = producerOf(r)
    byProducer.set(p, (byProducer.get(p) ?? 0) + 1)
    const v = r?.metadata?.targetScope
    if (v === undefined || v === null || v === "") unannotated++
  }
  rows.push({
    file: f.path,
    size: f.size,
    route,
    fallbackFlag: pf?.fallback === true,
    symbols: syms.length,
    relationships: rels.length,
    byProducer: Object.fromEntries(byProducer),
    unannotated,
    distinctTypes: [...new Set(rels.map((r: any) => String(r?.type ?? "")))].sort(),
    minConf: rels.length ? Math.min(...rels.map((r: any) => Number(r?.confidence))) : null,
  })
}

for (const r of rows) {
  console.log(`${(r.size / 1024 / 1024).toFixed(2)} MB  ${r.route}`)
  console.log(`  ${r.file}`)
  if (r.parseThrew) {
    console.log(`  parse threw: ${r.parseThrew}`)
  } else {
    console.log(`  fallback=${r.fallbackFlag}  symbols=${r.symbols}  relationships=${r.relationships}`)
    console.log(`  producers=${JSON.stringify(r.byProducer)}  unannotated=${r.unannotated}`)
    console.log(`  types=${JSON.stringify(r.distinctTypes)}  minConfidence=${r.minConf}`)
    console.log(`  read ${Math.min(r.size, 256 * 1024)} B of ${r.size} B = ${((Math.min(r.size, 256 * 1024) / r.size) * 100).toFixed(1)}% of the file`)
  }
  console.log("")
}

console.log(`files over FULL_AST_LIMIT        ${overFullAst.length} of ${all.length} (${((overFullAst.length / all.length) * 100).toFixed(3)}%)`)
console.log(`  emitting zero edges            ${rows.filter((r) => r.relationships === 0).length}`)
const residue = rows.reduce((n, r) => n + (r.unannotated ?? 0), 0)
console.log(`  unannotated edges on them      ${residue}`)

if (overFullAst.length === 0) {
  console.error("\nFAIL: drew 0 files above FULL_AST_LIMIT — this corpus cannot price the band")
  process.exit(2)
}