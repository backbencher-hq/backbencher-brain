/**
 * SWIFT ORACLE FOR THE FOUR UNCOVERED TYPES — the lane's answer to question 3
 * for the relationship types the m14 differential never audits.
 *
 * WHY THIS EXISTS (docs/analyzers/ONTOLOGY-WORKSTREAM.md, Part 1).
 * `validation/m60/rel-type-coverage-baseline.json` records swift carrying four
 * DERIVATION findings — types the analyzer EMITS that the differential compares
 * against nothing:
 *
 *     contains · overrides · imports · exports
 *
 * The differential's swift compared-label allowlist (differential.ts, the
 * `deriveSwiftEdges` / compared-label expressions) is
 * `["extends","implements","instantiates","calls","uses","references"]`, so all
 * four are dropped from the analyzer side before comparison. Wiring them into
 * the differential is a MASTER-owned change (script/m14/differential.ts +
 * validation/m14/differential-baseline.json). Until that happens, "the
 * differential is green" says nothing at all about these four types — an
 * unverified edge ships a bug invisibly, which is the failure this instrument
 * exists to make visible.
 *
 * WHAT IT DOES. For every corpus file it derives the expected edge set for
 * `contains`, `exports` and `imports` from the PARSE TREE with a second walker
 * that shares no code with the analyzer (it imports no analyzer module and
 * calls none of its helpers), then compares that set against what the PRODUCTION
 * entry point emitted. Two directions, because they fail differently:
 *
 *   MISSING — the tree says the edge exists and the analyzer did not emit it
 *             (an omission: a member with no owner edge, a public declaration
 *             missing from the module interface, an import missing its
 *             module-dependency edge).
 *   EXTRA   — the analyzer emitted an edge the tree does not support. This is
 *             the direction that catches FABRICATION, which the workstream
 *             names as the thing that poisons bb_graph / bb_impact / bb_migrate:
 *             a `contains` edge to a member the file never declares, an
 *             `exports` edge for something not public, an `imports` target that
 *             is not a module.
 *
 * THE LIMIT, STATED RATHER THAN HIDDEN. This is a second walker over the SAME
 * pinned tree-sitter-swift grammar, so a grammar bug present in both paths is
 * invisible to it — exactly the limit the workstream names for the differential's
 * own oracle. What it does establish is narrower and still worth having: the
 * analyzer's post-loop edge construction agrees, edge for edge, with an
 * independent reading of the tree, over a corpus draw. It does NOT establish that
 * the tree read the construct correctly.
 *
 * `overrides` is NOT here and the reason is structural, not laziness: its target
 * is resolved across files through a companion index this single-file oracle does
 * not have. script/m14/swift-overrides-premise-probe.ts measures that type's
 * premise corpus-wide instead, which is the only question worth asking of a
 * guess.
 *
 * WRITES validation/m14/tmp/swift-uncovered-oracle.json. Nothing else.
 *
 * Usage: bun script/m14/swift-uncovered-oracle.ts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const OUT = "validation/m14/tmp/swift-uncovered-oracle.json"

// The SAME draw the lane's census uses, so the two instruments' numbers are
// comparable: swift-nio and alamofire at full extent, plus a deterministic
// first-600 slice of apple/swift. `--repo-cap=N` widens the slice.
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
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { return [] }
  const out: string[] = []
  for (const rel of tracked) {
    if (!rel.endsWith(".swift")) continue
    const abs = path.join(dir, rel)
    try {
      const st = statSync(abs)
      if (!st.isFile() || st.size === 0) continue
      out.push(rel)
    } catch { continue }
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
console.log(`swift uncovered-type oracle — ${files.length} files across ${REPOS.map((r) => r.repo).join(", ")}`)
for (const [repo, pin] of Object.entries(pins)) console.log(`  ${repo} @ ${pin}`)

// ------------------------------------------------------------------ the oracle
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-swift.wasm"))))

/** Access levels that put a declaration in its module's interface. */
const EXPORT_LEVELS = new Set(["public", "open", "package"])
/** The scope-kind tokens Swift's import grammar admits (`import struct Foo.Bar`). */
const IMPORT_SCOPE_KINDS = new Set(["struct", "class", "enum", "func", "var", "let", "typealias", "protocol", "actor", "macro"])
/** A raw-representable enum's stdlib raw-value type — never an adopted protocol. */
const ENUM_RAW = new Set([
  "String", "Character", "Int", "Int8", "Int16", "Int32", "Int64",
  "UInt", "UInt8", "UInt16", "UInt32", "UInt64", "Float", "Float32", "Float64", "Double",
])

