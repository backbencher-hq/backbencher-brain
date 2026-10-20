/**
 * SWIFT OVERRIDES PREMISE PROBE — does the `overrides` target name a real
 * declaration, or is the edge a guess about a symbol that does not exist?
 *
 * WHY THIS EXISTS. `overrides` is the lane's weakest type and one of its four
 * DERIVATION findings: the m14 differential EXCLUDES it from swift's compared
 * labels (differential.ts drops `overrides` for csharp, dart, swift, cpp and
 * go), so 100% of its edges ship unverified. The analyzer resolves a target in
 * three passes:
 *
 *   Pass 1  confidence 1.0  `reasonCode` absent      exact in-file hierarchy BFS
 *   Pass 2  confidence 0.9  `companion-index`        cross-file declaring parent
 *   Pass 3  confidence 0.5  `first-parent-guess`     first hierarchy parent
 *
 * Pass 3's own comment says the premise is unverified: "the parent may not even
 * declare the method". That is a hypothesis, and a hypothesis about 74.7% of the
 * type's edges is worth measuring rather than repeating. This probe builds a
 * CORPUS-WIDE declaration index straight from the parse tree — every type name
 * and every member name it declares, in every file — and then asks, per edge:
 *
 *   A  is `Parent` declared as a type anywhere in the corpus?
 *   B  does `Parent` declare `method`?          <- the Pass-3 premise
 *   C  is `Owner` a subclass of `Parent` transitively through declared bases?
 *   D  is `Parent` declared in the SAME FILE as the edge?  <- what Pass 1 buys
 *
 * B and C are the two an edge consumer cares about: an `overrides` edge whose
 * target declares nothing is a fabricated endpoint, and an `overrides` edge to
 * something `Owner` does not inherit from is a wrong fact. Both are invisible to
 * the differential.
 *
 * THE LIMIT: the declaration index is built from the SAME pinned grammar the
 * analyzer reads, so a declaration the grammar fails to reduce is invisible to
 * both. 244 of 1,256 files in this lane's draw carry grammar errors, so that
 * population is real and is stated with the result rather than folded into it.
 * A target declared only inside a file the grammar broke counts as UNVERIFIED
 * here, which is the conservative direction.
 *
 * WRITES validation/m14/tmp/swift-overrides-premise.json. Nothing else.
 *
 * Usage: bun script/m14/swift-overrides-premise-probe.ts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"
import type { DeclarationKind, ProjectIndex } from "../../src/ast/project-index"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
// The SAME draw the lane's census and the uncovered-type oracle use, so the
// three instruments' numbers are comparable: swift-nio and alamofire at full
// extent, plus a deterministic first-600 slice of apple/swift.
// `--with-project-index` re-runs the sweep with the corpus-wide tables handed to
// the analyzer as `AnalyzeContext.projectIndex` — the channel
// `src/ast/pool-worker.ts`'s `parse_batch` already fills and the Dart lane
// already reads. It answers the question the default mode cannot: how much of
// the first-parent guess a project index would remove. The two modes share this
// file's index and its measurement code, so the comparison is like for like.
const WITH_PROJECT_INDEX = process.argv.includes("--with-project-index")
const OUT = WITH_PROJECT_INDEX
  ? "validation/m14/tmp/swift-overrides-premise-with-project-index.json"
  : "validation/m14/tmp/swift-overrides-premise.json"
const REPOS = [
  { repo: "swift-nio", cap: Number.POSITIVE_INFINITY },
  { repo: "alamofire", cap: Number.POSITIVE_INFINITY },
  { repo: "swift-corpus", cap: 600 },
]

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
    const abs = path.join(dir, rel)
    try { const st = statSync(abs); if (st.isFile() && st.size > 0) out.push(rel) } catch { continue }
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
console.log(`swift overrides premise probe — ${files.length} files across ${REPOS.map((r) => r.repo).join(", ")}`)

// ---------------------------------------------------------------- tree index
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-swift.wasm"))))

/** type name -> every member name the corpus declares on it (union over files). */
const members = new Map<string, Set<string>>()
/** type name -> the base names its declarations carry, union over files. */
const bases = new Map<string, Set<string>>()
/** types declared per file, for the same-file question. */
const typesByFile = new Map<string, Set<string>>()
/** every type name the corpus declares. */
const declaredTypes = new Set<string>()
/** declared type name -> its kind, so the project index can carry it. */
const typeKinds = new Map<string, DeclarationKind>()
/** Labels of the files whose parse tree carries ERROR/MISSING nodes. The project
 *  index carries this so a caller can refuse to trust a declaration read under a
 *  broken tree; the probe's own tier report states the count either way. */
