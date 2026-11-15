#!/usr/bin/env bun
/**
 * DERIV_EXPORTS_SWIFT4 — the `exports` CONSTRUCT PROBE, on the parse tree.
 *
 * THE QUESTION. Swift has no `export` keyword. Is `exports` therefore RULED
 * (like TOML, where inventing one "would be worse than a thin graph"), or is
 * the language's export construct real and merely spelled differently?
 *
 * WHAT THE GRAMMAR ITSELF SAYS (probe: `shape.mts`, this directory).
 *
 *   `public import Foundation`
 *     import_declaration
 *       modifiers
 *         visibility_modifier          <- NAMED node
 *           "public"                   <- the anonymous keyword token inside it
 *       "import"  identifier
 *
 *   `@_exported import Utils`
 *     import_declaration
 *       modifiers
 *         attribute                    <- NAMED node
 *           user_type > type_identifier "_exported"
 *       "import"  identifier
 *
 *   `public protocol P` / `open class C` / `public func g` — the SAME
 *   `modifiers > visibility_modifier` shape on every declaration.
 *
 * So there are three distinct export constructs, and the first probe got 0 on
 * all of them because it looked for an ANONYMOUS token as a direct child of the
 * declaration. The modifier is one wrapper down and NAMED. A probe that gets 0
 * on a construct the grammar demonstrably reduces is measuring the probe.
 *
 * THE THREE FORMS
 *
 *   1. `public import M`      (SE-0409 access-level-on-import, Swift 6).
 *      A public import RE-EXPORTS M: importers of this module get M's symbols.
 *      The edge `exports root -> M` is the construct, not a convention.
 *   2. `@_exported import M`  (the underscored predecessor of the same thing).
 *      Same meaning, older spelling, still in the stdlib.
 *   3. `public`/`open`/`package` on a DECLARATION. This is Swift's `pub` — the
 *      accessor that makes a name part of the module's public interface, the
 *      direct analogue of zig's `pub fn` (which the zig lane emits as `exports`)
 *      and of Go's capitalized package-scope name (which the go lane emits as
 *      `exports`).
 *
 * INSTRUMENT. B: parse-tree semantic count. The grammar inventory (A) cannot
 * settle this — `visibility_modifier` is present whether or not any
 * declaration carries it, exactly as the ontology gate's header says a grammar
 * cannot see a CONVENTION. So the count is made on the tree, where a string
 * literal or a comment cannot fake it.
 *
 * NO REGEX. Every check is `node.type`, `node.isNamed`, and named-child
 * identity. Nothing reads source text.
 *
 * POPULATION. Derived from `git ls-files` per repo over the corpus root, and
 * the count of files it actually walked is printed next to every number.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"

const REPO_ROOT = path.resolve(import.meta.dir, "..", "..", "..", "..")
const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const WANT_REPOS = (process.env.REPOS ?? "swift-corpus,swift-nio,alamofire").split(",").map((s) => s.trim())
const STRIDE = Number(process.env.STRIDE ?? 1)

const files: Array<{ repo: string; rel: string; abs: string; text: string }> = []
for (const entry of readdirSync(CORPUS)) {
  if (!WANT_REPOS.includes(entry)) continue
  const dir = path.join(CORPUS, entry)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!rel.endsWith(".swift")) continue
    const abs = path.join(dir, rel)
    let size = 0
    try { size = statSync(abs).size } catch { continue }
    if (size > 5 * 1024 * 1024) continue
    let text: string
    try { text = readFileSync(abs, "utf8") } catch { continue }
    files.push({ repo: entry, rel, abs, text })
  }
}
const sample = STRIDE > 1 ? files.filter((_, i) => i % STRIDE === 0) : files
console.log(`population: ${files.length} .swift files derived (git ls-files over ${WANT_REPOS.join(", ")}); walking ${sample.length}${STRIDE > 1 ? ` (stride ${STRIDE})` : " (whole set)"}`)

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join("/home/ishaq2321/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(REPO_ROOT, "wasm", "tree-sitter-swift.wasm"))))

/** The visibility keyword of a node, read from `modifiers > visibility_modifier`
 *  the same way the analyzer's own getVisibility reads it: the NAMED
 *  `visibility_modifier` node's own text. Returns null when there is none. */
function visibilityOf(node: any): string | null {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (!c || c.type !== "modifiers") continue
    for (let j = 0; j < c.namedChildCount; j++) {
      const m = c.namedChild(j)
      if (m && m.type === "visibility_modifier") return m.text
    }
  }
  return null
}

/** `@_exported` on this node's modifiers. The attribute is a NAMED
 *  `attribute` node holding `user_type > type_identifier "_exported"` — matched
 *  on node type and name text, never on a source scan. */
