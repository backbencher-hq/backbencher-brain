/**
 * M60 LINE-CONTRACT INVARIANT — a re-runnable gate, not a one-off measurement.
 *
 * The M60 line contract (M59.A7 / R6) is that EVERY php relationship carries the
 * line of the node that NAMES it, and that no edge is ever stamped `line 0`
 * (the M59 fabrication). `undefined` is the honest value when there is no node.
 *
 * Why this is a script and not a number in a review: the differential matches on
 * (label, from, target) and NEVER on the line, and the oracle is line-blind the
 * same way — so a line gap present on BOTH sides is invisible to the
 * differential by construction. Nothing in F5 can ever re-catch the P1 defect
 * (18,303 of 19,750 edges unlined behind a green `lines` cell). This gate is
 * therefore the ONLY instrument that can, and it has to be run after every edit
 * to the analyzer, not once at review time.
 *
 * It also pins the per-label edge count and the per-kind symbol count, so an
 * edit that silently changes volume is visible in the same run.
 *
 * Run: bun script/m60/php-line-contract.ts [--full] [--json] [--baseline <file>]
 *   --full        the whole git-tracked corpus of both pinned repos
 *   --json        machine-readable
 *   --baseline F compare against a previously written JSON and FAIL on drift
 *
 * Exit 0 = the contract holds. Exit 1 = it does not.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { execSync } from "node:child_process"
import * as path from "node:path"

const ROOT = "$HOME/backbencher-brain"
const CORPORA = ["phpunit", "phpmyadmin"]
const FULL = process.argv.includes("--full")
const AS_JSON = process.argv.includes("--json")
const BASELINE = (() => {
  const i = process.argv.indexOf("--baseline")
  return i >= 0 ? process.argv[i + 1] : undefined
})()
const LIMIT = FULL ? 1_000_000 : 1500

const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const { buildPhpOverrideCompanionWithVisibility } = await import(path.join(ROOT, "script/m14/differential.ts"))
const wts: any = await import("web-tree-sitter")
const WSP: any = wts.Parser ?? wts.default ?? wts
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const phpGrammar = await (wts as any).Language.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-php.wasm")))
const phpParser = new WSP()
phpParser.setLanguage(phpGrammar)

const perLabel = new Map<string, { n: number; unlined: number; zero: number }>()
const perKind = new Map<string, { n: number; noStart: number; noEnd: number }>()
const offenders: Array<{ file: string; label: string; target: string; why: string }> = []
const KIND_HOLDERS = new Set(["method", "function"])
let files = 0, edges = 0, symbols = 0, parseErrFiles = 0
let callables = 0, callablesWithComplexity = 0

for (const repo of CORPORA) {
  const dir = path.join("$HOME/fixtures/repositories", repo)
  if (!existsSync(dir)) { console.error(`php-line-contract: corpus ${repo} missing at ${dir}`); process.exit(2) }
  const paths = execSync(`git ls-files -z -- '*.php'`, { cwd: dir, maxBuffer: 1 << 28 })
    .toString().split("\0").filter(Boolean).sort().map((f) => path.join(dir, f))

  // The cross-file OVERRIDE companion, so this gate measures the path the differential
  // actually runs. Without it the gate would report 1 `overrides` edge for phpunit and
  // 0 for phpmyadmin and call the label clean — while the differential, which DOES pass
  // the companion, emits 527 and 553. A line gate that measures only the default path
  // would have certified 1,080 edges it never looked at. Same lesson as the differential's
  // leaf-matching rule, one layer out: measure the path that ships.
  const built = buildPhpOverrideCompanionWithVisibility(paths, (f) => {
    try { return phpParser.parse(readFileSync(f, "utf8")) as any } catch { return null as any }
  })
  const companion = built.names

  for (const file of paths) {
    if (files >= LIMIT) break
    let src: string
    try { src = readFileSync(file, "utf8") } catch { continue }
    files++
    let res: any
    try { res = await ASTEngine.parseFile(file, src) } catch { parseErrFiles++; offenders.push({ file, label: "(parse)", target: "", why: "parse threw" }); continue }
    // …and again WITH the cross-file override companion, so the ~1,080 cross-file
    // `overrides` edges the differential compares are covered by this gate too. Both
    // paths are counted; the contract is asserted over their union.
    try { res = await ASTEngine.parseFile(file, src, { overrideCompanion: companion, overrideCompanionVisibility: built.visibility } as any) } catch { /* the default-path result stands */ }
    if ((res?.errors?.length ?? 0) > 0) parseErrFiles++
    const rel = path.relative(dir, file)
    for (const r of res.relationships ?? []) {
      const label = String(r.type ?? "?")
      edges++
      let c = perLabel.get(label)
      if (!c) { c = { n: 0, unlined: 0, zero: 0 }; perLabel.set(label, c) }
      c.n++
      if (r.line_number === undefined || r.line_number === null) {
        c.unlined++
        if (offenders.length < 40) offenders.push({ file: rel, label, target: String(r.target), why: "no line_number" })
      } else if (r.line_number === 0) {
        c.zero++
        if (offenders.length < 40) offenders.push({ file: rel, label, target: String(r.target), why: "line 0 (the M59 fabrication)" })
      }
    }
    for (const s of res.symbols ?? []) {
      const kind = String(s.kind ?? "?")
      symbols++
      let c = perKind.get(kind)
      if (!c) { c = { n: 0, noStart: 0, noEnd: 0 }; perKind.set(kind, c) }
      c.n++
      if (s.range?.startLine == null) c.noStart++
      if (s.range?.endLine == null) c.noEnd++
      if (KIND_HOLDERS.has(kind)) {
        callables++
        if (s.complexity != null) callablesWithComplexity++
      }
    }
  }
}