const damagedFiles = new Set<string>()
let grammarErrorFiles = 0

function firstChildOfType(n: any, type: string): any | null {
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c && c.type === type) return c }
  return null
}
function hasAnon(n: any, token: string): boolean {
  for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c && !c.isNamed && c.type === token) return true }
  return false
}
function lastTypeIdentifier(n: any): any | null {
  let found: any | null = null
  const stack = [n]
  while (stack.length > 0) {
    const cur = stack.pop()
    if (cur.type === "type_identifier") { found = cur; continue }
    for (let i = cur.namedChildCount - 1; i >= 0; i--) { const c = cur.namedChild(i); if (c) stack.push(c) }
  }
  return found
}
/** The `inheritance_specifier` base names of a type declaration, in source order.
 *
 *  The base name is the `type_identifier` DIRECTLY under the specifier's
 *  `user_type` — NOT the last `type_identifier` anywhere inside it. The pinned
 *  grammar reduces a generic base as
 *
 *     (inheritance_specifier inherits_from:
 *       (user_type (type_identifier) (type_arguments name: (user_type (type_identifier)))))
 *
 * for `BaseStreamSocketChannel<PipePair>`, so a last-identifier walk returns the
 *  TYPE ARGUMENT and the first version of this probe recorded
 *  `PipeChannel -> PipePair`. That made 60 of the `ownerInherits` answers here
 *  wrong, and it is the same leaf-vs-container trap the analyzer's own SWIFTD19
 *  comment records for extensions. */
function baseNames(n: any): string[] {
  const out: string[] = []
  const walk = (x: any) => {
    if (x.type === "inheritance_specifier") {
      const ut = x.namedChildCount > 0 ? x.namedChild(0) : null
      const direct = ut && ut.type === "user_type"
        ? ut.namedChildren.find((c: any) => c && c.type === "type_identifier")
        : null
      if (direct) { out.push(direct.text); return }
      const shallow = x.namedChildren.find((c: any) => c && c.type === "type_identifier")
      if (shallow) { out.push(shallow.text); return }
      return
    }
    for (let i = 0; i < x.namedChildCount; i++) { const c = x.namedChild(i); if (c) walk(c) }
  }
  walk(n)
  return out
}

function indexFile(root: any, label: string): void {
  const fileTypes = new Set<string>()
  const walk = (n: any, owner: string | null, insideFunction: boolean) => {
    const t = n.type
    let childOwner = owner
    let nextInside = insideFunction
    if (t === "protocol_declaration" || (t === "class_declaration" && !hasAnon(n, "extension"))) {
      const nm = firstChildOfType(n, "type_identifier")
      if (nm) {
        const name = nm.text
        declaredTypes.add(name)
        fileTypes.add(name)
        members.set(name, members.get(name) ?? new Set())
        bases.set(name, bases.get(name) ?? new Set())
        typeKinds.set(name, t === "protocol_declaration" ? "interface" : (hasAnon(n, "struct") ? "struct" : hasAnon(n, "enum") ? "enum" : hasAnon(n, "actor") ? "class" : "class"))
        for (const b of baseNames(n)) (bases.get(name) as Set<string>).add(b)
        childOwner = name
        nextInside = false
      }
    } else if (t === "class_declaration" && hasAnon(n, "extension")) {
      // An extension's members belong to the extended type in the index too:
      // `class Foo` in one file and `extension Foo` in another is the same
      // type's surface, and a member added by an extension IS declared by it.
      const nm = lastTypeIdentifier(n)
      if (nm) {
        declaredTypes.add(nm.text)
        fileTypes.add(nm.text)
        members.set(nm.text, members.get(nm.text) ?? new Set())
        childOwner = nm.text
        nextInside = false
      }
    } else if (t === "function_declaration" || t === "protocol_function_declaration" || t === "init_declaration") {
      if (!insideFunction && owner) {
        const nm = firstChildOfType(n, "simple_identifier") || firstChildOfType(n, "identifier")
        if (nm) (members.get(owner) as Set<string>).add(nm.text)
        else if (t === "init_declaration") (members.get(owner) as Set<string>).add("constructor")
      }
      nextInside = true
    } else if ((t === "property_declaration" || t === "protocol_property_declaration") && !insideFunction && owner) {
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && c.type === "pattern") {
          const id = firstChildOfType(c, "simple_identifier") || firstChildOfType(c, "identifier") || (c.namedChildCount > 0 ? c.namedChild(0) : null)
          if (id) (members.get(owner) as Set<string>).add(id.text)
        }
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) walk(c, childOwner, nextInside) }
  }
  walk(root, null, false)
  typesByFile.set(label, fileTypes)
}

