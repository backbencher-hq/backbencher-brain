/**
 * TS IMPORTS INDEX CENSUS — the whole-project measurement of the imports B-class over a REAL index.
 *
 * ## Why this exists
 *
 * The cap-50 triage arm cannot measure the project-index pass AT ALL: an index built from a stride is
 * stamped `complete = false`, so the pass is fail-closed there by design — the cap-50 table is
 * byte-identical with and without `--index`, and quoting it as an index measurement would be a
 * correct number about the wrong population. This census builds the index over ONE WHOLE PROJECT
 * (`buildProjectIndexStreaming`, the bounded-memory form), stamps `complete = true` because the file
 * set IS the project's whole admitted set, reproduces production's context shape
 * (`{ projectIndex, projectRoot }`), analyzes every admitted file, and counts what the pass DECIDED
 * on every `imports` edge.
 *
 * ## What it does NOT do
 *
 * It does not resolve anything itself and it does not run the fleet gate: an index-pass decision is
 * not a resolution. The arbiter remains the only instrument that may say an edge RESOLVES; this
 * census says what the analyzer ASKED FOR (a bare target the resolver can join, or a cited external
 * claim, or a refusal), by class, with counts and examples. Those are two different statements and
 * they are reported as two.
 *
 * ## Population rule
 *
 * File set derived per run from the corpus checkout (`git ls-files`, extension, size cap), printed
 * with its size; `--repo` is required because this instrument must cover a whole project (a stride
 * would make the index incomplete and every decision a refusal). The analyzed population and the
 * indexed population are printed separately.
 *
 * Usage:
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/ts-imports-index-census.ts --repo=element-plus [--json out.json] [--examples 3]
 */
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { resolveWasmAsset } from "../../src/util/wasm"

const CR = process.env.BB_CORPUS_ROOT ?? path.join(process.cwd(), ".corpus")
const SIZE_CAP = 1024 * 1024
const argv = process.argv.slice(2)
const argOf = (flag: string): string | null => {
  const i = argv.indexOf(flag)
  return i >= 0 ? (argv[i + 1] ?? null) : null
}
const repo = argOf("--repo")
const jsonOut = argOf("--json")
const examples = Number(argOf("--examples") ?? 3)
if (!repo) {
  console.error("usage: ts-imports-index-census.ts --repo=<corpus repo name> [--json out.json] [--examples N]")
  process.exit(2)
}
const repoRoot = path.join(CR, repo)
if (!fs.existsSync(repoRoot)) {
  console.error(`no such corpus checkout: ${repoRoot}`)
  process.exit(2)
}

