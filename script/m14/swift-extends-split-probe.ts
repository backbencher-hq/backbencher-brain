/**
 * SWIFT EXTENDS/IMPLEMENTS SPLIT PROBE — is the SUPERCLASS-vs-ADOPTION decision
 * right, measured against a corpus-wide index of what each base actually is?
 *
 * WHY THIS EXISTS. `extends` and `implements` are two of the six audited labels
 * for swift, so question 4 (labelled right?) is usually answered "the differential
 * says so". That answer has a hole: the differential's swift oracle is a second
 * walker over the SAME pinned grammar reading the SAME FILE, so it can see the
 * inheritance clause but it cannot see what the base NAME is in another file. The
 * analyzer's rule reads exactly that from the companion
 * (`inFileKinds.get(base) ?? crossFileKinds?.get(base) ?? "class"`, with
 * "class" as the default for an unknown base), so the decision is only as good as
 * the index behind it — and in a single-file parse there is no index at all.
 *
 * Swift's own rule is that ONLY a class can have a superclass, so the FIRST base
 * of a class is `extends` when that base is a class and `implements` when it is a
 * protocol. This probe builds the corpus-wide answer to "is this base name a
 * protocol?" — from the tree, over every file — and then asks, per emitted edge:
 *
 *   1. does the target resolve to a type the corpus declares at all?
 *   2. if it does, is that type a PROTOCOL?
 *   3. so is an `extends` edge naming a protocol a MISLABELLED adoption?
 *
 * The number that matters is (3). A non-zero count is not automatically a defect
 * — a protocol the corpus does not declare (a stdlib or third-party one) cannot be
 * checked — so the report separates "checkable and wrong" from "not checkable".
 *
 * WRITES validation/m14/tmp/swift-extends-split.json. Nothing else.
 *
 * Usage: bun script/m14/swift-extends-split-probe.ts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const OUT = "validation/m14/tmp/swift-extends-split.json"
const REPOS = [
  { repo: "swift-nio", cap: Number.POSITIVE_INFINITY },
  { repo: "alamofire", cap: Number.POSITIVE_INFINITY },
  { repo: "swift-corpus", cap: 600 },
]

function admittedFiles(repo: string, cap: number): string[] {
  const dir = path.join(CR, repo)
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

interface FileRef { repo: string; rel: string; abs: string; dir: string }
const files: FileRef[] = []
const pins: Record<string, string> = {}
for (const { repo, cap } of REPOS) {
  const rels = admittedFiles(repo, cap)
  if (rels.length === 0) { console.error(`! corpus missing or empty: ${repo}`); process.exit(2) }
  try { pins[repo] = execFileSync("git", ["-C", path.join(CR, repo), "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { pins[repo] = "unknown" }
  for (const rel of rels) files.push({ repo, rel, abs: path.join(CR, repo, rel), dir: path.join(CR, repo) })
}
console.log(`swift extends/implements split probe — ${files.length} files`)

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-swift.wasm"))))

/** type name -> the kinds the corpus declares it with. A name can be both. */
const kinds = new Map<string, Set<string>>()
function firstChildOfType(n: any, type: string): any | null {
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c && c.type === type) return c }
  return null
}
function hasAnon(n: any, token: string): boolean {
  for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c && !c.isNamed && c.type === token) return true }
  return false
}
function noteKind(name: string, kind: string): void {
  kinds.set(name, (kinds.get(name) ?? new Set()).add(kind))
}

let fidx = 0
async function indexWorker(): Promise<void> {
  while (true) {
    const i = fidx++
    if (i >= files.length) return
    const f = files[i]
    try {
      const tree = parser.parse(readFileSync(f.abs, "utf8"))
      if (!tree) continue
      const st = [tree.rootNode]
      while (st.length > 0) {
        const n = st.pop()!
        if (n.type === "protocol_declaration") {
          const nm = firstChildOfType(n, "type_identifier")
          if (nm) noteKind(nm.text, "protocol")
        } else if (n.type === "class_declaration" && !hasAnon(n, "extension")) {
          const nm = firstChildOfType(n, "type_identifier")
          if (nm) noteKind(nm.text, hasAnon(n, "struct") ? "struct" : hasAnon(n, "enum") ? "enum" : hasAnon(n, "actor") ? "actor" : hasAnon(n, "class") ? "class" : "unknown")
        }
        for (let j = n.namedChildCount - 1; j >= 0; j--) { const c = n.namedChild(j); if (c) st.push(c) }
      }
      tree.delete?.()
    } catch { /* unreadable is not a fact */ }
  }
}
await Promise.all(Array.from({ length: 8 }, () => indexWorker()))
const protocolNames = new Set([...kinds.entries()].filter(([, s]) => s.has("protocol")).map(([k]) => k))
const classNames = new Set([...kinds.entries()].filter(([, s]) => s.has("class")).map(([k]) => k))
console.log(`index: ${kinds.size} declared type names — ${protocolNames.size} protocol, ${classNames.size} class`)

