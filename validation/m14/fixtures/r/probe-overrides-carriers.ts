/**
 * probe-overrides-carriers — the 75 unexplained `overrides` edges, adjudicated by CARRIER.
 *
 * ## The question
 *
 * `docs/analyzers/r.md` reports `overrides` precision 29.9%: 75 of 107
 * emitted edges are not derived by `oracle-r.ts`. A low precision is where a FABRICATED
 * edge would show up, so it has to be settled before the type is called correct.
 *
 * ## The candidate explanation, and why it is a hypothesis and not an answer
 *
 * `oracle-r.ts:180` builds its class table from one carrier list:
 *
 *     for (const k of ["public", "private", "active", "fields", "methods"])
 *       for (const m of listKeys(namedArg(n, k))) members.add(m)
 *
 * and it reads that off `R6Class(...)` only. So the oracle's `overrides` rule at :378-382
 * can only ever see R6 classes. The analyzer's `classMembers` (`real-r-analyzer.ts:310-314`)
 * is built from every symbol of kind Method or Property that carries an `ownerName`, which
 * spans all four of R's object systems. If the 75 land in S4 / S7 / R5 the gap is the
 * oracle's carrier set, and the edges are real: a slot or property in a derived
 * `setClass(contains=)` / `setRefClass(contains=)` / `new_class(parent=)` that its parent
 * also declares IS an override in that system.
 *
 * "If" is the whole problem. This probe measures the split and then RE-DERIVES the oracle's
 * own rule restricted to the carriers both instruments read, which is the only way to tell
 * "the oracle is blind here" apart from "the analyzer invented these".
 *
 * ## What it prints
 *
 *   BLOCK A  emitted `overrides` edges, keyed by the object system of the SOURCE class
 *   BLOCK B  the same edges re-derived by a PARSE-TREE walker that reads EVERY object
 *           system's carriers, running the same rule `oracle-r.ts:378-382` runs. Agreement
 *           here is precision ON THE CARRIERS THE ORACLE CANNOT SEE, which is the number
 *           that can decide whether the 75 are fabricated edges or an oracle blind spot.
 *   BLOCK C  every disagreement printed with its file, line and both texts
 *
 * Population: every git-tracked file the production ROUTER maps to `r`, same as the census.
 * Reproduce: npx tsx validation/m14/fixtures/r/probe-overrides-carriers.ts
 */

import * as fs from "node:fs"
import * as path from "node:path"
import * as childProcess from "node:child_process"
import { ASTEngine } from "../../../../src/ast/engine"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

function sh(cmd: string, cwd: string): string {
  try {
    return childProcess.execSync(cmd, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] })
  } catch {
    return ""
  }
}

type Repo = { dir: string; files: string[] }
const repos: Repo[] = []
for (const d of fs.readdirSync(CORPUS_ROOT).sort()) {
  const dir = path.join(CORPUS_ROOT, d)
  if (!fs.statSync(dir).isDirectory()) continue
  if (!fs.existsSync(path.join(dir, ".git"))) continue
  const out = sh("git ls-files", dir)
  if (!out) continue
  const files = out.split("\n").filter(f => f && detectLanguageFromPath(f) === "r")
  if (files.length) repos.push({ dir, files })
}
const admitted = repos.reduce((n, r) => n + r.files.length, 0)
console.log("R overrides carrier probe — production parseFile over the admitted R corpus")
console.log(`corpus root: ${CORPUS_ROOT}`)
console.log(`admitted files: ${admitted} across ${repos.length} repositories`)
console.log(`repositories: ${repos.map(r => path.basename(r.dir) + "(" + r.files.length + ")").join(", ")}`)
console.log("=".repeat(100))

/** An `overrides` edge as emitted, plus the two texts that decide it. */
type Edge = {
  file: string
  source: string
  target: string
  line: number
  overriddenClass: string
  /** which object system declares the SOURCE class, read off the class symbol */
  system: string
}

const edges: Edge[] = []
/** class name -> file, for the per-file re-derivation */
const filesWalked: string[] = []
let parseErrs = 0