function firstChildOfType(n: any, type: string): any | null {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && c.type === type) return c
  }
  return null
}
function hasAnon(n: any, token: string): boolean {
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c && !c.isNamed && c.type === token) return true
  }
  return false
}
/** The declaration's access level, read from its own `visibility_modifier` child. */
function accessLevel(n: any): string {
  const mods = firstChildOfType(n, "modifiers")
  if (mods) {
    for (let i = 0; i < mods.namedChildCount; i++) {
      const m = mods.namedChild(i)
      if (!m || m.type !== "visibility_modifier") continue
      const t = m.text
      if (EXPORT_LEVELS.has(t) || t === "private" || t === "fileprivate" || t === "internal") return t
    }
  }
  return "internal"
}
/** The last `type_identifier` under a node — an extension names its EXTENDED type. */
function lastTypeIdentifier(n: any): any | null {
  let found: any | null = null
  const stack = [n]
  while (stack.length > 0) {
    const cur = stack.pop()
    if (cur.type === "type_identifier") { found = cur; continue }
    for (let i = cur.namedChildCount - 1; i >= 0; i--) {
      const c = cur.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return found
}

type Edge = `${string}\u0000${string}`

interface Truth {
  contains: Set<Edge>
  exports: Set<Edge>
  imports: Set<Edge>
  /** symbols the tree declares, for corroborating an EXTRA endpoint */
  declaredNames: Set<string>
  /** file-scope declarations the tree declares, for the exports uniqueness check */
  fileScopeNames: string[]
  /**
   * `contains` edges whose SOURCE is a FUNCTION — a function declared inside
   * another function's body. Counted separately because it is the one place the
   * lane's membership rule and its local rule pull in opposite directions: the
   * analyzer materializes a nested function as a symbol and emits `contains`
   * for it, while a local `let`/`var` in the same body emits nothing (its owner
   * is not a type, so `handleVariable` returns early). Both are locals; only one
   * of them produces an edge. The number is what makes that asymmetry a
   * measurement rather than an impression.
   */
  localFunctionContains: number
}

/** The EXTENDED type of an extension declaration — its own `user_type`, never a
 *  `type_identifier` from anywhere in the subtree. The first version of this
 *  oracle searched the whole declaration for the last `type_identifier`, so
 *  `extension Array where Element == Measurement { func f(_ d: String) }` came
 *  out named `String`: 5,543 spurious EXTRA `contains` edges on clean files, the
 *  probe being wrong about the language rather than the analyzer. */
function extensionTargetName(n: any): string | null {
  const ut = firstChildOfType(n, "user_type")
  if (ut) return lastTypeIdentifier(ut)?.text ?? null
  // No `user_type` (the grammar's own reduction can differ): take the
  // `type_identifier` that is a DIRECT child, never one from the body.
  return firstChildOfType(n, "type_identifier")?.text ?? null
}

/**
 * Derive the expected edge set for one file, from the tree alone.
 *
 * Declaration kinds the oracle reads — the same set the analyzer's symbol
 * contract lists, written out here independently:
 *   protocol_declaration                       -> a type
 *   class_declaration [class|struct|enum|extension|actor] -> a type
 *   function_declaration | protocol_function_declaration -> a member
 *   init_declaration                           -> a member named `constructor`
 *   property_declaration | protocol_property_declaration -> one member per `pattern`
 *   enum_entry                                 -> a member, in an ENUM body only
 *   typealias_declaration | associatedtype_declaration   -> a type
 * Ownership is LEXICAL: the nearest enclosing declaration is the container,
 * which is what "ownerName = parent.name" means when the walk pushes a frame.
 * `deinit_declaration`/`subscript_declaration` are not declarations the family
 * materializes, so they are not members here.
 */
function deriveTruth(root: any): Truth {
  const contains = new Set<Edge>()
  const exports = new Set<Edge>()
  const imports = new Set<Edge>()
  const declaredNames = new Set<string>()
  const fileScopeNames: string[] = []
  let localFunctionContains = 0

  // `owner` null = file scope. The container is the nearest enclosing
  // DECLARATION (a type or a function); `ownerIsType` says which, because a
  // property binding is a member of a TYPE and a local of a function.
  const walk = (n: any, owner: string | null, ownerIsType: boolean, ownerIsEnum: boolean, insideFunction: boolean) => {
    const t = n.type

    if (t === "import_declaration") {
      // The spelled path is the first identifier child; the MODULE is its first
      // dotted segment (Swift's own rule — a submodule or a scoped declaration
      // hangs off the module).
      let spelled = ""
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c && (c.type === "simple_identifier" || c.type === "type_identifier" || c.type === "identifier")) { spelled = c.text; break }
      }
      if (spelled) {
        const moduleName = spelled.split(".")[0]
        if (moduleName) imports.add(`root\u0000${moduleName}`)
      }
      return // an import declares nothing
    }

    let childOwner = owner
    let childOwnerIsType = ownerIsType
    let childOwnerIsEnum = ownerIsEnum
    let nextInsideFunction = insideFunction

    if (t === "protocol_declaration" || t === "class_declaration") {
      const isExtension = t === "class_declaration" && hasAnon(n, "extension")
      const name = isExtension
        ? extensionTargetName(n)
        : (firstChildOfType(n, "type_identifier")?.text ?? firstChildOfType(n, "user_type")?.text ?? null)
      if (name) {
        declaredNames.add(name)
        if (owner === null) {
          fileScopeNames.push(name)
          // E1: a FILE-SCOPE declaration in the module interface. Membership,
          // not indentation. An extension is excluded because its symbol is
          // named after the EXTENDED type, which is declared elsewhere (or is
          // a stdlib type this file never declares).
          if (!isExtension && EXPORT_LEVELS.has(accessLevel(n))) exports.add(`root\u0000${name}`)
        } else {
          contains.add(`${owner}\u0000${name}`)
        }
        childOwner = name
        childOwnerIsType = true
        childOwnerIsEnum = t === "class_declaration" && hasAnon(n, "enum")
      }
      nextInsideFunction = false
    } else if (t === "function_declaration" || t === "protocol_function_declaration") {
      // A function is a declaration wherever it appears. Nested inside another
      // function it is a LOCAL, but it is named, ranged and addressable, so the
      // oracle derives the containment and counts it separately (`localFunctionContains`)
      // rather than asserting it away.
      const nameNode = firstChildOfType(n, "simple_identifier") || firstChildOfType(n, "identifier")
      const op = nameNode ? null : anonOperatorName(n)
      const name = nameNode ? nameNode.text : op
      if (name) {
        declaredNames.add(name)
        if (owner !== null) {
          contains.add(`${owner}\u0000${name}`)
          if (!ownerIsType) localFunctionContains++
        } else {
          fileScopeNames.push(name)
          if (EXPORT_LEVELS.has(accessLevel(n))) exports.add(`root\u0000${name}`)
        }
      }
      if (name) { childOwner = name; childOwnerIsType = false }
      nextInsideFunction = true
    } else if (t === "init_declaration") {
      // The family's constructor name for a Swift initializer (Java/C# naming).
      if (owner !== null && ownerIsType) contains.add(`${owner}\u0000constructor`)
      nextInsideFunction = true
    } else if (t === "property_declaration" || t === "protocol_property_declaration") {
      if (ownerIsType) {
        // One `pattern` per binding: `var a = 1, b = 2` is two declarations. A
        // binding inside a FUNCTION body is a local and is not a symbol, which
        // is the family's LocalsAreNotSymbols contract.
        const names: string[] = []
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "pattern") {
            const id = firstChildOfType(c, "simple_identifier") || firstChildOfType(c, "identifier") || firstNamed(c)
            if (id) names.push(id.text)
          }
        }
        if (names.length === 0) {
          const id = firstChildOfType(n, "simple_identifier") || firstChildOfType(n, "identifier")
          if (id) names.push(id.text)
        }
        for (const name of names) {
          declaredNames.add(name)
          if (owner !== null) contains.add(`${owner}\u0000${name}`)
          else {
            fileScopeNames.push(name)
            if (EXPORT_LEVELS.has(accessLevel(n))) exports.add(`root\u0000${name}`)
          }
        }
      }
    } else if (t === "enum_entry") {
      // A member of an ENUM body only. A `case` in a switch statement is not an
      // enum member, and `ownerIsEnum` is false there because a switch is not a
      // type declaration.
      if (ownerIsEnum && owner !== null && !insideFunction) {
        let nameNode: any | null = null
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c || c.type === "modifiers" || c.type === "attribute") continue
          nameNode = c
          if (c.type === "simple_identifier" || c.type === "identifier") break
        }
        const name = nameNode ? nameNode.text : null
        if (name && name !== "case") {
          declaredNames.add(name)
          contains.add(`${owner}\u0000${name}`)
        }
      }
    } else if (t === "typealias_declaration" || t === "associatedtype_declaration") {
      const nameNode = firstChildOfType(n, "type_identifier")
      const name = nameNode ? nameNode.text : null
      if (name) {
        declaredNames.add(name)
        if (owner !== null) contains.add(`${owner}\u0000${name}`)
        else {
          fileScopeNames.push(name)
          if (EXPORT_LEVELS.has(accessLevel(n))) exports.add(`root\u0000${name}`)
        }
      }
    }

    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) walk(c, childOwner, childOwnerIsType, childOwnerIsEnum, nextInsideFunction)
    }
  }

  function firstNamed(n: any): any | null {
    return n.namedChildCount > 0 ? n.namedChild(0) : null
  }
  /** `static func + (l:r:)` — the name is an anonymous operator token. */
  function anonOperatorName(n: any): string | null {
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (!c || c.isNamed) continue
      if (["func", "static", "class", "mutating", "override", "public", "private", "internal", "fileprivate", "open", "final", "indirect"].includes(c.type)) continue
      if (["+", "-", "*", "/", "%", "==", "!=", "<", ">", "<=", ">=", "++", "--", "+=", "-=", "*=", "/=", "%=", "[]", "..<", "..."].includes(c.type)) return c.type
    }
    return null
  }

  walk(root, null, false, false, false)
  return { contains, exports, imports, declaredNames, fileScopeNames, localFunctionContains }
}