function exportedAttrOf(node: any): boolean {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (!c || c.type !== "modifiers") continue
    for (let j = 0; j < c.namedChildCount; j++) {
      const m = c.namedChild(j)
      if (!m || m.type !== "attribute") continue
      // Walk the attribute's own subtree for the `_exported` type_identifier.
      const stack = [m]
      while (stack.length > 0) {
        const n = stack.pop()!
        if (n.type === "type_identifier" && n.text === "_exported") return true
        for (let k = n.namedChildCount - 1; k >= 0; k--) {
          const d = n.namedChild(k)
          if (d) stack.push(d)
        }
      }
    }
  }
  return false
}

/** The module name of an import_declaration: its `identifier` child. */
function importModuleOf(node: any): string | null {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (!c) continue
    if (c.type === "identifier" || c.type === "simple_identifier" || c.type === "type_identifier") return c.text
  }
  return null
}

/** The declared name of a nominal/member declaration, or null. */
function declNameOf(node: any): string | null {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (!c) continue
    if (c.type === "type_identifier" || c.type === "simple_identifier" || c.type === "identifier") return c.text
    if (c.type === "user_type") {
      // Leaf of a dotted name.
      let leaf: any = null
      for (let j = 0; j < c.namedChildCount; j++) {
        const t = c.namedChild(j)
        if (t && t.type === "type_identifier") leaf = t
      }
      if (leaf) return leaf.text
    }
  }
  return null
}

const EXPORTING_VIS = new Set(["public", "open", "package"])
const NOMINAL = new Set(["protocol_declaration", "class_declaration"])
const MEMBER = new Set([
  "function_declaration", "protocol_function_declaration", "init_declaration",
  "property_declaration", "protocol_property_declaration",
  "typealias_declaration", "associatedtype_declaration", "subscript_declaration",
])

const hits = {
  publicImport: { n: 0, files: new Set<string>(), modules: new Map<string, number>(), samples: [] as string[] },
  underscoreExportedImport: { n: 0, files: new Set<string>(), modules: new Map<string, number>(), samples: [] as string[] },
  anyReExportingImport: { n: 0, files: new Set<string>() },
  publicNominal: { n: 0, files: new Set<string>(), samples: [] as string[] },
  openNominal: { n: 0, files: new Set<string>(), samples: [] as string[] },
  packageNominal: { n: 0, files: new Set<string>(), samples: [] as string[] },
  publicMember: { n: 0, files: new Set<string>(), samples: [] as string[] },
  openMember: { n: 0, files: new Set<string>() },
  packageMember: { n: 0, files: new Set<string>() },
  internalDecl: { n: 0, files: new Set<string>() },
  privateDecl: { n: 0, files: new Set<string>() },
  importDeclTotal: { n: 0, files: new Set<string>() },
  visibilityModifierNodes: 0,
  filesWithAnyPublic: 0,
}

const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)

for (const f of sample) {
  const t = parser.parse(f.text)
  if (!t) continue
  const label = `${f.repo}/${f.rel}`
  let sawPublic = false
  const v = (n: any) => {
    if (n.type === "visibility_modifier") hits.visibilityModifierNodes++
    if (n.type === "import_declaration") {
      hits.importDeclTotal.n++
      hits.importDeclTotal.files.add(label)
      const vis = visibilityOf(n)
      const us = exportedAttrOf(n)
      if (vis && EXPORTING_VIS.has(vis)) {
        const mod = importModuleOf(n)
        if (vis === "public") {
          hits.publicImport.n++
          hits.publicImport.files.add(label)
          if (mod) bump(hits.publicImport.modules, mod)
          if (hits.publicImport.samples.length < 8) hits.publicImport.samples.push(`${vis} import ${mod} — ${label}`)
        }
        if (vis === "package") { hits.packageMember.n++; hits.packageMember.files.add(label) }
        if (vis === "open") hits.openMember.n++
      }
      if (us) {
        const mod = importModuleOf(n)
        hits.underscoreExportedImport.n++
        hits.underscoreExportedImport.files.add(label)
        if (mod) bump(hits.underscoreExportedImport.modules, mod)
        if (hits.underscoreExportedImport.samples.length < 8) hits.underscoreExportedImport.samples.push(`@_exported import ${mod} — ${label}`)
      }
      if ((vis && EXPORTING_VIS.has(vis)) || us) hits.anyReExportingImport.n++
      if (vis && EXPORTING_VIS.has(vis)) hits.anyReExportingImport.files.add(label)
    }
    if (NOMINAL.has(n.type)) {
      const vis = visibilityOf(n)
      const nm = declNameOf(n)
      if (vis === "public") { hits.publicNominal.n++; hits.publicNominal.files.add(label); sawPublic = true; if (hits.publicNominal.samples.length < 6) hits.publicNominal.samples.push(`public ${n.type} ${nm} — ${label}`) }
      else if (vis === "open") { hits.openNominal.n++; hits.openNominal.files.add(label); sawPublic = true; if (hits.openNominal.samples.length < 6) hits.openNominal.samples.push(`open ${n.type} ${nm} — ${label}`) }
      else if (vis === "package") { hits.packageNominal.n++; hits.packageNominal.files.add(label); if (hits.packageNominal.samples.length < 6) hits.packageNominal.samples.push(`package ${n.type} ${nm} — ${label}`) }
      else if (vis === "internal") hits.internalDecl.n++, hits.internalDecl.files.add(label)
      else if (vis === "private") hits.privateDecl.n++, hits.privateDecl.files.add(label)
    }
    if (MEMBER.has(n.type)) {
      const vis = visibilityOf(n)
      if (vis === "public") { hits.publicMember.n++; hits.publicMember.files.add(label); sawPublic = true; if (hits.publicMember.samples.length < 6) hits.publicMember.samples.push(`public ${n.type} ${declNameOf(n)} — ${label}`) }
      else if (vis === "open") { hits.openMember.n++; hits.openMember.files.add(label); sawPublic = true }
      else if (vis === "package") { hits.packageMember.n++; hits.packageMember.files.add(label) }
    }
    for (let i = 0; i < n.childCount; i++) v(n.child(i))
  }
  v(t.rootNode)
  if (sawPublic) hits.filesWithAnyPublic++
  t.delete?.()
}