interface Rel { source: string; target: string; line?: number; file: string }
const extendsEdges: Rel[] = []
const implementsEdges: Rel[] = []
let idx2 = 0
async function sweepWorker(): Promise<void> {
  while (true) {
    const i = idx2++
    if (i >= files.length) return
    const f = files[i]
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { continue }
    if (r.fallback) continue
    const label = `${f.repo}/${f.rel}`
    for (const rel of r.relationships ?? []) {
      const ty = String(rel.type ?? rel.relationshipType ?? "")
      if (ty !== "extends" && ty !== "implements") continue
      const e: Rel = { source: String(rel.source ?? ""), target: String(rel.target ?? ""), line: rel.line_number, file: label }
      if (ty === "extends") extendsEdges.push(e); else implementsEdges.push(e)
    }
  }
}
await Promise.all(Array.from({ length: 8 }, () => sweepWorker()))

function classify(edges: Rel[]) {
  const out = {
    edges: edges.length,
    targetIsADeclaredType: 0,
    targetIsAKnownProtocol: 0,
    targetIsAKnownClass: 0,
    targetUndeclaredInCorpus: 0,
    mislabelled: 0,
    mislabelledExamples: [] as string[],
    undeclaredExamples: [] as string[],
  }
  for (const e of edges) {
    const declared = kinds.has(e.target)
    if (declared) out.targetIsADeclaredType++
    else { out.targetUndeclaredInCorpus++; if (out.undeclaredExamples.length < 10) out.undeclaredExamples.push(`${e.file}:${e.line ?? "-"} ${e.source} -> ${e.target}`) }
    const isProto = protocolNames.has(e.target)
    const isClass = classNames.has(e.target)
    if (isProto) out.targetIsAKnownProtocol++
    if (isClass) out.targetIsAKnownClass++
    // An `extends` edge onto something the corpus DECLARES AS A PROTOCOL is an
    // adoption wearing the superclass label. Checkable = the corpus declares it.
    if (declared && isProto && !isClass) {
      out.mislabelled++
      if (out.mislabelledExamples.length < 15) out.mislabelledExamples.push(`${e.file}:${e.line ?? "-"} ${e.source} -> ${e.target} (corpus declares ${[...(kinds.get(e.target) ?? [])].join("/")})`)
    }
  }
  return out
}

const extendsC = classify(extendsEdges)
const implementsC = classify(implementsEdges)
// The mirror case: an `implements` edge onto a declared CLASS is a superclass
// wearing the adoption label.
let implementsOntoClass = 0
const implementsOntoClassExamples: string[] = []
for (const e of implementsEdges) {
  const ks = kinds.get(e.target)
  if (ks && ks.has("class") && !ks.has("protocol")) {
    implementsOntoClass++
    if (implementsOntoClassExamples.length < 15) implementsOntoClassExamples.push(`${e.file}:${e.line ?? "-"} ${e.source} -> ${e.target}`)
  }
}

const out = {
  at: new Date().toISOString(),
  instrument: "script/m14/swift-extends-split-probe.ts",
  question: "is the superclass-vs-adoption split right, measured against a corpus-wide index of what each base name actually is?",
  corpus: { root: CR, repos: Object.entries(pins).map(([repo, pin]) => ({ repo, pin })), files: files.length },
  index: { declaredTypeNames: kinds.size, protocolNames: protocolNames.size, classNames: classNames.size },
  extends: extendsC,
  implements: implementsC,
  implementsOntoAKnownClass: implementsOntoClass,
  implementsOntoAKnownClassExamples: implementsOntoClassExamples,
  sharedLimit: "the type-kind index is built from the same pinned grammar, so a type declared only inside a file the grammar broke is treated as undeclared and lands in targetUndeclaredInCorpus — the conservative direction. And this is a SINGLE-FILE parse of each file, so `crossFileKinds` is absent and every unknown base takes the analyzer's default ('class'); a production index pass with a populated companion can resolve bases this draw cannot check.",
}
writeFileSync(OUT, JSON.stringify(out, null, 2))
console.log(`wrote ${OUT}\n`)
console.log(`extends:    ${extendsC.edges} edges | target declared in corpus ${extendsC.targetIsADeclaredType} | of those, a PROTOCOL: ${extendsC.targetIsAKnownProtocol} | MISLABELLED ${extendsC.mislabelled} | not checkable (undeclared) ${extendsC.targetUndeclaredInCorpus}`)
for (const e of extendsC.mislabelledExamples) console.log(`   ${e}`)
console.log(`implements: ${implementsC.edges} edges | target declared in corpus ${implementsC.targetIsADeclaredType} | of those, a PROTOCOL: ${implementsC.targetIsAKnownProtocol} | onto a CLASS (the mirror mislabel) ${implementsOntoClass} | not checkable (undeclared) ${implementsC.targetUndeclaredInCorpus}`)
for (const e of implementsOntoClassExamples.slice(0, 8)) console.log(`   ${e}`)
