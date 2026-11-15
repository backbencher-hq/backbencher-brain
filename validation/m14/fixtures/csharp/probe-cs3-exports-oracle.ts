/**
 * CS3 / csharp — INDEPENDENT ORACLE for the `exports` edge, plus the six
 * questions for every type the lane emits.
 *
 * ## Why an oracle is needed AT ALL for a type nobody audits
 *
 * `script/m60/rel-type-coverage-gate.ts` reports, measured on this branch:
 *
 *   CHECK 1 — DERIVATION: csharp  1 un-audited: ["overrides"]
 *   baseline: 104 recorded, 1 NEW, 104 repaid
 *
 * `script/m14/differential.ts` excludes `exports` from csharp's compared set, so
 * an `exports` edge this round adds is emitted, stored, and compared against
 * NOTHING — which is the DERIVATION debt the workstream says to pay DOWN, not up.
 * `differential.ts` is the master's, so this lane did not edit it.
 *
 * What this lane CAN do without touching shared machinery is supply the thing a
 * shared edit would need in order to be safe: an INDEPENDENT derivation, run over
 * real corpus, in both directions.
 *
 * ## What "independent" can and cannot mean here
 *
 * The derivation below is a second walker over the SAME tree-sitter-c_sharp
 * grammar, written from the C# language rule rather than from the analyzer's
 * tables: it reads `modifier` children and `namespace_declaration` ancestry
 * directly, and it never touches `symbols`, `ownerName`, `visibility` or any
 * analyzer-internal helper. That is the same independence the differential
 * oracle has, and it carries the SAME limit the workstream states: a grammar bug
 * shared by both paths is invisible to both. What it DOES catch is an analyzer
 * rule that disagrees with the language rule — which is exactly the class the
 * nested-type defect above was, and it caught 24 fabricated rows on aspnetcore.
 *
 * ## No regular expression
 *
 * MASTER-HANDOFF rule 1. Tree walk only.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { fileURLToPath } from "node:url"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const REPO = process.env.BB_REPO || "aspnetcore"
const NFILES = Number(process.env.NFILES || 400)
const STRIDE = Math.max(1, Number(process.env.BB_STRIDE || 1))
const LANG = "csharp"

const ROOTW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const { parseFile } = await import("../../../../src/ast/pool-worker")
const { RealCSharpAnalyzer } = await import("../../../../src/ast/real-csharp-analyzer")
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(ROOTW, "wasm", "tree-sitter-c_sharp.wasm"))))

// ---------------------------------------------------------------- population
const dir = path.join(CR, REPO)
let tracked: string[]
try {
  tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
} catch {
  console.error(`no git repo at ${dir}`)
  process.exit(2)
}
const admitted: string[] = []
for (const rel of tracked) {
  const abs = path.join(dir, rel)
  let head = ""
  try {
    if (statSync(abs).size > 512 * 1024) continue
    head = readFileSync(abs, "utf8").slice(0, 4096)
  } catch { continue }
  if (detectLanguageFromPath(abs, head) !== LANG) continue
  admitted.push(abs)
}
const drawn = admitted.filter((_, i) => i % STRIDE === 0).slice(0, NFILES > 0 ? NFILES : admitted.length)
console.log(`CS3 csharp exports independent oracle + six-question audit`)
console.log(`repo ${REPO}: ADMITTED ${admitted.length}, DRAWN ${drawn.length} (stride ${STRIDE}) = ${((drawn.length / Math.max(1, admitted.length)) * 100).toFixed(1)}%`)
console.log()

const TYPE_DECLS = new Set(["class_declaration", "struct_declaration", "interface_declaration", "record_declaration", "enum_declaration", "delegate_declaration"])

function isPublic(node: any): boolean {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c && c.type === "modifier" && c.text === "public") return true
  }
  return false
}

/** The namespace a node sits in, by tree ancestry, or null for the global scope. */
function namespaceOf(node: any): string | null {
  let p = node.parent
  while (p) {
    if (p.type === "namespace_declaration") {
      const nn = p.childForFieldName("name")
      for (let i = 0; i < p.namedChildCount; i++) {
        const c = p.namedChild(i)
        if (c && (c.type === "qualified_name" || c.type === "identifier")) return c.text
      }
      return nn?.text ?? null
    }
    if (p.type === "file_scoped_namespace_declaration") {
      for (let i = 0; i < p.namedChildCount; i++) {
        const c = p.namedChild(i)
        if (c && (c.type === "qualified_name" || c.type === "identifier")) return c.text
      }
      return null
    }
    if (TYPE_DECLS.has(p.type)) return null // a nested type: its export path runs through the outer type
    p = p.parent
  }
  return null
}

