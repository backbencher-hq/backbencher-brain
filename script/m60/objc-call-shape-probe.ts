/**
 * script/m60/objc-call-shape-probe.ts — WHAT SHAPE OF CALL DOES THIS CORPUS HAVE,
 * and which shapes the analyzer reads.
 *
 * WHY THIS FILE EXISTS. `script/m60/objc-construct-site-probe.ts` reported
 *
 *     calls: 83 of 10734 construct sites have no emitted edge of that type
 *        afnetworking/AFNetworking/AFURLSessionManager.m:159 observeValueForKeyPath:...>self
 *        afnetworking/AFNetworking/AFNetworkReachabilityManager.m:220 startMonitoring>strongSelf
 *
 * Every sample had a RECIPIENT (`self`, `strongSelf`) where the probe's own
 * derivation wanted a callee name, which is the signature of a derivation bug rather
 * than an analyzer gap — and a construct-site count that is wrong cannot answer the
 * question the workstream asks ("does the analyzer read every construct the grammar
 * produces?"). This file re-derives the site key from the SHAPE of the callee instead
 * of from the first identifier anywhere inside the node, and partitions every call site
 * in the corpus by that shape so the residue is countable rather than described.
 *
 * It also measures two constructs with a dependency meaning that the ten-type census
 * has no row for at all: `@import Module;` (Objective-C MODULES — a second, distinct
 * dependency declaration beside `#import`, and the one Swift's importer speaks) and
 * `#define` macro invocations (a `preproc_call`, which the grammar keeps separate from a
 * `call_expression`).
 *
 * PURE AST. No regular expression anywhere: corpus discovery is `git ls-files`, the
 * shapes are read off `node.type` / named children, and the inventory filter is token
 * equality over a hand-rolled scanner rather than a pattern match.
 *
 * READ-ONLY. Writes nothing unless --json is passed.
 *
 * Usage: bun run script/m60/objc-call-shape-probe.ts [--json <path>]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const OBJC_CORPUS = path.join(CORPUS_ROOT, "objc")
const SEP = "\u0001"

// ---------------------------------------------------------------- corpus
type FileRow = { label: string; abs: string; text: string }
const files: FileRow[] = []
for (const e of readdirSync(OBJC_CORPUS)) {
  const dir = path.join(OBJC_CORPUS, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "ls-files", "-z"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch { continue }
    // The ROUTER's admission, not an extension list.
    if (detectLanguageFromPath(abs, text) !== "objective-c") continue
    files.push({ label: `${e}/${rel}`, abs, text })
  }
}
const revs: Record<string, string> = {}
for (const e of readdirSync(OBJC_CORPUS)) {
  try { revs[e] = execFileSync("git", ["-C", path.join(OBJC_CORPUS, e), "rev-parse", "HEAD"], { encoding: "utf8" }).trim().slice(0, 12) } catch { /* not a repo */ }
}
console.log(`OBJECTIVE_C call-shape probe`)
for (const [r, v] of Object.entries(revs).sort()) console.log(`  corpus ${r} @ ${v}`)
console.log(`  admitted files (router universe): ${files.length}`)

// ---------------------------------------------------------------- tree
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-objc.wasm"))))

const named = (n: any): any[] => { const o: any[] = []; for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) o.push(c) } return o }
const deepFindAll = (n: any, t: string, out: any[] = []): any[] => {
  if (n.type === t) out.push(n)
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) deepFindAll(c, t, out) }
  return out
}
const inBody = (n: any): boolean => {
  let p = n.parent, guard = 0
  while (p && guard++ < 400) {
    const t = p.type
    if (t === "method_definition" || t === "method_declaration" || t === "function_definition" || t === "block_literal") return true
    p = p.parent
  }
  return false
}
/** The enclosing method selector or function name — the analyzer's relationship source. */
const enclosingName = (n: any): string => {
  let p = n.parent, guard = 0
  while (p && guard++ < 400) {
    if (p.type === "method_definition" || p.type === "method_declaration") {
      const kids = named(p)
      let sel = ""
      for (let i = 0; i < kids.length; i++) {
        if (kids[i].type !== "identifier") continue
        sel += kids[i].text
        if (kids[i + 1]?.type === "method_parameter") sel += ":"
      }
      return sel
    }
    if (p.type === "function_definition") {
      const fd = deepFindAll(p, "function_declarator")[0]
      const id = fd ? deepFindAll(fd, "identifier")[0] : undefined
      return id ? id.text : "(fn)"
    }
    p = p.parent
  }
  return ""
}

// ---------------------------------------------------------------- shapes
/** Call sites partitioned by the SHAPE of the callee, which is what decides what edge —
 *  if any — the language can support. A callee that is a bare `identifier` names a C
 *  function or a block value. A callee that is a `field_expression` names a PROPERTY or
 *  IVAR of some object: `self.downloadProgressBlock(f)` invokes a block stored in a
 *  property. A callee that is a `pointer_expression` is C's `fp->field(x)`. */