let fidx = 0
async function indexWorker(): Promise<void> {
  while (true) {
    const i = fidx++
    if (i >= files.length) return
    const f = files[i]
    try {
      const text = readFileSync(f.abs, "utf8")
      const tree = parser.parse(text)
      if (!tree) continue
      indexFile(tree.rootNode, `${f.repo}/${f.rel}`)
      if (tree.rootNode.hasError) { grammarErrorFiles++; damagedFiles.add(`${f.repo}/${f.rel}`) }
      tree.delete?.()
    } catch { /* unreadable is not a fact */ }
  }
}
await Promise.all(Array.from({ length: 8 }, () => indexWorker()))
console.log(`index: ${declaredTypes.size} distinct types, ${[...members.values()].reduce((a, s) => a + s.size, 0)} (type, member) declarations, ${grammarErrorFiles} files with grammar errors`)

/** Transitively: is `sub` a subclass of `sup` through declared bases? */
function isSubclassOf(sub: string, sup: string, seen = new Set<string>()): boolean {
  if (sub === sup) return true
  if (seen.has(sub)) return false
  seen.add(sub)
  const bs = bases.get(sub)
  if (!bs) return false
  for (const b of bs) {
    if (b === sup) return true
    if (isSubclassOf(b, sup, seen)) return true
  }
  return false
}

// ---------------------------------------------------------------- edge check
// The object handed to the analyzer in `--with-project-index` mode. It is the
// `ProjectIndex` shape from src/ast/project-index.ts, built from THIS probe's own
// tree index rather than by `buildProjectIndex`, so the measurement does not
// depend on a Swift entry existing in a shared spec registry it may not be
// allowed to add. `parseFile` forwards the context to the engine, which hands it
// to the analyzer — the production path, with the context the indexer would fill.
const declaredSymbolNames = (): Set<string> => {
  const out = new Set<string>(declaredTypes)
  for (const declared of members.values()) for (const m of declared) out.add(m)
  return out
}
const projectIndex: ProjectIndex | undefined = WITH_PROJECT_INDEX
  ? {
      typeKinds,
      typeMembers: members,
      typeBases: new Map<string, string[]>([...bases.entries()].map(([k, v]) => [k, [...v]] as [string, string[]])),
      symbolNames: declaredSymbolNames(),
      damagedFiles,
      stats: { files: files.length, damaged: grammarErrorFiles },
      // THE TWO FIELDS `ProjectIndex` REQUIRES AND THIS PROBE DOES NOT COMPUTE. The probe builds a
      // PARTIAL index by hand — the types, their members, their bases, the names and the damage count —
      // and it does not build MODULES or SYMBOL COUNTS. They are EMPTY, and they are empty on purpose:
      // a hand-built index that invented a module map would be a claim the probe never measured. The
      // probe's own prints read only the fields it computes.
      modules: new Set<string>(),
      symbolCounts: new Map<string, number>(),
    }
  : undefined