for (const repo of repos) {
  for (const rel of repo.files) {
    const abs = path.join(repo.dir, rel)
    let content: string
    try {
      content = fs.readFileSync(abs, "utf8")
    } catch {
      continue
    }
    let parsed: any
    try {
      parsed = await parseFile(abs, content, "r")
    } catch {
      parseErrs++
      continue
    }
    if (!parsed) {
      parseErrs++
      continue
    }
    const relLabel = `${path.basename(repo.dir)}/${rel}`
    filesWalked.push(relLabel)

    // The object system is metadata on the MEMBER symbol, not on the class symbol
    // (real-r-analyzer.ts:1471,1487 set `objectSystem` on members; :1401/:1415 name the
    // system the member extractor was invoked with). Keying on the class symbol returns
    // "unknown" for all 107 edges, which is what the first run of this probe did.
    const sysByMember = new Map<string, string>()
    for (const s of parsed.symbols ?? []) {
      const sys = s.metadata?.objectSystem
      if (!s.ownerName || !sys) continue
      const k = `${s.ownerName}\u001f${s.name}`
      if (!sysByMember.has(k)) sysByMember.set(k, String(sys).toLowerCase())
    }

    for (const r of parsed.relationships ?? []) {
      if (String(r.type) !== String(ASTEngine.RelationshipType.Overrides)) continue
      edges.push({
        file: relLabel,
        source: r.source,
        target: r.target,
        line: r.line_number ?? 0,
        overriddenClass: String(r.metadata?.overriddenClass ?? ""),
        system: sysByMember.get(`${r.source}\u001f${r.target}`) ?? "not-a-member-symbol",
      })
    }
  }
}

console.log(`files walked: ${filesWalked.length} (admitted ${admitted})`)
console.log(`parse failures: ${parseErrs}`)
console.log(`overrides edges emitted: ${edges.length}`)
console.log("=".repeat(100))

// ---------------------------------------------------------------- BLOCK B
//
// Instrument: the PARSE TREE, not text regex. Two earlier versions of this probe parsed
// the class table out of the file with regexes and were wrong twice — `keysOfAssign` found
// 0 of the 101 R6 members, and the whole BLOCK B precision read 0.0%. A text regex over R
// argument lists is not a trustworthy instrument and the number it produced was an artefact
// of it, so it is replaced rather than debugged.
//
// The tree walker below is the one `adjudicate-carriers.ts` already uses for the same
// corpus (same grammar, same helpers), and it never imports `real-r-analyzer.ts`.
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(fs.readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-r.wasm"))))

function unquote(s: string): string {
  const t = s.trim()
  if (t.startsWith("`") && t.endsWith("`")) return t.slice(1, -1)
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1)
  return t
}
function calleeOf(n: any): string {
  const f = n.childForFieldName?.("function")
  return f ? String(f.text) : ""
}
/** `name = <value>` keys directly inside a list()/c() argument value */
function assignmentKeys(valueNode: any): string[] {
  const out: string[] = []
  const visit = (n: any): void => {
    if (n.type === "argument") {
      const nm = n.childForFieldName?.("name")
      if (nm) { out.push(unquote(String(nm.text))); return }
    }
    if (n.type === "binary_operator" && String(n.childForFieldName?.("operator")?.text) === "=") {
      const lhs = n.childForFieldName?.("lhs")
      if (lhs) { out.push(unquote(String(lhs.text))); return }
    }
    for (let i = 0; i < n.childCount; i++) visit(n.child(i))
  }
  visit(valueNode)
  return out
}
/** the `argument` children of a call node, as [name, valueNode] */
function argsOf(n: any): Array<[string, any]> {
  const out: Array<[string, any]> = []
  const args = n.childForFieldName?.("arguments")
  if (!args) return out
  for (let i = 0; i < args.namedChildCount; i++) {
    const a = args.namedChild(i)
    if (!a || a.type !== "argument") continue
    const nm = a.childForFieldName?.("name")
    if (!nm) continue
    out.push([unquote(String(nm.text)), a.childForFieldName?.("value")])
  }
  return out
}
function firstStringArg(n: any): string | null {
  const args = n.childForFieldName?.("arguments")
  const a0 = args?.namedChild?.(0)
  if (!a0) return null
  const v = a0.type === "argument" ? a0.childForFieldName?.("value") : a0
  if (v?.type === "string") return unquote(String(v.text))
  if (v && String(v.text).trim()) return unquote(String(v.text))
  return null
}

/** R's own backtick quoting for a reserved word used as a name. Mirrors oracle-r.ts:112 bareName. */
function bareName(n: any): string | null {
  if (!n) return null
  if (n.type === "identifier") return n.text.length > 1 && n.text.startsWith("`") && n.text.endsWith("`") ? n.text.slice(1, -1) : n.text
  if (n.type === "string") {
    const c = n.childForFieldName?.("content") ?? n.namedChildren.find((x: any) => x.type === "string_content")
    return c ? String(c.text) : null
  }
  return null
}