type Shape = "identifier" | "field_expression" | "pointer_expression" | "subscript_expression" | "parenthesized_expression" | "other"
const shapes = new Map<Shape, { n: number; files: Set<string>; samples: string[]; keys: Set<string>; pairs: Set<string> }>()
const noteShape = (s: Shape, f: FileRow, line: number, key: string, sample: string): void => {
  let r = shapes.get(s)
  if (!r) { r = { n: 0, files: new Set(), samples: [], keys: new Set(), pairs: new Set() }; shapes.set(s, r) }
  r.n++
  r.files.add(f.label)
  r.keys.add(`${f.label}${SEP}${line}${SEP}${key}`)
  // The ANALYZER dedups on (type, source, target) per file, so a site count is not the
  // number of edges a shape can produce. This is that number. The first version of this
  // file printed `keys.size` under a heading that said "distinct src>callee" while the
  // key still carried the LINE, so every one of the 823 field-callee sites read as its
  // own pair and the heading claimed a resolution the key did not have.
  r.pairs.add(`${f.label}${SEP}${key}`)
  if (r.samples.length < 6) r.samples.push(`${f.label}:${line} ${sample}`)
}
/** Names DECLARED in this file, so a field callee can be classified as resolvable here
 *  or only in another translation unit — the difference between a fact and a guess. */
const declaredInFile = new Map<string, Set<string>>()
/** `#define NAME(...)` — a macro is not a function; the grammar keeps its invocation
 *  site as a `preproc_call` when it appears in a directive, but a macro USED in code is
 *  just an identifier, so it is indistinguishable from a C callee at this level. */
const macroDefs = new Map<string, number>()
const moduleImports = new Map<string, number>()
const moduleImportSites: Array<{ label: string; line: number; text: string; kids: string[] }> = []
const preprocCalls = new Map<string, number>()
let callSitesTotal = 0
const emitOnlyCount = { newCalls: 0, protocolDirective: 0, notInBody: 0, atDirective: 0 }

let idx = 0
const CONC = 6
await Promise.all(Array.from({ length: CONC }, async () => {
  while (true) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    let tree: any
    try { tree = parser.parse(f.text) } catch { continue }
    if (!tree) continue
    // Pass 1: what this file declares.
    const here = new Set<string>()
    const root = tree.rootNode
    for (const c of walk(root)) {
      if (c.type === "property_declaration" || c.type === "instance_variable") {
        for (const id of deepFindAll(c, "identifier")) here.add(id.text)
        for (const id of deepFindAll(c, "field_identifier")) here.add(id.text)
      }
      if (c.type === "preproc_function_def" || c.type === "preproc_def") {
        for (const id of deepFindAll(c, "identifier")) { macroDefs.set(id.text, (macroDefs.get(id.text) ?? 0) + 1); here.add(id.text) }
      }
    }
    declaredInFile.set(f.label, here)
    // Pass 2: every call-shaped site, and the module-import construct.
    for (const c of walk(root)) {
      const line = c.startPosition.row + 1
      if (c.type === "module_import") {
        const m = moduleImports.get(c.type) ?? 0
        moduleImports.set(c.type, m + 1)
        moduleImportSites.push({ label: f.label, line, text: c.text, kids: named(c).map((k: any) => `${k.type}:${k.text}`) })
      }
      if (c.type === "preproc_call") {
        const id = deepFindAll(c, "identifier")[0]
        const k = id ? id.text : "<none>"
        preprocCalls.set(k, (preprocCalls.get(k) ?? 0) + 1)
      }
      if (c.type !== "call_expression") continue
      callSitesTotal++
      const fn = named(c)[0]
      const src = enclosingName(c)
      const line2 = c.startPosition.row + 1
      if (!inBody(c)) { emitOnlyCount.notInBody++; continue }
      // `@protocol(P)` / `@encode(...)` are directives: they NAME, they never call.
      let inAtDirective = false
      { let p: any = c.parent, g = 0
        while (p && g++ < 3) { if (p.type === "at_expression") { inAtDirective = true; break } if (p.type === "message_expression" || p.type === "call_expression") break; p = p.parent } }
      const fnText = fn ? fn.text : ""
      if (inAtDirective && fn && fn.type === "identifier" && fn.text === "protocol") { emitOnlyCount.protocolDirective++; continue }
      if (fn && fn.type === "identifier" && fn.text === "new") emitOnlyCount.newCalls++
      if (!fn) { noteShape("other", f, line2, `${src}>`, c.text.slice(0, 60)); continue }
      const key = fn.type === "identifier" ? `${src}>${fn.text}` : `${src}>${fn.text.split(".").pop() ?? fn.text}`
      const sample = `${src}  ::  ${c.text.split("\n")[0]!.slice(0, 60)}`
      if (fn.type === "identifier") noteShape("identifier", f, line2, key, sample)
      else if (fn.type === "field_expression") noteShape("field_expression", f, line2, key, sample)
      else if (fn.type === "pointer_expression") noteShape("pointer_expression", f, line2, key, sample)
      else if (fn.type === "subscript_expression") noteShape("subscript_expression", f, line2, key, sample)
      else if (fn.type === "parenthesized_expression") noteShape("parenthesized_expression", f, line2, key, sample)
      else noteShape("other", f, line2, key, sample)
    }
  }
}))

