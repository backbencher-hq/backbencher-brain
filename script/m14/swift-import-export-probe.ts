/**
 * SWIFT IMPORT/EXPORT CONSTRUCT PROBE — the measurements the `imports` and
 * `exports` implementations are built from.
 *
 * Grammar-only (no parseFile sweep), so it is cheap enough to re-run while a
 * census is in flight. Answers, on the parse tree and never on source text:
 *
 *   1. What does an `import_declaration` actually name? A single segment
 *      (`import NIOCore`), a dotted path (`import Foo.Bar`), or a SCOPED import
 *      (`import let WinSDK.IPPROTO_IP` — a module plus a DECLARATION)? The
 *      distinction decides whether the edge target is a module name at all.
 *   2. Which access levels does the pinned grammar reduce into a
 *      `visibility_modifier`, and which does it leave in an ERROR? `package`
 *      (Swift 5.9) is the open question — if the grammar cannot reduce it, a
 *      `package`-gated export rule is a rule about a construct this parser
 *      never sees, and saying so is the honest answer.
 *   3. How many FILE-SCOPE declarations carry an export-level access modifier,
 *      by kind and by level? That is the export surface's denominator.
 *
 * Usage: bun script/m14/swift-import-export-probe.ts
 * Writes validation/m14/tmp/swift-import-export-probe.json
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, statSync } from "node:fs"
import * as path from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const OUT = "validation/m14/tmp/swift-import-export-probe.json"
const FULL = process.argv.includes("--full")

function admittedFiles(repo: string, cap: number): string[] {
  const dir = path.join(CR, repo)
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { return [] }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { return [] }
  const out: string[] = []
  for (const rel of tracked) {
    if (!rel.endsWith(".swift")) continue
    try { const st = statSync(path.join(dir, rel)); if (st.isFile() && st.size > 0) out.push(rel) } catch { continue }
  }
  return out.slice(0, cap)
}

const REPOS = [
  { repo: "swift-nio", cap: Number.POSITIVE_INFINITY },
  { repo: "alamofire", cap: Number.POSITIVE_INFINITY },
  { repo: "swift-corpus", cap: FULL ? Number.POSITIVE_INFINITY : 3000 },
]

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-swift.wasm"))))

// ---- 1 + 2 accumulators
const importShapes = {
  single: { n: 0, files: new Set<string>(), segLens: new Set<number>(), examples: [] as string[] },
  dotted: { n: 0, files: new Set<string>(), segLens: new Set<number>(), examples: [] as string[] },
  scoped: { n: 0, files: new Set<string>(), segLens: new Set<number>(), examples: [] as string[] },
}
const importAttributes = new Map<string, number>()
const importScopeKinds = new Map<string, number>()
const moduleTargets = new Map<string, number>()

// `package` reduction test, run on a FILE as well as on synthetic sources: the
// question is whether the pinned grammar has a `package` access level at all.
const packageProbe: Record<string, { reduced: boolean; sexp: string }> = {}
for (const src of [
  "package func p() {}\n",
  "package struct S {}\n",
  "public func f() {}\n",
  "package var v = 1\n",
  "package typealias T = Int\n",
  "package enum E { case a }\n",
  "package class C {}\n",
]) {
  const t = parser.parse(src)
  const s = t.rootNode.toString()
  packageProbe[src.trim()] = {
    reduced: !s.includes("ERROR") && !s.includes("MISSING"),
    sexp: s.replace(/\s+/g, " ").slice(0, 180),
  }
  t.delete?.()
}

// ---- 3: file-scope declaration access levels, by kind
// Mirrors the analyzer's OWN scope rule (a declaration is file-scope when no
// nominal/function declaration encloses it) so the denominator matches what
// the implementation will iterate.
const NOMINAL = new Set(["class_declaration", "protocol_declaration"])
const DECL_KINDS = ["function_declaration", "protocol_function_declaration", "class_declaration", "protocol_declaration", "property_declaration", "protocol_property_declaration", "typealias_declaration", "associatedtype_declaration", "init_declaration"]
const fileScopeByLevel: Record<string, Record<string, number>> = {}
const fileScopeByKindLevel: Record<string, Record<string, number>> = {}
const exportCandidates = new Map<string, number>()
let filesWalked = 0

function kindOf(n: any): string {
  if (n.type === "class_declaration") {
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c && !c.isNamed) {
        if (c.type === "struct") return "struct"
        if (c.type === "enum") return "enum"
        if (c.type === "extension") return "extension"
        if (c.type === "actor") return "actor"
        if (c.type === "class") return "class"
      }
    }
    return "class"
  }
  if (n.type === "protocol_declaration") return "protocol"
  if (n.type === "function_declaration" || n.type === "protocol_function_declaration") return "function"
  if (n.type === "property_declaration" || n.type === "protocol_property_declaration") return "property"
  if (n.type === "typealias_declaration") return "typealias"
  if (n.type === "associatedtype_declaration") return "associatedtype"
  if (n.type === "init_declaration") return "init"
  return n.type
}

function accessLevel(n: any): string {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && c.type === "modifiers") {
      for (let j = 0; j < c.namedChildCount; j++) {
        const m = c.namedChild(j)
        if (m && m.type === "visibility_modifier") return m.text
      }
    }
  }
  return "(none)"
}

function declName(n: any): string | null {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (!c) continue
    if (c.type === "type_identifier" || c.type === "simple_identifier" || c.type === "identifier") return c.text
    if (c.type === "user_type") {
      for (let k = 0; k < c.namedChildCount; k++) {
        const t = c.namedChild(k)
        if (t && t.type === "type_identifier") return t.text
      }
    }
  }
  return null
}

function walk(n: any, depth: number, label: string, text: string): void {
  const t = n.type
  if (t === "import_declaration") {
    const text0 = n.text.replace(/\s+/g, " ")
    // Anonymous scope-kind token between `import` and the path.
    let scopeKind: string | null = null
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c && !c.isNamed && ["struct", "class", "enum", "func", "var", "let", "typealias", "protocol", "actor", "macro"].includes(c.type)) { scopeKind = c.type; break }
    }
    const pathNode = n.namedChildren.find((c: any) => c.type === "identifier" || c.type === "simple_identifier" || c.type === "type_identifier")
    const written = pathNode ? pathNode.text : null
    const segs = written ? written.split(".") : []
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c && c.type === "modifiers") {
        for (let j = 0; j < c.namedChildCount; j++) {
          const m = c.namedChild(j)
          if (m && m.type === "attribute") {
            const key = m.text.replace(/\s*\(.*/, "")
            importAttributes.set(key, (importAttributes.get(key) ?? 0) + 1)
          }
        }
      }
    }
    if (scopeKind) importScopeKinds.set(scopeKind, (importScopeKinds.get(scopeKind) ?? 0) + 1)
    if (written) moduleTargets.set(segs[0], (moduleTargets.get(segs[0]) ?? 0) + 1)
    const bucket = scopeKind ? "scoped" : segs.length > 1 ? "dotted" : "single"
    const b: any = importShapes[bucket]
    b.n++
    b.files.add(label)
    b.segLens.add(segs.length)
    if (b.examples.length < 8) b.examples.push(`${label}: ${text0.slice(0, 90)}  [segments=${segs.length}${scopeKind ? ` scopeKind=${scopeKind}` : ""}]`)
  }
  if (DECL_KINDS.includes(t) && depth === 0) {
    const lvl = accessLevel(n)
    const k = kindOf(n)
    if (!fileScopeByLevel[lvl]) fileScopeByLevel[lvl] = {}
    fileScopeByLevel[lvl][k] = (fileScopeByLevel[lvl][k] ?? 0) + 1
    const key = `${lvl}|${k}`
    if (!fileScopeByKindLevel[key]) fileScopeByKindLevel[key] = {}
    fileScopeByKindLevel[key][t] = (fileScopeByKindLevel[key][t] ?? 0) + 1
    if (lvl === "public" || lvl === "open" || lvl === "package") {
      const nm = declName(n)
      if (nm) exportCandidates.set(nm, (exportCandidates.get(nm) ?? 0) + 1)
    }
  }
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) walk(c, depth + (NOMINAL.has(t) ? 1 : 0), label, text)
  }
}