const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`\n${"=".repeat(100)}`)
console.log(`visibility_modifier nodes in the population: ${hits.visibilityModifierNodes.toLocaleString()}`)
console.log(`import_declaration nodes:                    ${hits.importDeclTotal.n.toLocaleString()} in ${hits.importDeclTotal.files.size} files`)
console.log(`${"=".repeat(100)}\n`)
console.log(`${w("construct", 46)}${w("sites", 10)}${w("files", 9)}`)
console.log("-".repeat(70))
console.log(`${w("FORM 1  `public import M`  (SE-0409 re-export)", 46)}${w(String(hits.publicImport.n), 10)}${w(String(hits.publicImport.files.size), 9)}`)
console.log(`${w("FORM 2  `@_exported import M`  (underscored re-export)", 46)}${w(String(hits.underscoreExportedImport.n), 10)}${w(String(hits.underscoreExportedImport.files.size), 9)}`)
console.log(`${w("FORM 1+2  any re-exporting import", 46)}${w(String(hits.anyReExportingImport.n), 10)}${w(String(hits.anyReExportingImport.files.size), 9)}`)
console.log(`${w("", 46)}${w("-".repeat(19), 19)}`)
console.log(`${w("FORM 3a  `public` on a nominal (class/struct/enum/actor/protocol)", 46)}${w(String(hits.publicNominal.n), 10)}${w(String(hits.publicNominal.files.size), 9)}`)
console.log(`${w("FORM 3b  `open` on a nominal", 46)}${w(String(hits.openNominal.n), 10)}${w(String(hits.openNominal.files.size), 9)}`)
console.log(`${w("FORM 3c  `package` on a nominal", 46)}${w(String(hits.packageNominal.n), 10)}${w(String(hits.packageNominal.files.size), 9)}`)
console.log(`${w("FORM 3d  `public` on a member (func/init/property/typealias)", 46)}${w(String(hits.publicMember.n), 10)}${w(String(hits.publicMember.files.size), 9)}`)
console.log(`${w("FORM 3e  `open` on a member", 46)}${w(String(hits.openMember.n), 10)}${w(String(hits.openMember.files.size), 9)}`)
console.log(`${w("FORM 3f  `package` on a member", 46)}${w(String(hits.packageMember.n), 10)}${w(String(hits.packageMember.files.size), 9)}`)
console.log(`${w("-".repeat(46), 46)}${w("-".repeat(19), 19)}`)
console.log(`${w("CONTRAST  `internal` nominal (NOT exported)", 46)}${w(String(hits.internalDecl.n), 10)}${w(String(hits.internalDecl.files.size), 9)}`)
console.log(`${w("CONTRAST  `private` nominal (NOT exported)", 46)}${w(String(hits.privateDecl.n), 10)}${w(String(hits.privateDecl.files.size), 9)}`)
console.log(`${w("files with at least one public/open declaration: ${hits.filesWithAnyPublic}", 46)}`)

const top = (m: Map<string, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}:${v}`).join("  ")
console.log(`\n[public import] modules: ${top(hits.publicImport.modules, 12) || "(none)"}`)
console.log(`[@_exported import] modules: ${top(hits.underscoreExportedImport.modules, 12) || "(none)"}`)
for (const s of hits.publicImport.samples) console.log(`   ${s}`)
for (const s of hits.underscoreExportedImport.samples) console.log(`   ${s}`)
for (const s of hits.publicNominal.samples) console.log(`   ${s}`)
for (const s of hits.publicMember.samples) console.log(`   ${s}`)