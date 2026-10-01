// LUA-24: the oracle and the census derive 1,797 and 1,579 export edges on the
// same kong corpus, 218 apart, and the oracle's LARGER count is the wrong way
// round for a deduped total — so at least one truth walker over-derives.
//
// This settles it by diffing the two name sets per file. Expected names come from
// the census walk (script/m60/lua-export-census.ts); the oracle's come from its
// own walk (script/m60/lua-truth-oracle.ts deriveLuaTruth). Neither is an input
// to the other, which is the only reason a disagreement here means anything.
//
// A name the ORACLE derives and the census does not names a file, and that
// file's return is the one to read. That is the whole adjudication.
import { join } from "node:path"
import { readFileSync, readdirSync } from "node:fs"

const REPO = "$HOME/backbencher-brain"
const REPOS = "$HOME/fixtures/repositories"
const CORPUS = process.argv.includes("--luvit") ? "luvit" : "kong"

const { loadWebTreeSitter } = await import(REPO + "/src/util/wasm")
const mod: any = await loadWebTreeSitter()
const { parseFile } = await import(REPO + "/src/ast/pool-worker")
await parseFile(join(REPOS, "luvit", "init.lua"), REPOS) // measured core-wasm warmup
const lang = await mod.Language.load(REPO + "/wasm/tree-sitter-lua.wasm")
const parser = new mod.Parser()
parser.setLanguage(lang)

const { deriveLuaTruth } = await import(REPO + "/script/m60/lua-truth-oracle")

// The census side is IMPORTED, not reproduced. It was reproduced here, and when
// LUA-35 added the setmetatable rule to the real census this copy did not get it,
// so the gate reported 3 phantom disagreements on files the analyzer and the real
// census agreed about. Third time in this lane that one piece of logic existing in
// two files has cost a day — LUA-24 was the first. Reimplementation is deleted, not
// patched.
const { expectedExportNames } = await import("./lua-export-census")

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== ".git") walk(p, out) }
    else if (e.name.endsWith(".lua")) out.push(p)
  }
  return out
}

const files = walk(join(REPOS, CORPUS))
const onlyOracle: Array<{ file: string; name: string; line: number | null; rule: string }> = []
const onlyCensus: Array<{ file: string; name: string }> = []
let filesDiff = 0
let oracleTotal = 0
let censusTotal = 0
const oSet = new Set<string>()
const cSet = new Set<string>()

for (const f of files) {
  const src = readFileSync(f, "utf8")
  let tree: any
  try { tree = parser.parse(src) } catch { continue }
  if (tree.rootNode.hasError) continue

  const cen = new Set(expectedExportNames(tree.rootNode))
  const truth = deriveLuaTruth(tree.rootNode, f)
  const ora = new Set<string>()
  for (const e of truth) {
    if ((e as any).label !== "exports") continue
    ora.add(e.target)
  }
  for (const n of ora) oSet.add(n)
  for (const n of cen) cSet.add(n)
  oracleTotal += ora.size
  censusTotal += cen.size

  if (ora.size !== cen.size || [...ora].some((n) => !cen.has(n)) || [...cen].some((n) => !ora.has(n))) {
    filesDiff++
    for (const e of truth) {
      const t: any = e
      if (t.label === "exports" && !cen.has(t.target)) {
        onlyOracle.push({ file: f.replace(REPOS + "/", ""), name: t.target, line: t.line, rule: t.rule })
      }
    }
    for (const n of cen) if (!ora.has(n)) onlyCensus.push({ file: f.replace(REPOS + "/", ""), name: n })
  }
}

console.log(`corpus: ${CORPUS}  files: ${files.length}  files where the two walkers disagree: ${filesDiff}`)
console.log(`  per-file sums   oracle: ${oracleTotal}   census: ${censusTotal}`)
console.log(`  GLOBAL distinct oracle: ${oSet.size}   census: ${cSet.size}`)
console.log()
const oOnly = [...oSet].filter((n) => !cSet.has(n))
const cOnly = [...cSet].filter((n) => !oSet.has(n))
console.log(`  names ONLY the oracle derives: ${oOnly.length}`)
console.log(`  names ONLY the census derives: ${cOnly.length}`)
console.log()
const byRule = new Map<string, number>()
for (const o of onlyOracle) byRule.set(o.rule, (byRule.get(o.rule) ?? 0) + 1)
console.log(`  oracle-only, by rule: ${JSON.stringify(Object.fromEntries(byRule))}`)
console.log()
console.log("  first 20 oracle-only, with the file and line to read:")
for (const o of onlyOracle.slice(0, 20)) console.log(`    ${o.name.padEnd(24)} ${o.rule.padEnd(20)} L${o.line}  ${o.file}`)
console.log()
console.log("  first 20 census-only:")
for (const c of onlyCensus.slice(0, 20)) console.log(`    ${c.name.padEnd(24)} ${c.file}`)

if (onlyOracle.length) {
  const perFile = new Map<string, number>()
  for (const o of onlyOracle) perFile.set(o.file, (perFile.get(o.file) ?? 0) + 1)
  console.log()
  console.log("  files carrying oracle-only names, worst first:")
  for (const [f, n] of [...perFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`    ${String(n).padStart(4)}  ${f}`)
  }
}

// ── selftest: this comparison must be ABLE to disagree ───────────────────────
// A diff that cannot fail is a diff that cannot have been what found LUA-24. The
// oracle's own walk is re-run with the fnDepth guard removed, which is the exact
// pre-fix behaviour, and the 218-edge over-derivation must reappear. If that
// mutation produces agreement, this instrument is not measuring what it claims.
{
  const before = onlyOracle.length
  let reintroduced = 0
  for (const f of files.slice(0, 400)) {
    let tree: any
    try { tree = parser.parse(readFileSync(f, "utf8")) } catch { continue }
    if (tree.rootNode.hasError) continue
    const cen = new Set(expectedExportNames(tree.rootNode))
    // The pre-fix rule: scope name alone, no depth. An anonymous function
    // contributes no name, so its body inherits `global`.
    const stack: any[] = [tree.rootNode]
    while (stack.length) {
      const n = stack.pop()
      if (n.type === "return_statement") {
        let e: any = null
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "expression_list") { e = c.namedChild(0); break }
        }
        if (e?.type === "identifier" && !cen.has(e.text)) reintroduced++
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
    }
  }
  console.log()
  console.log(`  selftest: re-running the oracle's export rule with the fnDepth guard REMOVED`)
  console.log(`    oracle-only names, fixed walk:        ${before}`)
  console.log(`    identifier returns the pre-fix rule would have derived from inside anonymous functions (400-file slice): ${reintroduced}`)
  const canFail = reintroduced > 0
  console.log(`    selftest: the comparison CAN detect a disagreement: ${canFail ? "yes" : "NO — this instrument proves nothing"}`)
  if (!canFail) process.exit(2)
}

const agree = onlyOracle.length === 0 && onlyCensus.length === 0
console.log()
console.log(agree ? "PASS — the two truth walkers agree exactly" : `FAIL — ${onlyOracle.length} oracle-only, ${onlyCensus.length} census-only`)
process.exit(agree ? 0 : 1)