let total = 0
for (const r of REPOS) {
  const rels = admittedFiles(r.repo, r.cap)
  total += rels.length
  for (const rel of rels) {
    let text: string
    try { text = readFileSync(path.join(CR, r.repo, rel), "utf8") } catch { continue }
    const tree = parser.parse(text)
    if (!tree) continue
    walk(tree.rootNode, 0, `${r.repo}/${rel}`, text)
    tree.delete?.()
    filesWalked++
  }
  process.stderr.write(`  ${r.repo}: walked\n`)
}
console.log(`swift import/export construct probe — ${total} files (${filesWalked} parsed)`)

// Export-level summary, with the DENOMINATOR the ruling needs.
const exportLevels = ["public", "open", "package"]
const exportTotal = exportLevels.reduce((acc, l) => acc + Object.values(fileScopeByLevel[l] ?? {}).reduce((a, b) => a + b, 0), 0)
const allFileScope = Object.values(fileScopeByLevel).reduce((acc, m) => acc + Object.values(m).reduce((a, b) => a + b, 0), 0)

const out = {
  at: new Date().toISOString(),
  mode: FULL ? "full" : "default",
  files: total,
  filesParsed: filesWalked,
  importShapes: Object.fromEntries(Object.entries(importShapes).map(([k, v]: any) => [k, {
    occurrences: v.n, files: v.files.size, segmentLengths: [...v.segLens].sort(), examples: v.examples,
  }])),
  importAttributes: Object.fromEntries([...importAttributes.entries()].sort((a, b) => b[1] - a[1])),
  importScopeKinds: Object.fromEntries([...importScopeKinds.entries()].sort((a, b) => b[1] - a[1])),
  topModuleTargets: Object.fromEntries([...moduleTargets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)),
  distinctModuleTargets: moduleTargets.size,
  packageReduction: packageProbe,
  fileScopeByAccessLevel: fileScopeByLevel,
  fileScopeTotal: allFileScope,
  exportLevelTotal: exportTotal,
  exportLevelShare: allFileScope > 0 ? +(100 * exportTotal / allFileScope).toFixed(2) : null,
  exportCandidateNames: Object.fromEntries([...exportCandidates.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)),
  distinctExportCandidateNames: exportCandidates.size,
}
writeFileSync(OUT, JSON.stringify(out, null, 2))
console.log(`wrote ${OUT}`)
console.log(`\nimport shapes:`)
for (const [k, v] of Object.entries(out.importShapes)) console.log(`  ${k.padEnd(10)} ${String((v as any).occurrences).padStart(6)} in ${String((v as any).files).padStart(5)} files   segmentLengths=${JSON.stringify((v as any).segmentLengths)}`)
console.log(`\nimport attributes: ${JSON.stringify(out.importAttributes)}`)
console.log(`import scope kinds: ${JSON.stringify(out.importScopeKinds)}`)
console.log(`distinct module targets: ${out.distinctModuleTargets}`)
console.log(`\npackage reduction (pinned grammar):`)
for (const [k, v] of Object.entries(packageProbe)) console.log(`  ${(v as any).reduced ? "REDUCES  " : "ERROR    "} ${JSON.stringify(k)}`)
console.log(`\nfile-scope declarations by access level (denominator ${allFileScope}):`)
// `Object.values<number>`: the level maps hold COUNTS, but the `as any` left TS with
// `unknown[]`, and `unknown` has no `+` — five errors in this one line (x, y, and
// both reduce results). The element type is stated where the values are produced.
for (const [lvl, m] of Object.entries(fileScopeByLevel).sort((a, b) => Object.values<number>(b[1] as any).reduce((x, y) => x + y, 0) - Object.values<number>(a[1] as any).reduce((x, y) => x + y, 0))) {
  console.log(`  ${lvl.padEnd(10)} ${String(Object.values<number>(m as any).reduce((a, b) => a + b, 0)).padStart(7)}  ${JSON.stringify(m)}`)
}
console.log(`export-level (public|open|package) total ${exportTotal} = ${out.exportLevelShare}% of file-scope declarations; ${out.distinctExportCandidateNames} distinct names`)