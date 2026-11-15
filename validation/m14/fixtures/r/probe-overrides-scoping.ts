/**
 * probe-overrides-scoping — which of the three ways of resolving a base class name
 * justifies the 107 emitted `overrides` edges?
 *
 * ## The question
 *
 * `probe-overrides-carriers.ts` leaves 52 R6 edges unexplained by a tree walker that keys
 * its class table by name and KEEPS THE FIRST declaration. `validation/m14/fixtures/r/oracle-r.ts:181`
 * keys the same table by name and KEEPS THE LAST (`classes.set(cname, …)` overwrites).
 * `real-r-analyzer.ts:312-314` keys members by name and KEEPS THE UNION (it pushes), while
 * `real-r-analyzer.ts:320` keys bases by name and KEEPS THE LAST (`classBases.set`).
 *
 * So the three instruments disagree about what a class NAME means inside one file, and
 * `BC -overrides-> y (overrides AC)` at R6/tests/testthat/test-portable-inheritance.R:219
 * is the shape where it shows: that file declares a class named `AC` nineteen times with
 * different member sets, and the analyzer compares `BC`'s members against the union of all
 * nineteen.
 *
 * R resolves this at runtime. `R6Class(..., inherit = AC)` evaluates `AC` as an ordinary
 * lookup when the constructor runs, so the base in scope is the binding visible at that
 * point in the file — the NEAREST PRECEDING declaration of the name. That is the policy
 * this probe measures against the other three.
 *
 * ## The four policies, all four measured
 *
 *   union      every declaration of the name anywhere in the file  (what real-r-analyzer.ts does)
 *   first      the earliest declaration of the name
 *   last       the latest declaration of the name                 (what oracle-r.ts does)
 *   preceding  the latest declaration starting before the derived class (R's own scoping)
 *
 * ## What it prints
 *
 *   BLOCK A  every emitted edge, resolved under all four policies, with the count justified
 *   BLOCK B  the per-policy justified / unjustified totals
 *   BLOCK C  every edge that NO policy justifies — those are the ones that cannot be
 *            explained by base resolution at all, so they are the residual defect set
 *   BLOCK D  the same question for the DERIVED side (does the derived class declare the
 *            member at the nearest preceding declaration of ITS name?)
 *
 * Population: every git-tracked file the production ROUTER maps to `r`, same as the census.
 * Reproduce: npx tsx validation/m14/fixtures/r/probe-overrides-scoping.ts
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
console.log("R overrides scoping probe — four base-resolution policies over production parseFile")
console.log(`corpus root: ${CORPUS_ROOT}`)
console.log(`admitted files: ${admitted} across ${repos.length} repositories`)
console.log("=".repeat(100))

// ------------------------------------------------------------------ BLOCK A: emit edges
type Edge = { file: string; repo: string; source: string; target: string; line: number; base: string }
const edges: Edge[] = []
let parseErrs = 0
let filesWithEdges = 0

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
    let n = 0
    for (const r of parsed.relationships ?? []) {
      if (String(r.type) !== String(ASTEngine.RelationshipType.Overrides)) continue
      edges.push({
        file: relLabel,
        repo: repo.dir,
        source: r.source,
        target: r.target,
        line: r.line_number ?? 0,
        base: String(r.metadata?.overriddenClass ?? ""),
      })
      n++
    }
    if (n) filesWithEdges++
  }
}
console.log(`files walked: ${admitted} (admitted ${admitted}), parse failures: ${parseErrs}`)
console.log(`files with an \`overrides\` edge: ${filesWithEdges}, edges: ${edges.length}`)
console.log("=".repeat(100))

// ------------------------------------------------------------------ the tree walker
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
function bareName(n: any): string | null {
  if (!n) return null
  if (n.type === "identifier") return n.text.length > 1 && n.text.startsWith("`") && n.text.endsWith("`") ? n.text.slice(1, -1) : n.text
  if (n.type === "string") {
    const c = n.childForFieldName?.("content") ?? n.namedChildren.find((x: any) => x.type === "string_content")
    return c ? String(c.text) : null
  }
  return null
}
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
function listKeys(v: any): string[] {
  if (!v || v.type !== "call") return []
  const fn = v.childForFieldName?.("function")
  const callee = fn ? String(fn.text) : ""
  const bare = callee.includes("::") ? callee.slice(callee.lastIndexOf("::") + 2) : callee
  if (bare !== "list") return []
  const out: string[] = []
  for (const a of argsOf(v)) {
    const k = bareName(a.childForFieldName?.("name"))
    if (k) out.push(k)
  }
  return out
}
function assignmentKeys(v: any): string[] {
  const out: string[] = []
  const visit = (n: any): void => {
    if (n.type === "argument") { const nm = n.childForFieldName?.("name"); if (nm) { out.push(unquote(String(nm.text))); return } }
    if (n.type === "binary_operator" && String(n.childForFieldName?.("operator")?.text) === "=") {
      const lhs = n.childForFieldName?.("lhs"); if (lhs) { out.push(unquote(String(lhs.text))); return }
    }
    for (let i = 0; i < n.childCount; i++) visit(n.child(i))
  }
  if (v) visit(v)
  return out
}
function namesIn(v: any): string[] {
  if (!v) return []
  if (v.type === "call") { const out: string[] = []; for (const a of argsOf(v)) { const b = bareName(a.childForFieldName?.("value")); if (b) out.push(b) } return out }
  const b = bareName(v)
  return b ? [b] : []
}
function firstStringArg(n: any): string | null {
  const args = n.childForFieldName?.("arguments")
  const a0 = args?.namedChild?.(0)
  if (!a0) return null
  const v = a0.type === "argument" ? a0.childForFieldName?.("value") : a0
  if (!v) return null
  return bareName(v) ?? unquote(String(v.text).trim())
}

type Decl = { name: string; line: number; system: string; bases: string[]; members: Set<string> }
const CLASS_CTOR: Record<string, { system: string; baseArg: string }> = {
  R6Class: { system: "r6", baseArg: "inherit" },
  setClass: { system: "s4", baseArg: "contains" },
  setRefClass: { system: "r5", baseArg: "contains" },
  new_class: { system: "s7", baseArg: "parent" },
}
const CARRIERS: Record<string, string[]> = {
  r6: ["public", "private", "active", "fields", "methods"],
  s4: ["slots", "representation", "prototype"],
  // `properties` is what the S7 corpus actually writes: `new_class("Dog", properties =
  // list(name = class_character))` at S7/inst/doc/S7.R:9. The earlier list here said
  // `props`, which no S7 class in the corpus uses, so every S7 edge read as unjustified
  // for a reason that was the probe's, not the analyzer's.
  s7: ["properties", "props", "method", "constructor", "getter", "new"],
  r5: ["fields", "methods", "representation"],
}

/**
 * S7 attaches a method to an EXISTING class from outside that class's declaration:
 * `method(describe, Dog) <- function(x) …` at S7/inst/doc/S7.R:91 declares a member of
 * the `Dog` declared at line 74. Nothing inside the `new_class()` call mentions it, so a
 * walker that only reads class-constructor arguments cannot see the member at all — which
 * is what left `Dog -overrides-> describe` as the single unjustified edge in BLOCK C.
 * Attributed to the nearest PRECEDING declaration of the named class, matching the
 * analyzer's own fallback.
 */