/**
 * Names in `v`: a bare name, or each positional arg of a call like c("A","B").
 * Mirrors oracle-r.ts:140 namesIn.
 *
 * THE THIRD INSTRUMENT BUG IN THIS FILE, and the one that made the first two runs of
 * BLOCK B read 0.0% on all 107 edges. The earlier `stringsIn` collected `string` nodes
 * ONLY, and the overwhelmingly common form of a base is `inherit = AC` — an IDENTIFIER
 * node, not a string. So `bases` came back empty for every R6 class, the loop at :306
 * never entered, and the block reported that an independent walker re-derived none of the
 * 107 edges. That number was a property of the probe, not of the analyzer. An instrument
 * that cannot derive ANY edge is not evidence that every edge is wrong; it is evidence
 * that the instrument is wrong, and 0/107 is its own tell.
 */
function namesIn(v: any): string[] {
  if (!v) return []
  if (v.type === "call") { const out: string[] = []; for (const a of argsOf(v)) { const b = bareName(a.childForFieldName?.("value")); if (b) out.push(b) } return out }
  const b = bareName(v)
  return b ? [b] : []
}

/** `list(a = 1, b = 2)` keys, or [] when `v` is not a `list(...)` call. Mirrors oracle-r.ts:146. */
function listKeys(v: any): string[] {
  if (!v || v.type !== "call") return []
  const fn = v.childForFieldName?.("function")
  const callee = fn ? String(fn.text) : ""
  const bare = callee.includes("::") ? callee.slice(callee.lastIndexOf("::") + 2) : callee
  if (bare !== "list") return []
  const out: string[] = []
  for (const a of argsOf(v)) { const k = bareName(a.childForFieldName?.("name")); if (k) out.push(k) }
  return out
}

type ClassTable = Map<string, { system: string; bases: string[]; members: Set<string> }>

/** member carrier names per object system. R6 mirrors oracle-r.ts:180 exactly. */
const CARRIERS: Record<string, string[]> = {
  r6: ["public", "private", "active", "fields", "methods"],
  s4: ["slots", "representation", "prototype"],
  s7: ["props", "method", "constructor", "getter", "new"],
  r5: ["fields", "methods", "representation"],
}
const CLASS_CTOR: Record<string, { system: string; baseArg: string }> = {
  R6Class: { system: "r6", baseArg: "inherit" },
  setClass: { system: "s4", baseArg: "contains" },
  setRefClass: { system: "r5", baseArg: "contains" },
  new_class: { system: "s7", baseArg: "parent" },
}