if (WITH_PROJECT_INDEX) {
  console.log(`project index mode: typeKinds=${typeKinds.size} typeMembers=${members.size} typeBases=${bases.size} — handed to parseFile as AnalyzeContext.projectIndex`)
}
interface Edge { owner: string; method: string; parent: string; pmethod: string; conf: number; reason: string; label: string; line?: number }
const edges: Edge[] = []
let idx2 = 0
async function sweepWorker(): Promise<void> {
  while (true) {
    const i = idx2++
    if (i >= files.length) return
    const f = files[i]
    let r: any
    try { r = await parseFile(f.abs, f.dir, WITH_PROJECT_INDEX ? { projectIndex } : undefined) } catch { continue }
    if (r.fallback) continue
    const label = `${f.repo}/${f.rel}`
    for (const rel of r.relationships ?? []) {
      const ty = String(rel.type ?? rel.relationshipType ?? "").toLowerCase()
      if (ty !== "overrides") continue
      // The spelling is `Owner.method -> Parent.method`.
      const src = String(rel.source ?? ""), tgt = String(rel.target ?? "")
      const dot = (s: string) => { const i = s.lastIndexOf("."); return i < 0 ? ["", s] : [s.slice(0, i), s.slice(i + 1)] }
      const [owner, method] = dot(src)
      const [parent, pmethod] = dot(tgt)
      edges.push({
        owner, method, parent, pmethod,
        conf: typeof rel.confidence === "number" ? rel.confidence : -1,
        reason: String((rel.metadata ?? {}).reasonCode ?? "(none)"),
        label, line: rel.line_number,
      })
    }
  }
}
await Promise.all(Array.from({ length: 8 }, () => sweepWorker()))
console.log(`overrides edges emitted: ${edges.length}`)

const tierOf = (e: Edge) => e.conf >= 0.95 ? "pass1-in-file (1.0)" : e.conf >= 0.7 ? "pass2-companion (0.9)" : "pass3-first-parent-guess (0.5)"
const tiers: Record<string, { edges: number; parentIsAType: number; parentDeclaresMethod: number; ownerInheritsParent: number; sameFile: number; failures: string[] }> = {}
for (const e of edges) {
  const t = tierOf(e)
  tiers[t] ??= { edges: 0, parentIsAType: 0, parentDeclaresMethod: 0, ownerInheritsParent: 0, sameFile: 0, failures: [] }
  const s = tiers[t]
  s.edges++
  const fileTypes = typesByFile.get(e.label) ?? new Set<string>()
  const parentIsType = declaredTypes.has(e.parent)
  if (parentIsType) s.parentIsAType++
  const declares = parentIsType && (members.get(e.parent)?.has(e.pmethod) ?? false)
  if (declares) s.parentDeclaresMethod++
  const inherits = isSubclassOf(e.owner, e.parent)
  if (inherits) s.ownerInheritsParent++
  const sameFile = fileTypes.has(e.parent)
  if (sameFile) s.sameFile++
  if (!declares && s.failures.length < 25) s.failures.push(`${e.label}:${e.line ?? "-"} ${e.owner}.${e.method} -> ${e.parent}.${e.pmethod} (parent declared: ${parentIsType}, inherits: ${inherits}, same file: ${sameFile})`)
}

const out = {
  at: new Date().toISOString(),
  instrument: "script/m14/swift-overrides-premise-probe.ts",
  mode: WITH_PROJECT_INDEX ? "with-project-index" : "per-file (production today: no caller supplies a project index for .swift)",
  corpus: { root: CR, repos: REPOS.map((r) => ({ repo: r.repo, cap: r.cap, pin: pins[r.repo] })), files: files.length },
  index: { distinctTypes: declaredTypes.size, typeMemberPairs: [...members.values()].reduce((a, s) => a + s.size, 0), grammarErrorFiles },
  edges: edges.length,
  tiers,
  sharedLimit: "the declaration index is built from the same pinned grammar the analyzer reads, so a declaration inside a file the grammar broke is UNVERIFIED here; that is the conservative direction and its population is index.grammarErrorFiles",
  note: "overrides is one of four swift DERIVATION findings — the m14 differential excludes it from swift's compared labels, so nothing below is checked by the shared harness",
}
writeFileSync(OUT, JSON.stringify(out, null, 2))
console.log(`wrote ${OUT}\n`)
console.log(`tier                            edges  parentIsAType  parentDeclares  ownerInherits  sameFile`)
console.log("-".repeat(96))
for (const [t, s] of Object.entries(tiers)) {
  console.log(`${t.padEnd(31)}${String(s.edges).padEnd(6)}${String(s.parentIsAType).padEnd(14)}${String(s.parentDeclaresMethod).padEnd(15)}${String(s.ownerInheritsParent).padEnd(15)}${s.sameFile}`)
}
for (const [t, s] of Object.entries(tiers)) {
  if (s.failures.length > 0) {
    console.log(`\n${t} — targets that do NOT declare the method (first 25):`)
    for (const f of s.failures) console.log(`  ${f}`)
  }
}