// ------------------------------------------------------------------ comparison
/**
 * Compare the DECLARATION, not the label the analyzer chose for it. Two naming
 * conventions differ between the analyzer and this oracle and neither is a
 * disagreement about the graph:
 *
 *   `operator ==`  the analyzer's label for an operator overload (a `func ==`
 *                  declaration has no simple_identifier, so the name comes from
 *                  the anonymous operator token and is prefixed). The oracle
 *                  reads the bare token. Same declaration.
 *   `` `default` `` a backtick-quoted identifier is legal Swift and common in
 *                  the standard library (`case \`default\``). The analyzer strips
 *                  the backticks (`stripNameQuoting`); the oracle reads the node
 *                  text verbatim. Same declaration.
 *
 * Without this the comparison reports hundreds of phantom MISSING/EXTRA pairs in
 * both directions on a file that is fine — the first version of this oracle did
 * exactly that, which is why the count is only meaningful once the two
 * conventions are reconciled. The RAW counts are kept alongside the normalised
 * ones so the size of the reconciliation is itself visible.
 */
function normalize(v: string): string {
  if (v.startsWith("operator ")) return v.slice("operator ".length).trim()
  return v.replace(/`/g, "")
}
const stats: Record<string, {
  truth: number; analyzer: number; missing: number; extra: number; agreed: number
  missingExamples: string[]; extraExamples: string[]
  byRepo: Record<string, { analyzer: number; missing: number; extra: number }>
}> = {
  contains: { truth: 0, analyzer: 0, missing: 0, extra: 0, agreed: 0, missingExamples: [], extraExamples: [], byRepo: {} },
  exports: { truth: 0, analyzer: 0, missing: 0, extra: 0, agreed: 0, missingExamples: [], extraExamples: [], byRepo: {} },
  imports: { truth: 0, analyzer: 0, missing: 0, extra: 0, agreed: 0, missingExamples: [], extraExamples: [], byRepo: {} },
}
// Clean files and ERROR-RECOVERED files are counted SEPARATELY, and that split
// is the difference between a number about the analyzer and a number about two
// different readers of a damaged tree. The analyzer models ERROR recovery
// (`isNominalRecovery` mints a container from a header the grammar could not
// reduce); this oracle does not, so on a file with `rootNode.hasError` the two
// sides are not reading the same tree and a disagreement there says nothing
// about either rule. The error population is reported, not discarded.
const errorFileBucket = () => ({
  truth: 0, analyzer: 0, missing: 0, extra: 0, agreed: 0,
  byRepo: {} as Record<string, { analyzer: number; missing: number; extra: number }>,
  missingExamples: [] as string[], extraExamples: [] as string[],
})
const errorFiles = {
  contains: errorFileBucket(),
  exports: errorFileBucket(),
  imports: errorFileBucket(),
} as Record<string, ReturnType<typeof errorFileBucket>>
let filesWithDiff = 0
let extraTargetNotDeclared = 0
const extraTargetExamples: string[] = []
let filesCompared = 0
let filesWithGrammarErrors = 0
let localFunctionContains = 0
let crashFiles = 0

let idx = 0
async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    const label = `${f.repo}/${f.rel}`
    let text: string
    try { text = readFileSync(f.abs, "utf8") } catch { continue }
    const tree = parser.parse(text)
    if (!tree) continue
    const hasError = tree.rootNode.hasError
    const truth = deriveTruth(tree.rootNode)
    tree.delete?.()

    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { crashFiles++; continue }
    if (r.fallback) continue
    filesCompared++
    if (hasError) filesWithGrammarErrors++
    localFunctionContains += truth.localFunctionContains

    const got: Record<string, Set<Edge>> = { contains: new Set(), exports: new Set(), imports: new Set() }
    const exportRows = new Set<string>()
    for (const rel of r.relationships ?? []) {
      const ty = String(rel.type ?? rel.relationshipType ?? "").toLowerCase()
      if (ty === "contains" || ty === "exports" || ty === "imports") {
        got[ty].add(`${normalize(String(rel.source ?? ""))}\u0000${normalize(String(rel.target ?? ""))}`)
      }
    }
    for (const e of r.exports ?? []) exportRows.add(normalize(String(e.name ?? "")))

    let fileDiff = false
    for (const ty of ["contains", "exports", "imports"] as const) {
      const s = hasError ? errorFiles[ty] : stats[ty]
      s.truth += truth[ty].size
      s.analyzer += got[ty].size
      s.byRepo[f.repo] ??= { analyzer: 0, missing: 0, extra: 0 }
      s.byRepo[f.repo].analyzer += got[ty].size
      for (const e of truth[ty]) {
        if (got[ty].has(e)) { s.agreed++; continue }
        s.missing++
        s.byRepo[f.repo].missing++
        fileDiff = true
        if (s.missingExamples.length < 20) s.missingExamples.push(`${label}: ${e.replace("\u0000", " -> ")}`)
      }
      for (const e of got[ty]) {
        if (truth[ty].has(e)) continue
        s.extra++
        s.byRepo[f.repo].extra++
        fileDiff = true
        if (s.extraExamples.length < 20) s.extraExamples.push(`${label}: ${e.replace("\u0000", " -> ")}`)
        // The fabrication check: does the analyzer name something the tree does
        // not declare in this file at all?
        const target = e.slice(e.indexOf("\u0000") + 1)
        if (target !== "root" && !truth.declaredNames.has(target) && truth[ty] !== undefined) {
          if (ty !== "imports") {
            extraTargetNotDeclared++
            if (extraTargetExamples.length < 20) extraTargetExamples.push(`${label}: ${ty} -> '${target}' is not declared in this file`)
          }
        }
      }
    }
    // The exports/ExportInfo cross-check: every published export row must be an
    // exports edge target, and every exports edge target must have a row. The
    // harness reads BOTH (run-fixtures' top-level-symbol invariant reads the
    // rows; bb_graph reads the edges), so a divergence between them is a
    // consumer-visible inconsistency the differential cannot see.
    const edgeTargets = new Set([...got.exports].map((e) => e.slice(e.indexOf("\u0000") + 1)))
    for (const n of exportRows) if (!edgeTargets.has(n)) fileDiff = true
    for (const n of edgeTargets) if (!exportRows.has(n)) fileDiff = true
    if (fileDiff) filesWithDiff++
  }
}

const t0 = Date.now()
await Promise.all(Array.from({ length: 8 }, () => worker()))
console.log(`compared ${filesCompared} files in ${((Date.now() - t0) / 1000).toFixed(1)}s (${crashFiles} crashes)`)

const out = {
  at: new Date().toISOString(),
  instrument: "script/m14/swift-uncovered-oracle.ts",
  what: "an independent tree walker vs the production parseFile, for the four types the m14 differential never audits (three of them here; overrides has its own premise probe)",
  sharedLimit: "second walker over the SAME pinned tree-sitter-swift grammar — a grammar bug present in both paths is invisible to this comparison, exactly as for the differential's own oracle",
  corpus: { root: CR, repos: REPOS.map((r) => ({ repo: r.repo, cap: r.cap, pin: pins[r.repo] })), files: files.length, compared: filesCompared, crashes: crashFiles },
  filesWithGrammarErrors,
  grammarErrorFilesNote: "files whose tree rootNode.hasError are counted in `grammarErrorTypes` instead of `types`: the analyzer models ERROR recovery and this oracle does not, so the two sides are not reading the same tree there. `types` is therefore the agreement figure over files both readers saw identically.",
  types: stats,
  grammarErrorTypes: errorFiles,
  localFunctionContains,
  filesWithAnyDifference: filesWithDiff,
  extraEdgeTargetsNotDeclaredInFile: extraTargetNotDeclared,
  extraEdgeTargetExamples: extraTargetExamples,
  notCoveredHere: {
    overrides: "its target is resolved across files through a companion index this single-file oracle does not have; measured instead by script/m14/swift-overrides-premise-probe.ts",
  },
}
writeFileSync(OUT, JSON.stringify(out, null, 2))
console.log(`wrote ${OUT}\n`)
console.log(`type        truth     analyzer  agreed    MISSING  EXTRA`)
console.log("-".repeat(66))
for (const ty of ["contains", "exports", "imports"] as const) {
  const s = stats[ty]
  console.log(`${ty.padEnd(11)}${String(s.truth).padEnd(9)}${String(s.analyzer).padEnd(10)}${String(s.agreed).padEnd(9)}${String(s.missing).padEnd(9)}${s.extra}`)
}
console.log(`\nclean files compared (no ERROR node): ${filesCompared - filesWithGrammarErrors}; files with a grammar error, counted separately: ${filesWithGrammarErrors}`)
console.log(`contains edges whose SOURCE is a FUNCTION (a nested function declared inside another function): ${localFunctionContains}`)
console.log(`files with at least one difference (clean files): ${filesWithDiff}`)
console.log(`EXTRA edge targets not declared anywhere in their own file: ${extraTargetNotDeclared}`)
const bad = Object.entries(stats).filter(([, s]) => s.missing > 0 || s.extra > 0)
if (bad.length === 0) {
  console.log(`\nORACLE AGREES on all three types, both directions, over ${filesCompared} files.`)
} else {
  console.log(`\nDISAGREEMENT — see ${OUT}`)
  process.exitCode = 1
}