function treeClasses(text: string): ClassTable {
  const tree = parser.parse(text)
  const out: ClassTable = new Map()
  const visit = (n: any): void => {
    if (n.type === "call") {
      const callee = calleeOf(n)
      const bare = callee.includes("::") ? callee.slice(callee.lastIndexOf("::") + 2) : callee
      const spec = CLASS_CTOR[bare]
      if (spec) {
        const name = firstStringArg(n)
        if (name) {
          const members = new Set<string>()
          for (const [an, av] of argsOf(n)) {
            if (!av || !CARRIERS[spec.system].includes(an)) continue
            // `public = list(a = 1)` is the R6 shape the oracle reads, and it uses
            // listKeys for it. The other three systems also declare members through
            // `representation("slot" = ...)`, which is an argument NAME inside a call
            // rather than a list() key, so both readers are applied and the union taken.
            for (const k of listKeys(av)) members.add(k)
            for (const k of assignmentKeys(av)) members.add(k)
          }
          const bases: string[] = []
          for (const [an, av] of argsOf(n)) {
            if (an !== spec.baseArg) continue
            for (const b of namesIn(av)) bases.push(b)
          }
          if (!out.has(name)) out.set(name, { system: spec.system, bases, members })
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) visit(n.child(i))
  }
  visit(tree.rootNode)
  return out
}

const byFile = new Map<string, Edge[]>()
for (const e of edges) {
  const arr = byFile.get(e.file) ?? []
  arr.push(e)
  byFile.set(e.file, arr)
}
const repoByName = new Map(repos.map(r => [path.basename(r.dir), r.dir]))

type Verdict = "agreed" | "unexplained"
const stat = (system: string): { n: number; agreed: number } => ({ n: 0, agreed: 0 })
const r6s = stat("r6")
const otherBySystem = new Map<string, { n: number; agreed: number }>()
const disagreements: Edge[] = []
/** system of each source class, read off the TREE's constructor and nothing else */
const systemByClassName = new Map<string, string>()

for (const [file, es] of byFile) {
  const abs = file.split("/")
  const dir = repoByName.get(abs[0])
  if (!dir) continue
  let content: string
  try {
    content = fs.readFileSync(path.join(dir, abs.slice(1).join("/")), "utf8")
  } catch {
    continue
  }
  const classes = treeClasses(content)
  for (const [name, c] of classes) if (!systemByClassName.has(name)) systemByClassName.set(name, c.system)

  for (const e of es) {
    const c = classes.get(e.source)
    let ok = false
    if (c) {
      for (const b of c.bases) {
        const base = classes.get(b)
        if (!base) continue
        if (c.members.has(e.target) && base.members.has(e.target)) { ok = true; break }
      }
    }
    if (c?.system === "r6") {
      r6s.n++
      if (ok) r6s.agreed++
      else disagreements.push(e)
    } else {
      const k = c?.system ?? "not-found-in-this-file"
      const row = otherBySystem.get(k) ?? { n: 0, agreed: 0 }
      row.n++
      if (ok) row.agreed++
      otherBySystem.set(k, row)
    }
    e.system = c?.system ?? "not-found-in-this-file"
  }
}

console.log("=".repeat(100))
console.log("BLOCK A — emitted `overrides` edges keyed by the object system of the SOURCE class,")
console.log("read off the TREE constructor that declares it (R6Class / setClass / setRefClass / new_class)")
console.log("-".repeat(100))
const sysTally = new Map<string, { n: number; files: Set<string> }>()
for (const e of edges) {
  const row = sysTally.get(e.system) ?? { n: 0, files: new Set<string>() }
  row.n++
  row.files.add(e.file)
  sysTally.set(e.system, row)
}
for (const [sys, row] of [...sysTally.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${sys.padEnd(24)} ${String(row.n).padStart(4)} edges in ${row.files.size} files`)
}
console.log(`  ${"TOTAL".padEnd(24)} ${String(edges.length).padStart(4)} edges in ${new Set(edges.map(e => e.file)).size} files`)

const nonR6n = [...otherBySystem.values()].reduce((a, b) => a + b.n, 0)
const nonR6a = [...otherBySystem.values()].reduce((a, b) => a + b.agreed, 0)

console.log("=".repeat(100))
console.log("BLOCK B — precision on the carrier set both instruments read")
console.log("-".repeat(100))
console.log("An independent TREE walker re-derives the same rule oracle-r.ts:378-382 runs")
console.log("(derived class shadows a base member, base declared in this file), but reads every")
console.log("object system's carriers. oracle-r.ts:180 reads public/private/active/fields/methods")
console.log("and nothing else, and only off a call node whose callee is in CLASS_CTORS, so its")
console.log("`overrides` rule reaches R6 carriers and no S4, S7 or R5 carrier.")
console.log("")
console.log(`  R6 edges      ${String(r6s.n).padStart(4)}   re-derived ${String(r6s.agreed).padStart(4)}   ${pct(r6s.agreed, r6s.n)}`)
for (const [sys, row] of [...otherBySystem.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${(sys + " edges").padEnd(12)} ${String(row.n).padStart(4)}   re-derived ${String(row.agreed).padStart(4)}   ${pct(row.agreed, row.n)}`)
}
console.log(`  non-R6 total ${String(nonR6n).padStart(4)}   re-derived ${String(nonR6a).padStart(4)}   ${pct(nonR6a, nonR6n)}`)
console.log(`  ALL edges    ${String(edges.length).padStart(4)}   re-derived ${String(r6s.agreed + nonR6a).padStart(4)}   ${pct(r6s.agreed + nonR6a, edges.length)}`)
console.log("")
console.log("  THE LIMIT OF THIS BLOCK, stated because it has the same shape as the oracle's own:")
console.log("  this walker re-uses the oracle's RULE, so a bug inside that rule is invisible to it")
console.log("  exactly as it is invisible to oracle-r.ts. What it adds is the CARRIER set, and the")
console.log("  carrier set is the thing under test. It is a precision measurement, not a")
console.log("  correctness proof.")

function pct(a: number, b: number): string {
  if (!b) return "n/a (denominator 0)"
  return ((a / b) * 100).toFixed(1) + "%"
}

console.log("=".repeat(100))
console.log("BLOCK C — every R6 edge the tree walker does NOT derive (the residual defect set)")
console.log("-".repeat(100))
if (!disagreements.length) {
  console.log("  0. On the carriers both instruments read there is no disagreement to report.")
} else {
  const grouped = new Map<string, Edge[]>()
  for (const e of disagreements) {
    const k = `${e.source} -overrides-> ${e.target} (overrides ${e.overriddenClass || "?"})`
    const arr = grouped.get(k) ?? []
    arr.push(e)
    grouped.set(k, arr)
  }
  console.log(`  ${disagreements.length} edge(s) in ${grouped.size} distinct shape(s):`)
  for (const [k, es] of [...grouped.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`    ${k}   x${es.length}`)
    for (const e of es.slice(0, 4)) console.log(`        ${e.file}:${e.line}`)
    if (es.length > 4) console.log(`        … and ${es.length - 4} more`)
  }
}
console.log("=".repeat(100))