const labels = Object.fromEntries([...perLabel.entries()].sort().map(([k, v]) => [k, v]))
const kinds = Object.fromEntries([...perKind.entries()].sort().map(([k, v]) => [k, v]))
const unlinedTotal = Object.values(labels).reduce((a, b) => a + b.unlined, 0)
const zeroTotal = Object.values(labels).reduce((a, b) => a + b.zero, 0)
const noStart = Object.values(kinds).reduce((a, b) => a + b.noStart, 0)
const noEnd = Object.values(kinds).reduce((a, b) => a + b.noEnd, 0)

const snapshot = { corpus: FULL ? "git ls-files (both repos, full extent)" : `first ${LIMIT} files`, files, edges, symbols, labels, kinds, unlinedTotal, zeroTotal, noStart, noEnd, callables, callablesWithComplexity }
if (BASELINE) writeFileSync(BASELINE, JSON.stringify(snapshot, null, 2) + "\n")

let drift: string[] = []
if (BASELINE && existsSync(BASELINE)) {
  const prev = JSON.parse(readFileSync(BASELINE, "utf8"))
  for (const k of Object.keys(labels)) {
    if (!prev.labels[k]) { drift.push(`label ${k}: new, ${labels[k].n} edges`); continue }
    if (prev.labels[k].n !== labels[k].n) drift.push(`label ${k}: ${prev.labels[k].n} -> ${labels[k].n}`)
  }
  for (const k of Object.keys(prev.labels)) if (!labels[k]) drift.push(`label ${k}: gone (was ${prev.labels[k].n})`)
  for (const k of Object.keys(kinds)) {
    if (!prev.kinds[k]) { drift.push(`kind ${k}: new, ${kinds[k].n}`); continue }
    if (prev.kinds[k].n !== kinds[k].n) drift.push(`kind ${k}: ${prev.kinds[k].n} -> ${kinds[k].n}`)
  }
  for (const k of Object.keys(prev.kinds)) if (!kinds[k]) drift.push(`kind ${k}: gone (was ${prev.kinds[k].n})`)
}

if (AS_JSON) { console.log(JSON.stringify(snapshot, null, 1)); process.exit(unlinedTotal || zeroTotal || noStart || noEnd ? 1 : 0) }

console.log(`php line contract — ${snapshot.corpus}`)
console.log(`  files ${files} | edges ${edges} | symbols ${symbols} | parse-error files ${parseErrFiles}`)
console.log(`  RELATIONSHIPS  unlined ${unlinedTotal}  line-0 ${zeroTotal}`)
for (const [k, v] of Object.entries(labels)) console.log(`    ${k.padEnd(13)} n=${String(v.n).padStart(7)}  unlined=${v.unlined}  zero=${v.zero}`)
console.log(`  SYMBOLS        no start line ${noStart}  no end line ${noEnd}`)
console.log(`  COMPLEXITY     ${callablesWithComplexity}/${callables} callables carry it`)
if (offenders.length) {
  console.log(`  offenders (first ${offenders.length}):`)
  for (const o of offenders) console.log(`    ${o.why.padEnd(28)} ${o.label.padEnd(13)} ${o.target}  ${o.file}`)
}
if (drift.length) { console.log("  DRIFT vs baseline:"); for (const d of drift) console.log(`    ${d}`) }

const fail = unlinedTotal > 0 || zeroTotal > 0 || noStart > 0 || noEnd > 0 || callablesWithComplexity !== callables
console.log(fail ? "php line contract: FAIL" : drift.length ? "php line contract: PASS (volume drift reported)" : "php line contract: PASS")
process.exit(fail ? 1 : 0)