/** A file-scoped namespace applies to SIBLINGS that follow it, not to a subtree. */
function fileScopedNamespaceOf(node: any): string | null {
  // walk the compilation unit's children in order; the last file-scoped namespace
  // that appears BEFORE this node governs it
  let p = node.parent
  while (p && p.type !== "compilation_unit") p = p.parent
  if (!p) return null
  let current: string | null = null
  for (let i = 0; i < p.namedChildCount; i++) {
    const c = p.namedChild(i)
    if (!c) continue
    if (c.startIndex > node.startIndex) break
    if (c.type === "file_scoped_namespace_declaration") {
      for (let j = 0; j < c.namedChildCount; j++) {
        const cc = c.namedChild(j)
        if (cc && (cc.type === "qualified_name" || cc.type === "identifier")) { current = cc.text; break }
      }
    } else if (c.type === "namespace_declaration") {
      current = null // a block namespace that OPENS later does not retroactively scope earlier siblings
    }
  }
  return current
}

function truthExports(text: string): { from: string; to: string }[] {
  const tree = parser.parse(text)
  const out: { from: string; to: string }[] = []
  if (!tree) return out
  const walk = (n: any) => {
    if (TYPE_DECLS.has(n.type) && isPublic(n)) {
      const nested = namespaceOf(n) === null && enclosingTypeNode(n) !== null
      if (!nested) {
        const name = n.childForFieldName("name")?.text
        if (name) {
          const ns = namespaceOf(n) ?? fileScopedNamespaceOf(n)
          out.push({ from: ns ?? "global", to: name })
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  function enclosingTypeNode(node: any): any {
    let p = node.parent
    while (p) {
      if (TYPE_DECLS.has(p.type)) return p
      if (p.type === "compilation_unit") return null
      p = p.parent
    }
    return null
  }
  walk(tree.rootNode)
  tree.delete?.()
  return out
}

// ---------------------------------------------------------------- run
const key = (a: string, b: string) => `${a} -> ${b}`
let truthN = 0, analyzerN = 0, analyzerDistinct = 0
const missing: string[] = [], unexplained: string[] = []
// six-question accumulators, per relationship label
interface Acc { n: number; srcResolves: number; tgtResolves: number; conf: Map<string, number>; ev: Map<string, number>; placeholder: number; emptyName: number; direct?: number; longLeaf?: number; longLeafExamples?: string[] }
const acc = new Map<string, Acc>()
const A = (t: string): Acc => { let a = acc.get(t); if (!a) { a = { n: 0, srcResolves: 0, tgtResolves: 0, conf: new Map(), ev: new Map(), placeholder: 0, emptyName: 0 }; acc.set(t, a) } return a }
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)

for (const abs of drawn) {
  let text: string
  try { text = readFileSync(abs, "utf8") } catch { continue }
  const prefix = dir + "/"
  const rel = abs.startsWith(prefix) ? abs.slice(prefix.length) : abs

  const truth = new Set(truthExports(text).map((e) => key(e.from, e.to)))
  truthN += truth.size

  // The ANALYZER's own output, before the production layer's noise filter. Kept
  // so a loss between the two is measurable rather than invisible: `parseFile`
  // is what the product stores, and a row the filter deletes is a row nothing
  // downstream can see or blame.
  let direct: any
  try {
    const wts2: any = await import("web-tree-sitter")
    const P2 = wts2.Parser ?? wts2.default
    direct = await new RealCSharpAnalyzer().analyze(parser.parse(text)!.rootNode, text, rel)
  } catch { direct = { relationships: [] } }
  for (const x of direct.relationships ?? []) {
    const t = String(x.type ?? x.relationshipType ?? "").toLowerCase()
    const a = A(t)
    a.direct = (a.direct ?? 0) + 1
    const target = String(x.target ?? "")
    // pool-worker.ts `filterNoiseRelationships`: "if (leaf.length > 80 || leaf.length < 1) return false".
    // The leaf is the last dot-segment, so the cap is on the SEGMENT, not the
    // whole target. Reproduced here as a length comparison on that segment --
    // the same arithmetic, not a copy of the rule's intent.
    const dot = target.lastIndexOf(".")
    const leaf = dot >= 0 && dot < target.length - 1 ? target.slice(dot + 1) : target
    if (leaf.length > 80) { a.longLeaf = (a.longLeaf ?? 0) + 1; if ((a.longLeafExamples ?? []).length < 3) (a.longLeafExamples ??= []).push(`${rel}:${leaf.length} ${leaf.slice(0, 60)}...`) }
  }

  let r: any
  try { r = await parseFile(abs, dir) } catch { continue }
  // Two name spaces, because one of them answers the wrong question.
  //   flatNames   : every symbol's own `name`, e.g. `ShouldUpdateAccessibilityModifier`
  //   leafResolves: a name matches if it is a flat name OR its last dot-segment is
  //                 one. The analyzer publishes `Owner.Member` on both halves of an
  //                 `overrides` edge (the owner-qualified source, the declaring-parent
  //                 target), so a flat-only test reports `overrides` at 0.0% resolved
  //                 on a file where every one of its members is declared three lines
  //                 away — a measurement defect, not a data defect.
  //
  // SCOPE, stated because it bounds every number below: analyzers emit OUTGOING
  // edges from the file being analyzed, and resolving who points AT you is a
  // separate subsystem that is not built. So "resolves" here can only ever mean
  // "binds to a symbol THIS FILE declares". An extends target of
  // `Microsoft.Build.Utilities.Task` is a true edge with an external target, and
  // counting it as a defect would be wrong.
  const flatNames = new Set<string>((r?.symbols ?? []).map((s: any) => String(s.name)))
  const leafOf = (n: string): string => {
    const dot = n.lastIndexOf(".")
    return dot >= 0 && dot < n.length - 1 ? n.slice(dot + 1) : n
  }
  const names = new Set<string>()
  for (const f of flatNames) { names.add(f); names.add(leafOf(f)) }
  const emitted = new Set<string>()
  for (const x of r?.relationships ?? []) {
    const t = String(x.type ?? x.relationshipType ?? "").toLowerCase()
    const pair = key(String(x.source), String(x.target))
    if (t === "exports") { analyzerN++; emitted.add(pair) }
    const a = A(t)
    a.n++
    if (names.has(String(x.source)) || names.has(leafOf(String(x.source)))) a.srcResolves++
    if (names.has(String(x.target)) || names.has(leafOf(String(x.target)))) a.tgtResolves++
    bump(a.conf, String(x.confidence))
    bump(a.ev, String(x.metadata?.evidenceClass ?? "(none)"))
    if (String(x.source) === "unknown" || String(x.target) === "unknown") a.placeholder++
    if (!x.source || !x.target) a.emptyName++
  }
  analyzerDistinct += emitted.size
  for (const k of truth) if (!emitted.has(k)) missing.push(`${rel} :: ${k.split(" -> ")[0]} -> ${k.split(" -> ")[1]}`)
  for (const k of emitted) if (!truth.has(k)) unexplained.push(`${rel} :: ${k.split(" -> ")[0]} -> ${k.split(" -> ")[1]}`)
}

console.log(`--- exports: analyzer vs independent tree derivation ---`)
console.log(`truth rows   ${truthN}`)
console.log(`analyzer rows${String(analyzerN).padStart(6)}`)
console.log(`MISSING      ${missing.length}   (truth, not emitted)`)
for (const m of missing.slice(0, 10)) console.log(`                 ${m}`)
console.log(`unexplained  ${unexplained.length}   (emitted, not in truth)`)
for (const m of unexplained.slice(0, 10)) console.log(`                 ${m}`)
console.log(`analyzer DISTINCT pairs ${analyzerDistinct}   duplicate (source,target) rows: ${analyzerN - analyzerDistinct}`)
console.log(`agreement    ${truthN + analyzerN === 0 ? "TRIVIAL (no exportable type in the draw)" : `${(100 * (1 - (missing.length + unexplained.length) / Math.max(1, truthN + analyzerDistinct))).toFixed(2)}% of the union`}`)
console.log()
console.log(`--- the six questions, per emitted relationship type ---`)
console.log(`"resolves" = binds to a symbol DECLARED IN THIS FILE (leaf-aware). It cannot mean`)
console.log(`more: these edges are OUTGOING, and cross-file/incoming resolution is a subsystem`)
console.log(`that does not exist yet, so an external target is not a defect and is not counted as one.`)
console.log(`label         edges  analyzer-emitted  dropped-by-noise-filter  long-leaf(>80ch)  src-resolves  tgt-resolves  conf>=0.7  heuristic(<0.7)  ph-unknown  empty-ep`)
for (const [t, a] of [...acc].sort()) {
  const heuristic = [...a.conf].filter(([c]) => Number(c) < 0.7).reduce((s, [, n]) => s + n, 0)
  const solid = [...a.conf].filter(([c]) => Number(c) >= 0.7).reduce((s, [, n]) => s + n, 0)
  const pct = (n: number) => `${((n / Math.max(1, a.n)) * 100).toFixed(1)}%`
  const lost = (a.direct ?? 0) - a.n
  console.log(`${t.padEnd(13)} ${String(a.n).padStart(6)} ${String(a.direct ?? 0).padStart(18)} ${String(lost).padStart(24)} ${String(a.longLeaf ?? 0).padStart(16)} ${String(pct(a.srcResolves)).padStart(13)} ${String(pct(a.tgtResolves)).padStart(13)} ${String(pct(solid)).padStart(11)} ${String(pct(heuristic)).padStart(15)} ${String(a.placeholder).padStart(10)} ${String(a.emptyName).padStart(8)}`)
}
console.log()
console.log(`long-leaf examples (target segment over 80 characters):`)
let anyLong = false
for (const [t, a] of [...acc].sort()) for (const e of a.longLeafExamples ?? []) { console.log(`  ${t}: ${e}`); anyLong = true }
if (!anyLong) console.log(`  (none in this draw)`)
console.log()
console.log(`confidence x evidenceClass, per label:`)
for (const [t, a] of [...acc].sort()) {
  console.log(`  ${t}: conf ${[...a.conf].sort().map(([c, n]) => `${c}=${n}`).join(" ")}`)
  console.log(`     ev   ${[...a.ev].sort().map(([c, n]) => `${c}=${n}`).join(" ")}`)
}
process.exitCode = missing.length + unexplained.length === 0 ? 0 : 1