// ── the project's WHOLE admitted file set (the same admission the fleet gate applies) ────────────
const found: string[] = []
let overCap = 0
let absent = 0
const tracked = execFileSync("git", ["-C", repoRoot, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
  .split("\0")
  .filter(Boolean)
for (const rel of tracked) {
  const low = rel.toLowerCase()
  if (!low.endsWith(".ts")) continue
  if (detectLanguageFromPath(rel) !== "typescript") continue
  const abs = path.join(repoRoot, rel)
  try {
    if (fs.statSync(abs).size > SIZE_CAP) {
      overCap++
      continue
    }
  } catch {
    absent++
    continue
  }
  found.push(abs)
}
found.sort()

console.log(`TS IMPORTS INDEX CENSUS — repo ${repo}`)
console.log(
  `population: ${found.length} admitted .ts file(s) of ${tracked.length} tracked path(s)` +
    ` · over size cap ${overCap} · absent ${absent} · COMPLETE index by construction (the whole project's admitted set)`,
)

const mod: any = await import("../../src/ast/project-index")
const wasm = resolveWasmAsset("tree-sitter-typescript/tree-sitter-typescript.wasm")
let lastProgress = 0
const projectIndex = await mod.buildProjectIndexStreaming(wasm, found, mod.TYPESCRIPT_DECLARATION_SPEC, (done: number, total: number) => {
  if (total >= 200 && done - lastProgress >= Math.floor(total / 4)) {
    lastProgress = done
    process.stderr.write(`  index ${done}/${total}\n`)
  }
})
mod.buildResolutionTables(projectIndex)
projectIndex.complete = true
console.log(`index: ${projectIndex.stats?.files ?? found.length} file(s) · damaged ${projectIndex.stats?.damaged ?? 0} · symbols(declared names) ${projectIndex.symbolNames.size} · modules ${projectIndex.modules.size} · symbolCounts ${projectIndex.symbolCounts.size}`)
if ((projectIndex.stats?.damaged ?? 0) > 0) {
  console.log(`  DAMAGED FILES: ${[...projectIndex.damagedFiles].slice(0, 10).join(", ")} — an item declared only in a damaged file reads absent, which is a claim risk, so no claim on such a name should be trusted; reported, not hidden.`)
}

// ── analyze every admitted file with the same context production hands the analyzer ─────────────
type Bucket = { count: number; rows: string[] }
const buckets = new Map<string, Bucket>()
const note = (name: string, row: string) => {
  const b = buckets.get(name) ?? { count: 0, rows: [] }
  b.count++
  if (b.rows.length < examples) b.rows.push(row)
  buckets.set(name, b)
}
let analyzed = 0
let parseFailures = 0
let importsRows = 0
const relOf = (f: string) => (f.startsWith(CR) ? f.slice(CR.length + 1) : f)

for (const file of found) {
  let r: any
  try {
    r = await parseFile(file, repoRoot, { projectIndex, projectRoot: repoRoot })
  } catch {
    parseFailures++
    continue
  }
  analyzed++
  for (const edge of r?.relationships ?? []) {
    if (String(edge?.type) !== "imports") continue
    importsRows++
    const md: any = edge?.metadata ?? {}
    const target = String(edge?.target ?? "")
    const row = `${target.replace(/\u0000/g, "\\0")} @ ${relOf(file)}`
    if (md.resolvedViaProjectIndex === true) note("RESOLVED-BY-INDEX: bare target the resolver can join", row)
    else if (md.projectIndexAmbiguous === true) note("REFUSED: project-local item declared more than once", row)
    else if (md.projectIndexItemNotDeclared === true) note("REFUSED: project-local module, item not in the index", row)
    else if (md.projectIndexModuleShadowed === true) note(`REFUSED: external module root shadowed by project module ${md.projectIndexModuleShadowed}`, row)
    else if (md.externalReason === "module-namespace") note("CLAIMED: module outside the project (module-namespace)", row)
    else if (md.localBinding === true) note("BINDING: whole-module binding spelling (already clean column)", row)
    else if (!target.includes(":")) note("ALREADY BARE: relative/absolute item (resolver's population question, not the pass's)", row)
    else note("UNTOUCHED module:item (no decision — should be 0 if the pass covered the row)", row)
  }
}

console.log(`analyzed ${analyzed} file(s) · parse failures ${parseFailures} · imports rows ${importsRows}`)
const ordered = [...buckets.entries()].sort((a, b) => b[1].count - a[1].count)
console.log("")
for (const [name, b] of ordered) {
  console.log(`${String(b.count).padStart(6)}  ${name}`)
  for (const sample of b.rows) console.log(`          e.g. ${sample}`)
}
const claimCount = (buckets.get("CLAIMED: module outside the project (module-namespace)")?.count ?? 0)
const resolvedCount = (buckets.get("RESOLVED-BY-INDEX: bare target the resolver can join")?.count ?? 0)
const refusedCount = ordered.filter(([n]) => n.startsWith("REFUSED")).reduce((n, [, b]) => n + b.count, 0)
console.log("")
console.log(`SUMMARY — resolved-by-index ${resolvedCount} · claimed-external ${claimCount} (CLAIMS ARE NOT RESOLUTIONS) · refused ${refusedCount} · of ${importsRows} imports rows over ${found.length} files`)
console.log(`THE ARBITER'S QUESTION: only the fleet gate can say an edge RESOLVES; this census says what the analyzer ASKED FOR. Run the gate as the arbiter.`)
if (jsonOut) {
  fs.writeFileSync(
    jsonOut,
    JSON.stringify(
      { repo, population: { admitted: found.length, analyzed, overCap, absent, parseFailures }, index: { files: projectIndex.stats?.files, damaged: projectIndex.stats?.damaged, symbolNames: projectIndex.symbolNames.size, modules: projectIndex.modules.size }, importsRows, buckets: Object.fromEntries(ordered.map(([n, b]) => [n, { count: b.count, examples: b.rows }])) },
      null,
      2,
    ),
  )
}