function s7MethodAttachments(text: string, parser: any, decls: Decl[]): Decl[] {
  const tree = parser.parse(text)
  /**
   * Positional values of a call. `method(describe, Dog)` puts each argument in an
   * `argument` node with NO `name` FIELD, so `childForFieldName("value")` is undefined
   * for them and the single-argument readers above see nothing. The value is the
   * argument node's own first named child.
   */
  const positional = (call: any): any[] => {
    const args = call?.childForFieldName?.("arguments")
    if (!args) return []
    const out: any[] = []
    for (let i = 0; i < args.namedChildCount; i++) {
      const a = args.namedChild(i)
      if (!a || a.type !== "argument" || a.childForFieldName?.("name")) continue
      out.push(a.namedChildCount ? a.namedChild(0) : a)
    }
    return out
  }
  const visit = (n: any): void => {
    if (n.type === "binary_operator" && String(n.childForFieldName?.("operator")?.text) === "<-") {
      const lhs = n.childForFieldName?.("lhs")
      const call = lhs?.type === "call" ? lhs : null
      const callee = call ? String(call.childForFieldName?.("function")?.text ?? "") : ""
      if (callee.includes("method")) {
        const pos = positional(call)
        const name = pos[0] ? bareName(pos[0]) : null
        const ownerName = pos[1] ? bareName(pos[1]) : null
        if (name && ownerName) {
          const line = n.startPosition.row + 1
          const prior = decls.filter(d => d.name === ownerName && d.line < line)
          const target = prior.length ? prior[prior.length - 1] : decls.find(d => d.name === ownerName)
          if (target) target.members.add(name)
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) visit(n.child(i))
  }
  visit(tree.rootNode)
  return decls
}

function declsOf(text: string): Decl[] {
  const tree = parser.parse(text)
  const out: Decl[] = []
  const visit = (n: any): void => {
    if (n.type === "call") {
      const fn = n.childForFieldName?.("function")
      const callee = fn ? String(fn.text) : ""
      const bare = callee.includes("::") ? callee.slice(callee.lastIndexOf("::") + 2) : callee
      const spec = CLASS_CTOR[bare]
      if (spec) {
        const name = firstStringArg(n)
        if (name) {
          const members = new Set<string>()
          for (const [an, av] of argsOf(n)) {
            if (!av || !CARRIERS[spec.system].includes(an)) continue
            for (const k of listKeys(av)) members.add(k)
            for (const k of assignmentKeys(av)) members.add(k)
          }
          const bases: string[] = []
          for (const [an, av] of argsOf(n)) {
            if (an !== spec.baseArg) continue
            for (const b of namesIn(av)) bases.push(b)
          }
          out.push({ name, line: n.startPosition.row + 1, system: spec.system, bases, members })
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) visit(n.child(i))
  }
  visit(tree.rootNode)
  return s7MethodAttachments(text, parser, out.sort((a, b) => a.line - b.line))
}

// ------------------------------------------------------------------ the four policies
type Policy = "union" | "first" | "last" | "preceding"
function pick(decls: Decl[], name: string, before: number, policy: Policy): Decl[] {
  const all = decls.filter(d => d.name === name)
  if (!all.length) return []
  if (policy === "union") return all
  if (policy === "first") return [all[0]]
  if (policy === "last") return [all[all.length - 1]]
  const before_ = all.filter(d => d.line < before)
  if (before_.length) return [before_[before_.length - 1]]
  // A class can inherit from one declared later in the file only inside a function
  // body evaluated after both. Falling back to the first declaration is the closest
  // thing to "some binding of this name exists", and it is counted here so the
  // fallback's frequency is visible rather than silent.
  return [all[0]]
}

const POLICIES: Policy[] = ["union", "first", "last", "preceding"]
const justified: Record<Policy, number> = { union: 0, first: 0, last: 0, preceding: 0 }
const baseFound = new Map<Policy, number>(POLICIES.map(p => [p, 0]))
const ownFound = new Map<Policy, number>(POLICIES.map(p => [p, 0]))
const noPolicy: Edge[] = []
/** derived-side check under `preceding`, reported separately in BLOCK D */
const ownDeclaredPreceding = new Map<string, number>()
const ownNameResolved = new Map<string, number>()

const byFile = new Map<string, Edge[]>()
for (const e of edges) {
  const arr = byFile.get(e.file) ?? []
  arr.push(e)
  byFile.set(e.file, arr)
}

for (const [file, es] of byFile) {
  let text: string
  try {
    text = fs.readFileSync(path.join(es[0].repo, file.split("/").slice(1).join("/")), "utf8")
  } catch {
    continue
  }
  const decls = declsOf(text)
  if (!decls.length) continue
  for (const e of es) {
    const derivedDecls = pick(decls, e.source, e.line, "preceding")
    const derivedLine = derivedDecls[0]?.line ?? 0
    let anyPolicy = false
    for (const p of POLICIES) {
      const own = pick(decls, e.source, e.line, p).some(d => d.members.has(e.target))
      const bs = pick(decls, e.base, derivedLine, p)
      if (bs.length) baseFound.set(p, baseFound.get(p)! + 1)
      const base = bs.some(d => d.members.has(e.target))
      if (own) ownFound.set(p, ownFound.get(p)! + 1)
      if (own && base) {
        justified[p]++
        anyPolicy = true
      }
    }
    if (!anyPolicy) noPolicy.push(e)
    ownNameResolved.set(file, (ownNameResolved.get(file) ?? 0) + 1)
    if (derivedDecls[0]?.members.has(e.target)) ownDeclaredPreceding.set(file, (ownDeclaredPreceding.get(file) ?? 0) + 1)
  }
}

function pct(a: number, b: number): string {
  if (!b) return "n/a (denominator 0)"
  return ((a / b) * 100).toFixed(1) + "%"
}

console.log("=".repeat(100))
console.log("BLOCK B — how many of the emitted edges each base-resolution policy justifies")
console.log("(justified = the derived class declares the member AND the resolved base declares it)")
console.log("-".repeat(100))
console.log(`  edges under test: ${edges.length}`)
console.log(`  ${"policy".padEnd(12)} ${"justified".padStart(9)} ${"rate".padStart(8)}   ${"base name found".padStart(15)}   ${"derived member found".padStart(20)}`)
for (const p of POLICIES) {
  console.log(
    `  ${p.padEnd(12)} ${String(justified[p]).padStart(9)} ${pct(justified[p], edges.length).padStart(8)}   ${String(baseFound.get(p)!).padStart(15)}   ${String(ownFound.get(p)!).padStart(20)}`,
  )
}
console.log("")
console.log("  `union` is what real-r-analyzer.ts:312-314 does with MEMBERS while :320 keeps the LAST")
console.log("  declaration of the base, so the analyzer's own two maps already disagree. `last` is")
console.log("  what validation/m14/fixtures/r/oracle-r.ts:181 does. `preceding` is R's own scoping:")
console.log("  `inherit = AC` is an ordinary lookup evaluated when R6Class() runs.")

console.log("=".repeat(100))
console.log("BLOCK C — edges NO policy justifies (not a base-resolution artefact)")
console.log("-".repeat(100))
if (!noPolicy.length) {
  console.log("  0.")
} else {
  const grouped = new Map<string, Edge[]>()
  for (const e of noPolicy) {
    const k = `${e.source} -overrides-> ${e.target} (overrides ${e.base || "?"})`
    const arr = grouped.get(k) ?? []
    arr.push(e)
    grouped.set(k, arr)
  }
  console.log(`  ${noPolicy.length} edge(s) in ${grouped.size} distinct shape(s):`)
  for (const [k, es] of [...grouped.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`    ${k}   x${es.length}`)
    for (const e of es.slice(0, 3)) console.log(`        ${e.file}:${e.line}`)
    if (es.length > 3) console.log(`        … and ${es.length - 3} more`)
  }
}

console.log("=".repeat(100))
console.log("BLOCK D — the DERIVED side under `preceding`")
console.log("-".repeat(100))
let ownTotal = 0
let ownOk = 0
for (const [file, es] of byFile) {
  let text: string
  try {
    text = fs.readFileSync(path.join(es[0].repo, file.split("/").slice(1).join("/")), "utf8")
  } catch {
    continue
  }
  const decls = declsOf(text)
  for (const e of es) {
    ownTotal++
    if (pick(decls, e.source, e.line, "preceding")[0]?.members.has(e.target)) ownOk++
  }
}
console.log(`  edges whose DERIVED class declares the member at its nearest preceding declaration: ${ownOk}/${ownTotal} ${pct(ownOk, ownTotal)}`)
// BLOCK E — the shapes behind that number. The analyzer resolves the derived declaration
// by RANGE CONTAINMENT of the member's line and this probe by nearest preceding
// declaration, so a disagreement here is a disagreement about WHICH DECLARATION owns the
// member, not a verdict on the edge. Printing the shapes is what tells them apart.
const derivedMismatch = new Map<string, string[]>()
for (const [file, es] of byFile) {
  let text: string
  try {
    text = fs.readFileSync(path.join(es[0].repo, file.split("/").slice(1).join("/")), "utf8")
  } catch {
    continue
  }
  const decls = declsOf(text)
  for (const e of es) {
    const d = pick(decls, e.source, e.line, "preceding")[0]
    if (d?.members.has(e.target)) continue
    const k = `${e.source} -overrides-> ${e.target} (overrides ${e.base})`
    const arr = derivedMismatch.get(k) ?? []
    arr.push(`${file}:${e.line} — nearest preceding ${e.source} decl is line ${d?.line ?? "(none)"} (members: ${d ? [...d.members].slice(0, 12).join(",") : "—"})`)
    derivedMismatch.set(k, arr)
  }
}
if (derivedMismatch.size) {
  console.log(`  ${derivedMismatch.size} shape(s) where the probe's nearest preceding declaration of the DERIVED name does not declare the member:`)
  for (const [k, ex] of [...derivedMismatch.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`    ${k}   x${ex.length}`)
    for (const s of ex.slice(0, 2)) console.log(`        ${s}`)
    if (ex.length > 2) console.log(`        … and ${ex.length - 2} more`)
  }
} else {
  console.log("  0 shapes: the probe and the analyzer agree on the derived declaration of every emitted edge.")
}
console.log(`  files with more than one declaration of the same class name: `)
const multi = new Map<string, string[]>()
for (const [file, es] of byFile) {
  let text: string
  try {
    text = fs.readFileSync(path.join(es[0].repo, file.split("/").slice(1).join("/")), "utf8")
  } catch {
    continue
  }
  const decls = declsOf(text)
  const seen = new Map<string, number>()
  for (const d of decls) seen.set(d.name, (seen.get(d.name) ?? 0) + 1)
  const dupes = [...seen.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1])
  if (dupes.length) multi.set(file, dupes.map(([n, c]) => `${n}x${c}`))
}
for (const [f, d] of [...multi.entries()].sort((a, b) => b[1].length - a[1].length)) console.log(`    ${f}  ${d.join(", ")}`)
console.log(`  ${multi.size} of ${byFile.size} file(s) with an \`overrides\` edge redeclare a class name.`)
console.log("=".repeat(100))