function* walk(n: any): Generator<any> {
  yield n
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) yield* walk(c) }
}

// ---------------------------------------------------------------- report
const ORDER: Shape[] = ["identifier", "field_expression", "pointer_expression", "subscript_expression", "parenthesized_expression", "other"]
console.log(`\nCALL SITES BY CALLEE SHAPE — every call_expression node in the admitted universe`)
console.log(`  (the callee SHAPE, not the first identifier inside it, decides what edge the language can carry)`)
console.log(`\n${"shape".padEnd(26)} ${"sites".padStart(7)} ${"files".padStart(6)} ${"distinct src>callee".padStart(21)}`)
console.log("-".repeat(66))
const report: Record<string, unknown> = {}
for (const s of ORDER) {
  const r = shapes.get(s)
  if (!r) { console.log(`${s.padEnd(26)} ${String(0).padStart(7)} ${String(0).padStart(6)} ${String(0).padStart(21)}`); report[s] = { sites: 0, files: 0 }; continue }
  console.log(`${s.padEnd(26)} ${String(r.n).padStart(7)} ${String(r.files.size).padStart(6)} ${String(r.pairs.size).padStart(21)}`)
  report[s] = { sites: r.n, files: r.files.size, distinctFileSrcCallee: r.pairs.size, samples: r.samples }
}
console.log("-".repeat(66))
console.log(`  call_expression nodes total: ${callSitesTotal}`)
console.log(`  outside a method/function/block body (no edge by design): ${emitOnlyCount.notInBody}`)
console.log(`  @protocol(P) directives (name, never call): ${emitOnlyCount.protocolDirective}`)

console.log(`\nFIELD-EXPRESSION CALLEES — the shape the analyzer publishes no edge for`)
const fr = shapes.get("field_expression")
if (fr) {
  const declaredHere: string[] = []
  const external: string[] = []
  for (const k of fr.keys) {
    const [label, , pair] = k.split(SEP)
    const name = (pair ?? "").split(">")[1] ?? ""
    const here = declaredInFile.get(label ?? "") ?? new Set<string>()
    if (here.has(name)) declaredHere.push(k); else external.push(k)
  }
  console.log(`  callee is a name THIS file declares (a property or ivar of a class here): ${declaredHere.length}`)
  console.log(`  callee is declared elsewhere or nowhere in this corpus:              ${external.length}`)
  const byName = new Map<string, number>()
  for (const k of fr.keys) { const nm = (k.split(SEP)[2] ?? "").split(">")[1] ?? "?"; byName.set(nm, (byName.get(nm) ?? 0) + 1) }
  console.log(`  distinct callee names: ${byName.size}`)

  for (const [nm, n] of [...byName.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)}  ${nm}`)
  for (const s of fr.samples) console.log(`    e.g. ${s}`)
  report.fieldCalleeDeclaredHere = declaredHere.length
  report.fieldCalleeNotDeclaredHere = external.length
  report.fieldCalleeSamples = fr.samples
}

console.log(`\nMACRO INVOCATIONS (a #define is not a function; the grammar cannot separate them at a call site)`)
console.log(`  distinct macro NAMES defined in the corpus: ${macroDefs.size}`)
console.log(`  preproc_call nodes (an invocation INSIDE a directive): ${[...preprocCalls.values()].reduce((a, b) => a + b, 0)} across ${preprocCalls.size} distinct names`)

console.log(`\nMODULE IMPORTS (@import Module;) — Objective-C's SECOND dependency declaration`)
const miTotal = [...moduleImports.values()].reduce((a, b) => a + b, 0)
console.log(`  nodes: ${miTotal} ${JSON.stringify(Object.fromEntries(moduleImports))}`)
for (const s2 of moduleImportSites) console.log(`    ${s2.label}:${s2.line}  ${JSON.stringify(s2.text)}  children=[${s2.kids.join(", ")}]`)
console.log(`  #import / #include directives for comparison: see the census construct probe (904)`)

const j = process.argv.indexOf("--json")
if (j > 0 && process.argv[j + 1]) {
  writeFileSync(process.argv[j + 1], JSON.stringify({ at: new Date().toISOString(), corpus: revs, admittedFiles: files.length, callSitesTotal, byShape: report, moduleImports: Object.fromEntries(moduleImports), macroNamesDefined: macroDefs.size, preprocCalls: Object.fromEntries(preprocCalls) }, null, 2))
  console.log(`\nwrote ${process.argv[j + 1]}`)
}