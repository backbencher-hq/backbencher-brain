/**
 * TYPESCRIPT ONTOLOGY TRUTH — JOB 1's instrument for analyzer/IMPORTS_ENUM.
 *
 * WHAT THIS IS, AND WHY IT EXISTS ALONGSIDE `ts-ontology-census.ts`.
 *
 * `ts-ontology-census.ts` counts what the analyzer EMITS. It answers questions
 * 2 (fires), 5 (resolved), 6 (confident) and R7. It cannot answer question 3
 * (correct): a census and the analyzer share the same reading of the grammar, so
 * a grammar misreading is invisible to both.
 *
 * This file adds an ORACLE: an independent walker over the SAME tree-sitter
 * grammar, written from the grammar's own node types rather than from the
 * analyzer's code, which counts what SHOULD be there. Analyzer-vs-oracle is
 * question 3. When both agree, a shared grammar bug is still possible and the
 * report says so; when they disagree, the difference is a real finding.
 *
 * It also runs the enum split measurement: which spelling of the import label
 * does the production path actually emit, and which spelling can a consumer
 * that reads `src/ast/types.ts` possibly see. See IMPORTS_ENUM.
 *
 * NO REGEX. Every text operation below is `startsWith`/`endsWith`/`indexOf`/
 * `slice`/`split`, and every syntactic fact is read from `node.type`,
 * `node.namedChild(i)`, `childForFieldName`, and the cursor API. The R7
 * placeholder test is a set membership test plus explicit prefix comparison,
 * not a pattern. A pattern here would match the very comments and string
 * literals the analyzer is supposed to ignore.
 *
 * READ-ONLY. Writes only the JSON passed with --out.
 *
 * Usage:
 *   bun run script/m14/ts-ontology-truth.ts [--out path.json] [--limit N]
 *                                            [--repo typescript] [--oracle]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"
import { getParser } from "../../src/ast/engine"
import { fileURLToPath } from "node:url"

// ----------------------------------------------------------------------------
// The ontology's ten types, in the spelling an ANALYZER emits on the wire.
//
// Read from `src/ast/engine.ts` at run time rather than restated, because a
// hardcoded copy is a copy that drifts. `src/ast/engine.ts` is the namespace
// all 48 analyzers import (`ASTEngine.RelationshipType`), so it is the only
// enum whose values can reach a relationship row. The `types.ts` spelling is
// read too, one block down, and the two are compared — that comparison IS the
// IMPORTS_ENUM measurement.
// ----------------------------------------------------------------------------
/** Set key separator. A NUL cannot occur in a TypeScript identifier, a module
 *  path or a qualified name, so a key built with it cannot collide with one that
 *  merely looks alike. Written via fromCharCode rather than a literal so the byte
 *  never has to appear in this source file. */
const SEP = String.fromCharCode(31)

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

/** Values of one `export enum RelationshipType` block, in declaration order. */
function readEnumValues(file: string): Map<string, string> {
  const src = readFileSync(file, "utf8")
  const at = src.indexOf("export enum RelationshipType")
  if (at < 0) throw new Error(`no RelationshipType enum in ${file}`)
  const body = src.slice(at)
  const end = body.indexOf("\n  }")
  const block = end > 0 ? body.slice(0, end) : body
  const out = new Map<string, string>()
  // Split on newline, then split each line at the FIRST `= "`. No pattern: the
  // enum body is one member per line by construction, and both members and
  // values are pure ASCII identifiers/literals.
  for (const line of block.split("\n")) {
    const eq = line.indexOf('= "')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    // eq -> '=', eq+1 -> space, eq+2 -> the opening quote. The VALUE starts at
    // eq+3; reading from eq+2 would yield the empty string before the quote.
    const rest = line.slice(eq + 3)
    const close = rest.indexOf('"')
    if (close < 0) continue
    const value = rest.slice(0, close)
    if (key === "" || key.includes(" ")) continue
    if (!out.has(key)) out.set(key, value)
  }
  return out
}

const ENGINE_ENUM = readEnumValues(path.join(REPO_ROOT, "src/ast/engine.ts"))
const TYPES_ENUM = readEnumValues(path.join(REPO_ROOT, "src/ast/types.ts"))

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

const enumSplit = {
  engineImports: ENGINE_ENUM.get("Imports") ?? null,
  typesImports: TYPES_ENUM.get("Imports") ?? null,
  agree: (ENGINE_ENUM.get("Imports") ?? null) === (TYPES_ENUM.get("Imports") ?? null),
  membersDiffering: [...new Set([...ENGINE_ENUM.keys(), ...TYPES_ENUM.keys()])]
    .filter((k) => (ENGINE_ENUM.get(k) ?? null) !== (TYPES_ENUM.get(k) ?? null))
    .map((k) => ({ member: k, engine: ENGINE_ENUM.get(k) ?? null, types: TYPES_ENUM.get(k) ?? null })),
  engineDistinctValues: [...new Set(ENGINE_ENUM.values())].sort(),
  typesDistinctValues: [...new Set(TYPES_ENUM.values())].sort(),
  engineValuesNotInTypes: [...new Set(ENGINE_ENUM.values())].filter((v) => !TYPES_ENUM.has(v)).sort(),
}

// ----------------------------------------------------------------------------
// argv
// ----------------------------------------------------------------------------
const argv = process.argv.slice(2)
const argOf = (flag: string): string | undefined => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}
const hasFlag = (flag: string): boolean => argv.includes(flag)
const OUT = argOf("--out")
const LANG = argOf("--lang") ?? "typescript"
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
// Default to the lane's assigned corpus. Drawn from every repo in the tree
// instead, `.ts` files in `csharp-sample`'s agent scripts and `vuejs` get mixed
// in and the sample stops being a typescript measurement.
const REPO_FILTER = argOf("--repo") ?? "typescript"
const MAX_BYTES = Number(argOf("--max-bytes") ?? String(400 * 1024))
const LIMIT = Number(argOf("--limit") ?? "0")
const WANT_ORACLE = hasFlag("--oracle") || hasFlag("--out")

// ----------------------------------------------------------------------------
// Standing rule R7. A placeholder literal is not a name. Set membership plus an
// explicit prefix test — NO pattern, because a pattern would also fire on
// legitimate identifiers and, worse, on the inside of string literals.
// ----------------------------------------------------------------------------
const PLACEHOLDER_LITERALS = new Set([
  "", "?", "unknown", "unknown_symbol", "unknownsymbol", "<unknown>", "undefined", "null",
  "todo", "tbd", "n/a", "na", "none", "anonymous", "<anonymous>", "anonymousfunction",
  "placeholder", "xxx", "<lambda>", "lambda", "func", "fn", "symbol", "name", "value",
  "target", "source", "object", "string", "number", "any", "unknown1", "foo", "bar", "baz",
])

/**
 * True when the endpoint is a PLACEHOLDER — a name the analyzer could not
 * resolve — rather than an ordinary program identifier.
 *
 * `declared` is not optional context, it is the discriminator, and the first
 * version of this census got it wrong in a way that manufactured 1,251 findings.
 * The inherited PLACEHOLDER_LITERALS set contains `name`, `value`, `target`,
 * `source`, `object`, `string`, `number`, `any`, `symbol`, `foo`, `bar`, `baz` —
 * words that are placeholders in the ABSTRACT and completely ordinary identifiers
 * in real code. Measured on 300 tracked files of fixtures/repositories/typescript
 * with the word-only test: 1,251 sites, of which the largest were
 * `references -> Symbol` (206, and TypeScript's own API declares `class Symbol`),
 * `uses -> name` (171, an interface property), `uses -> None` (94, a real enum
 * member), `calls -> value` (61, a real binding) and `contains -> foo` (8, a real
 * parameter in tsc/testdata/tests/cases/compiler/ClassDeclaration10.ts). A gate
 * that reports those as R7 placeholder endpoints is the "counts or it didn't
 * happen" failure in the honesty contract: a number that is true of nothing.
 *
 * So: a word that names a symbol THIS analyzer emitted for THIS file is a real
 * name, whatever it is spelled. Only then do the prefix families apply, and they
 * exist for shapes a symbol table cannot contain at all (`<unknown>`, `??x`).
 */
function isPlaceholderEndpoint(x: string, declared?: Set<string>): boolean {
  const t = x.trim()
  if (t === "") return true
  if (declared && declared.has(t)) return false
  const lower = t.toLowerCase()
  if (PLACEHOLDER_LITERALS.has(lower)) return true
  if (lower.startsWith("unknown")) return true
  if (t.startsWith("<")) return true
  if (t.startsWith("??")) return true
  return false
}

// ----------------------------------------------------------------------------
// Corpus. `git ls-files` so the draw is TRACKED files, not build output.
// ----------------------------------------------------------------------------
type CorpusFile = { repo: string; dir: string; rel: string; abs: string }
const files: CorpusFile[] = []
const repoNames = readdirSync(CR).sort()
for (const e of repoNames) {
  if (REPO_FILTER && !e.includes(REPO_FILTER)) continue
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let size: number
    try { size = statSync(abs).size } catch { continue }
    if (size > MAX_BYTES || size === 0) continue
    let text: string
    try { text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== LANG) continue
    files.push({ repo: e, dir, rel, abs })
    if (LIMIT && files.length >= LIMIT) break
  }
  if (LIMIT && files.length >= LIMIT) break
}
const admitted = files

// ----------------------------------------------------------------------------
// Tally shape. One row per ontology type.
// ----------------------------------------------------------------------------
type Row = {
  count: number
  files: Set<string>
  lines: Set<number>
  srcResolves: number
  tgtResolves: number
  bothResolve: number
  srcResolvesId: number
  tgtResolvesId: number
  /** Resolution by LEAF. `overrides` publishes `Derived.method -> Base.method`, so
   *  an exact-name test scores it 0% at both ends while every endpoint is a real
   *  symbol; the leaf is what a consumer resolves. Reported ALONGSIDE the exact
   *  number, never instead of it. */
  srcResolvesLeaf: number
  tgtResolvesLeaf: number
  emptyEndpoints: number
  selfLoops: number
  placeholderSrc: number
  placeholderTgt: number
  conf: Map<string, number>
  evidence: Map<string, number>
  reasons: Map<string, number>
  metaKeys: Map<string, number>
  /** `metadata.relationshipType` — the POSITION a type mention was read from
   *  (declared_type, return_type, type_parameter_constraint, …). This is the
   *  column that shows a new SURFACE arriving, as opposed to a new type. */
  positions: Map<string, number>
  examples: string[]
  crossFileTargets: number
  targetShapes: Map<string, number>
}
const newRow = (): Row => ({
  count: 0, files: new Set(), lines: new Set(),
  srcResolves: 0, tgtResolves: 0, bothResolve: 0, srcResolvesId: 0, tgtResolvesId: 0,
  srcResolvesLeaf: 0, tgtResolvesLeaf: 0,
  emptyEndpoints: 0, selfLoops: 0, placeholderSrc: 0, placeholderTgt: 0,
  conf: new Map(), evidence: new Map(), reasons: new Map(), metaKeys: new Map(), positions: new Map(),
  examples: [], crossFileTargets: 0, targetShapes: new Map(),
})
const rows = new Map<Type, Row>()
for (const t of ALL_TYPES) rows.set(t, newRow())
/** Anything emitted that is NOT one of the ten — the unclassified bin. */
const offOntology = new Map<string, { count: number; files: Set<string>; examples: string[] }>()

type Rel = Record<string, any>
const endpointsOf = (r: Rel): [string, string] => {
  const s = r.source ?? r.from ?? r.fromSymbol ?? ""
  const t = r.target ?? r.to ?? r.toSymbol ?? ""
  return [String(s), String(t)]
}
const typeOf = (r: Rel): string => String(r.relationshipType ?? r.type ?? "")

// ----------------------------------------------------------------------------
// THE ORACLE. A second, independent walker over the SAME grammar.
//
// Written from node types, not from the analyzer: it reads the tree with a
// TreeCursor and counts CONSTRUCTS, then derives the expected edge for each.
// It shares the parser, so a bug IN THE GRAMMAR is invisible to it — stated
// here rather than claimed away. What it is independent of is the analyzer's
// traversal, its scope stack, its symbol table and its filters.
// ----------------------------------------------------------------------------
type OracleCounts = Record<Type, number> & { newExpressionTotal: number }
/**
 * `new X()` targets the oracle refuses to expect, BY REASON. The analyzer
 * documents both exclusions, and restating them here is what makes the
 * count difference attributable instead of mysterious. They are copied as
 * BEHAVIOUR (a name is intrinsic / a shape is not a leaf), not as a call into
 * analyzer code, so the oracle still derives its answer from the tree.
 */
const INTRINSIC_CTORS = new Set([
  "Promise", "Map", "Set", "WeakMap", "WeakSet", "WeakRef", "Array", "Object", "String",
  "Number", "Boolean", "Symbol", "BigInt", "Date", "RegExp", "Error", "TypeError",
  "RangeError", "SyntaxError", "EvalError", "ReferenceError", "URIError", "AggregateError",
  "Proxy", "Reflect", "ArrayBuffer", "SharedArrayBuffer", "DataView", "Int8Array",
  "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array",
  "Uint32Array", "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array",
  "URL", "URLSearchParams", "TextEncoder", "TextDecoder", "Headers", "Request",
  "Response", "FormData", "Blob", "File", "AbortController", "AbortSignal",
  "Event", "EventTarget", "MessageChannel", "MessagePort", "WebSocket",
  "Worker", "Notification", "CustomEvent", "Storage", "Iterator", "AsyncIterator",
  "Uint8ClampedArray", "Generator", "GeneratorFunction", "AsyncGenerator",
  "Intl", "WebAssembly", "Function", "eval",
  // Measured on the corpus: the analyzer filters this and this oracle's list did
  // not, so `new FinalizationRegistry()` was the single oracle-only
  // `instantiates` row at 500 files (tsc/testdata/tests/cases/compiler/
  // acceptSymbolAsWeakType.ts). The ANALYZER is right — it is a runtime
  // intrinsic, constructed here — and the oracle list was the incomplete side.
  "FinalizationRegistry",
  // NOTE: `Disposable` and `Symbol` were briefly in this list and had to come out
  // again. `fixtures/repositories/typescript/packages/vscode-typescript/src/*.ts`
  // DECLARES both — `class Disposable`, `class Symbol` in TypeScript's own API —
  // so treating them as intrinsics made the oracle MISS two real `instantiates`
  // the analyzer published. An intrinsic list is only as good as the corpus it was
  // checked against, and this is the measurement that checks it.
])
const NAMEABLE_CTOR = new Set([
  "identifier", "member_expression", "nested_identifier", "qualified_identifier",
  "generic_type", "template_type", "type_identifier", "type_descriptor", "primitive_type",
])
const oracleBreakdown = {
  newCtorShape: new Map<string, number>(),
}
/** Constructs the oracle deliberately does not reason about, so a zero it
 *  reports is never mistaken for a clean measurement. Empty means the oracle
 *  claims no construct it walks is unhandled. */
const ORACLE_LIMITS: { skipped: { nodeType: string; reason: string }[] } = { skipped: [] }
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)

function isErrType(t: string): boolean {
  return t === "ERROR" || t === "MISSING" || t === "MISSING_IDENTIFIER"
}

/** Text of a node with `string`/`template_string`/`raw_string` quotes stripped. */
function stringContentOf(n: { text: string; type: string }): string {
  const raw = n.text
  if (n.type === "string") {
    const q = raw.charAt(0)
    if (q === '"' || q === "'" || q === "`") return raw.slice(1, raw.length - 1)
    return raw
  }
  if (n.type === "raw_string") return raw.slice(1, raw.length - 1)
  return raw
}

const MODULE_LEAF_EXTS = [".ts", ".tsx", ".mts", ".cts"]

/**
 * The oracle's single traversal. It returns expected edge COUNTS per type plus
 * a set of the exact `source\x1ftarget` keys it expects for the types whose
 * identity is checkable (`extends`, `implements`, `instantiates`), so agreement
 * can be measured as a set comparison rather than a count comparison.
 */
async function oracleFor(rootNode: any, sourceText: string, fileAbs: string) {
  const counts = Object.fromEntries(ALL_TYPES.map((t) => [t, 0])) as OracleCounts
  counts.newExpressionTotal = 0
  const expectExtends = new Set<string>()
  const expectImplements = new Set<string>()
  const expectInstantiates = new Set<string>()
  const expectImports = new Set<string>()
  const moduleLeaf = path.basename(fileAbs, path.extname(fileAbs))

  // The enclosing symbol names, maintained by the walk: a `class` or an
  // `interface` header names the edges its heritage produces.
  const typeStack: string[] = []
  const breakdown = new Map<string, number>()

  const cursor = rootNode.walk()
  let visited = 0
  do {
    visited++
    if (visited > 4_000_000) break
    const n = cursor.currentNode
    const t = n.type
    if (!isErrType(t)) {
      // --- extends / implements ------------------------------------------
      // `class_declaration`, `abstract_class_declaration`,
      // `interface_declaration`, `class` (the class EXPRESSION) all carry a
      // `class_heritage` child, itself an `extends_clause` (possibly several,
      // comma-separated in an interface heritage) plus an `implements_clause`.
      if (
        t === "class_declaration" || t === "abstract_class_declaration" ||
        t === "interface_declaration" || t === "class"
      ) {
        const nameNode = n.childForFieldName("name")
        const self = nameNode ? nameNode.text : null
        let heritage: any = null
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && (c.type === "class_heritage" || c.type === "extends_type_clause")) { heritage = c; break }
        }
        if (heritage) {
          // The heritage node is NOT always a container. `class_heritage`
          // WRAPS `extends_clause` + `implements_clause`, but an interface's
          // heritage IS the `extends_type_clause` itself (measured on
          // tsc/testdata/fixtures/compiler/types.ts: 392 of 524 type
          // declarations carry heritage, and iterating the heritage node's
          // CHILDREN for another extends clause finds none, because there is
          // no inner clause to find). So the clause list is built by treating
          // the heritage node as a member of its own clause list when it is
          // itself a clause.
          const clauses: any[] = []
          if (heritage.type === "extends_clause" || heritage.type === "extends_type_clause") clauses.push(heritage)
          for (let i = 0; i < heritage.namedChildCount; i++) {
            const c = heritage.namedChild(i)
            if (c) clauses.push(c)
          }
          for (const c of clauses) {
            if (c.type === "extends_clause" || c.type === "extends_type_clause") {
              // `extends_clause` holds its base in the `value` FIELD and puts
              // generic arguments in a SIBLING `type_arguments` field, so
              // iterating its named children would see the arguments and never
              // the base. `extends_type_clause` (interface heritage) instead
              // carries one `type` field PER base, which is why both are read
              // here and why the field, not the child list, is the truth.
              const bases: string[] = []
              const viaValue = c.childForFieldName("value")
              if (viaValue) { const nm = leafOfTypeRef(viaValue); if (nm) bases.push(nm) }
              else {
                for (let k = 0; k < c.namedChildCount; k++) {
                  const b = c.namedChild(k)
                  if (!b || b.type === "type_arguments") continue
                  const nm = leafOfTypeRef(b)
                  if (nm) bases.push(nm)
                }
              }
              for (const b of bases) {
                if (self) { counts.extends++; expectExtends.add(`${self}${SEP}${b}`) }
              }
            } else if (c.type === "implements_clause") {
              for (let k = 0; k < c.namedChildCount; k++) {
                const iface = c.namedChild(k)
                if (!iface) continue
                const ifaceName = leafOfTypeRef(iface)
                if (ifaceName && self) {
                  counts.implements++
                  expectImplements.add(`${self}${SEP}${ifaceName}`)
                }
              }
            }
          }
        }
        if (self) typeStack.push(self)
      }

      // --- imports -------------------------------------------------------
      if (t === "import_statement") {
        const src = n.namedChildren.find((c: any) => c && (c.type === "string" || c.type === "template_string"))
        if (src) {
          const modulePath = stringContentOf(src)
          const hasClause = n.namedChildren.some((c: any) => c && c.type === "import_clause")
          const requireClause = n.namedChildren.find((c: any) => c && c.type === "import_require_clause")
          if (!hasClause || requireClause) {
            counts.imports++
            expectImports.add(`${moduleLeaf}${SEP}${modulePath}:*`)
          } else {
            const clause = n.namedChildren.find((c: any) => c && c.type === "import_clause")
            if (clause) {
              for (const item of importItemsOf(clause)) {
                counts.imports++
                expectImports.add(`${moduleLeaf}${SEP}${modulePath}:${item.original}`)
              }
            }
          }
        }
      }
      // A RE-EXPORT is a dependency too (`export … from "./m"`), which the
      // imports/exports oracle also derives. Without this arm the two lane
      // oracles would disagree on the same construct, and the disagreement would
      // read as an analyzer defect rather than as one oracle being behind.
      if (t === "export_statement") {
        const src = n.childForFieldName("source")
        if (src) {
          const modulePath = stringContentOf(src)
          const kinds = namedTypes(n)
          const star = kinds.includes("namespace_export") || hasBareStarToken(n)
          const asked: string[] = []
          for (const c of namedOf(n)) {
            if (c.type !== "export_clause") continue
            for (const spec of namedOf(c)) {
              if (spec.type !== "export_specifier") continue
              const name = spec.childForFieldName("name")
              if (name) asked.push(name.text)
            }
          }
          if (star) asked.push("*")
          if (asked.length === 0) { counts.imports++; expectImports.add(`${moduleLeaf}${SEP}${modulePath}:*`) }
          else for (const a of asked) { counts.imports++; expectImports.add(`${moduleLeaf}${SEP}${modulePath}:${a}`) }
        }
      }
      if (t === "call_expression") {
        const callee = n.childForFieldName("function")
        if (callee && (callee.type === "import" || (callee.type === "identifier" && callee.text === "require"))) {
          const args = n.childForFieldName("arguments")
          const pathArg = args && args.namedChildCount > 0 ? args.namedChild(0) : null
          if (pathArg && (pathArg.type === "string" || pathArg.type === "template_string")) {
            counts.imports++
            expectImports.add(`${moduleLeaf}${SEP}${stringContentOf(pathArg)}:*`)
          }
        }
      }

      // --- instantiates ---------------------------------------------------
      if (t === "new_expression") {
        const ctor = n.childForFieldName("constructor")
        if (ctor) {
          // Classify rather than count, so a difference from the analyzer can
          // be ATTRIBUTED. The analyzer documents two exclusions — an
          // intrinsic/global constructor (`new Promise()`) and a constructor
          // that is not a nameable leaf (`new (getCtor())()`) — and a bare
          // count difference of "analyzer < oracle" proves nothing without
          // knowing which of the two did the removing.
          counts.newExpressionTotal++
          const shape = ctor.type
          let raw = ctor.text
          const leaf = calleeLeaf(ctor)
          let dot = raw.lastIndexOf(".")
          if (dot !== -1 && dot < raw.length - 1) raw = raw.slice(dot + 1)
          const lt = raw.indexOf("<")
          if (lt !== -1) raw = raw.slice(0, lt)
          if (shape === "generic_type") {
            const tn = ctor.namedChild(0)
            bump(breakdown, "generic_type")
            if (INTRINSIC_CTORS.has(tn ? tn.text : "")) bump(breakdown, "intrinsic")
            else if (tn) { counts.instantiates++; expectInstantiates.add(tn ? tn.text : "") }
          } else if (!NAMEABLE_CTOR.has(shape)) {
            bump(breakdown, `non-nameable:${shape}`)
          } else if (INTRINSIC_CTORS.has(raw)) {
            bump(breakdown, "intrinsic")
          } else {
            bump(breakdown, "should-emit")
            counts.instantiates++
            expectInstantiates.add(raw)
          }
        }
      }
    }
    if (cursor.gotoFirstChild()) continue
    // Close a scope opened above, so typeStack is depth-accurate.
    if (n.type === "class_declaration" || n.type === "abstract_class_declaration" ||
        n.type === "interface_declaration" || n.type === "class") {
      if (typeStack.length) typeStack.pop()
    }
    while (!cursor.gotoNextSibling()) {
      if (!cursor.gotoParent()) return { counts, expectExtends, expectImplements, expectInstantiates, expectImports, newShape: breakdown, visited }
    }
  } while (true)
  return { counts, expectExtends, expectImplements, expectInstantiates, expectImports, newShape: breakdown, visited }
}

/**
 * The LEAF of an edge endpoint: drop everything from the first `<`, then keep
 * the last dotted segment. No regex. Used for the RESOLUTION measurement, where
 * it is what a consumer actually joins on — `overrides` publishes
 * `Derived.method -> Base.method`, so an exact-name test scores it 0% at both
 * ends while every endpoint names a real symbol.
 */
function leafOf(text: string): string {
  let t = text.trim()
  const lt = t.indexOf("<")
  if (lt !== -1) t = t.slice(0, lt).trim()
  const dot = t.lastIndexOf(".")
  if (dot !== -1) t = t.slice(dot + 1).trim()
  return t
}

/** The rightmost identifier of a type reference: `A.B.C` -> `C`. */
function leafOfTypeRef(n: any): string | null {
  // A heritage target is a LEAF (TSD3/TSD4), and the analyzer honours that; this
  // function is what the oracle has to do to match it. It did not, and the
  // disagreement showed up as 9 of 38 `implements` rows and 2 of 652 `extends` at
  // 500 files — every one of them a QUALIFIED base:
  //     implements vscode.Disposable   oracle said `vscode.Disposable`
  //     extends globalThis.IteratorObject   oracle said `globalThis.IteratorObject`
  // The analyzer said `Disposable` and `IteratorObject`, which is the leaf and is
  // what the shared differential's `normTarget` also reduces both sides to. The
  // ORACLE was the side that was behind.
  if (n.type === "type_identifier" || n.type === "identifier") return n.text
  // `nested_type_identifier` is a QUALIFIED type with `module:` and `name:`
  // FIELDS — `vscode.Disposable` is `(nested_type_identifier module: (identifier)
  // name: (type_identifier))`, and its `.text` is the whole dotted path.
  if (n.type === "nested_type_identifier") {
    const nm = n.childForFieldName("name") ?? n.namedChild(n.namedChildCount - 1)
    return nm ? nm.text : null
  }
  if (n.type === "generic_type") {
    const nameNode = n.childForFieldName("name") ?? n.namedChild(0)
    return nameNode ? leafOfTypeRef(nameNode) : null
  }
  if (n.type === "member_expression") {
    const prop = n.childForFieldName("property") ?? n.childForFieldName("name")
    return prop ? prop.text : null
  }
  if (n.type === "parenthesized_type") {
    const inner = n.namedChild(0)
    return inner ? leafOfTypeRef(inner) : null
  }
  return null
}

/** `a.b.c()` -> `c`; `f()` -> `f`. */
function calleeLeaf(n: any): string | null {
  if (n.type === "identifier" || n.type === "property_identifier") return n.text
  if (n.type === "member_expression" || n.type === "subscript_expression") {
    const prop = n.childForFieldName("property") ?? n.childForFieldName("index")
    return prop ? prop.text : null
  }
  if (n.type === "call_expression") {
    const inner = n.childForFieldName("function")
    return inner ? calleeLeaf(inner) : null
  }
  return null
}

/** Named children of a node. */
const namedOf = (n: any): any[] => {
  const out: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) out.push(c) }
  return out
}
const namedTypes = (n: any): string[] => namedOf(n).map((c: any) => c.type)
/** Is there a bare `*` ANONYMOUS token among a node's children? */
const hasBareStarToken = (n: any): boolean => {
  for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c && !c.isNamed && c.type === "*") return true }
  return false
}

/** Named/default/namespace import items of an `import_clause`. */
function importItemsOf(clause: any): { original: string; local: string }[] {
  const out: { original: string; local: string }[] = []
  for (let i = 0; i < clause.namedChildCount; i++) {
    const c = clause.namedChild(i)
    if (!c) continue
    if (c.type === "identifier") { out.push({ original: c.text, local: c.text }); continue }
    if (c.type === "namespace_import") {
      const id = c.namedChildren.find((x: any) => x && x.type === "identifier")
      out.push({ original: "*", local: id ? id.text : "*" })
      continue
    }
    if (c.type === "named_imports") {
      for (let k = 0; k < c.namedChildCount; k++) {
        const spec = c.namedChild(k)
        if (!spec) continue
        if (spec.type === "import_specifier") {
          const name = spec.childForFieldName("name")
          const alias = spec.childForFieldName("alias")
          out.push({ original: name ? name.text : "", local: alias ? alias.text : name ? name.text : "" })
        }
      }
    }
  }
  return out
}

// ----------------------------------------------------------------------------
// Run. parseFile IS the production path (src/ast/pool-worker.ts, the same
// entry the indexer calls), so this measures emitted edges and not a test path.
// ----------------------------------------------------------------------------
let parsed = 0, failed = 0, totalSymbols = 0, totalRels = 0
const parseErrorFiles: string[] = []
const filesWithRels = new Set<string>()
const errText: string[] = []
const oracleSeenExtends = new Set<string>()
const oracleSeenImplements = new Set<string>()
const oracleSeenInstantiates = new Set<string>()
const analyzerSeenExtends = new Set<string>()
const analyzerSeenImplements = new Set<string>()
const analyzerSeenInstantiates = new Set<string>()
const oracleTotal = Object.fromEntries(ALL_TYPES.map((t) => [t, 0])) as OracleCounts
oracleTotal.newExpressionTotal = 0
let oracleVisited = 0
let oracleFiles = 0

let idx = 0
async function worker() {
  while (true) {
    const i = idx++
    if (i >= admitted.length) return
    const f = admitted[i]
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch (e) { failed++; if (errText.length < 5) errText.push(String(e).slice(0, 120)); continue }
    parsed++
    const label = `${f.repo}/${f.rel}`
    const symbols: any[] = r?.symbols ?? []
    totalSymbols += symbols.length
    // "Resolves" means: binds to a symbol THIS analyzer emitted in THIS file.
    // Two bindings are counted separately — the strict one (`id`, which is what
    // the database joins on) and the loose one (bare `name`, which is what the
    // analyzer's own edge endpoints carry). Reporting only the loose number
    // would flatter the lane.
    const ids = new Set<string>()
    const names = new Set<string>()
    for (const s of symbols) {
      if (s?.id) ids.add(String(s.id))
      if (s?.name) names.add(String(s.name))
    }
    const rels: Rel[] = r?.relationships ?? []
    totalRels += rels.length
    if (rels.length) filesWithRels.add(label)
    for (const rel of rels) {
      const t = typeOf(rel)
      const [src, tgt] = endpointsOf(rel)
      // Set keys carry the file label so a same-named class in two files is two
      // keys, and carry only the TARGET for `instantiates` (the oracle reads the
      // constructor leaf and has no enclosing symbol, so keying by source would
      // compare two different questions).
      if (t === "extends" || t === "implements") {
        const bucket = t === "extends" ? analyzerSeenExtends : analyzerSeenImplements
        bucket.add(`${label}${SEP}${src}${SEP}${tgt}`)
      } else if (t === "instantiates") {
        analyzerSeenInstantiates.add(`${label}${SEP}${tgt}`)
      }
      const row = rows.get(t as Type)
      if (!row) {
        let bin = offOntology.get(t)
        if (!bin) { bin = { count: 0, files: new Set(), examples: [] }; offOntology.set(t, bin) }
        bin.count++
        if (bin.files.size < 200) bin.files.add(label)
        if (bin.examples.length < 4) bin.examples.push(`${src} -> ${tgt}`)
        continue
      }
      row.count++
      if (row.files.size < 500) row.files.add(label)
      const ln = rel.line_number ?? rel.lineNumber
      if (typeof ln === "number" && ln > 0) row.lines.add(ln)
      if (src === "" || tgt === "") row.emptyEndpoints++
      if (src !== "" && src === tgt) row.selfLoops++
      const sLeaf = names.has(leafOf(src)), tLeaf = names.has(leafOf(tgt))
      if (sLeaf) row.srcResolvesLeaf++
      if (tLeaf) row.tgtResolvesLeaf++
      const sName = names.has(src), tName = names.has(tgt)
      const sId = ids.has(src), tId = ids.has(tgt)
      if (sName || sId) row.srcResolves++
      if (tName || tId) row.tgtResolves++
      if ((sName || sId) && (tName || tId)) row.bothResolve++
      if (sId) row.srcResolvesId++
      if (tId) row.tgtResolvesId++
      if (isPlaceholderEndpoint(src, names)) row.placeholderSrc++
      if (isPlaceholderEndpoint(tgt, names)) row.placeholderTgt++
      // A target that is NOT a symbol of this file and not bare-nameable is
      // CROSS-FILE by construction: it names something in another module. This
      // is the honest way to separate "unresolved" from "external".
      if (tgt !== "" && !tName && !tId) row.crossFileTargets++
      bump(row.targetShapes, tgt.includes(":") ? (tgt.endsWith(":*") ? "module:*" : "module:symbol") : tgt.includes(".") ? "dotted" : "bare")
      bump(row.conf, rel.confidence === undefined ? "absent" : String(rel.confidence))
      bump(row.evidence, String(rel.metadata?.evidenceClass ?? rel.evidenceClass ?? "absent"))
      const reason = rel.metadata?.reason ?? rel.metadata?.confidenceReason ?? rel.reason
      if (reason) bump(row.reasons, String(reason))
      for (const k of Object.keys(rel.metadata ?? {})) bump(row.metaKeys, k)
      if (rel.metadata?.relationshipType) bump(row.positions, String(rel.metadata.relationshipType))
      if (row.examples.length < 6) row.examples.push(`${src} -> ${tgt}`)
    }

    if (WANT_ORACLE) {
      try {
        const content = readFileSync(f.abs, "utf8")
        // The oracle gets its OWN parse. `parseFile` does not return the root
        // node (measured: its keys are success, language, framework, fileHash,
        // sizeBytes, lastModified, symbols, imports, relationships, exports,
        // errors, metadata), so the oracle re-parses rather than borrowing the
        // analyzer's tree. Same parser, same grammar — a bug in the grammar is
        // therefore invisible to the comparison, and the report says so instead
        // of claiming more than this harness can support.
        const parser = await getParser("typescript")
        const tree = await parser.parse(content)
        if (!tree) throw new Error("parser.parse returned no tree (null result)")
        const o: any = await oracleFor(tree.rootNode, content, f.abs)
        oracleVisited += o.visited
        oracleFiles++
        for (const t of ALL_TYPES) oracleTotal[t] += o.counts[t]
        oracleTotal.newExpressionTotal += o.counts.newExpressionTotal
        for (const [k, v] of o.newShape.entries()) bump(oracleBreakdown.newCtorShape, k)
        for (const k of o.expectExtends) oracleSeenExtends.add(`${label}${SEP}${k}`)
        for (const k of o.expectImplements) oracleSeenImplements.add(`${label}${SEP}${k}`)
        for (const k of o.expectInstantiates) oracleSeenInstantiates.add(`${label}${SEP}${k}`)
      } catch (e) { if (errText.length < 10) errText.push(`oracle ${label} ${String(e).slice(0, 90)}`) }
    }
  }
}
const CONCURRENCY = Number(process.env.BB_CENSUS_WORKERS ?? "8")
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

// ----------------------------------------------------------------------------
// Report
// ----------------------------------------------------------------------------
const pct = (n: number, of: number) => (of ? ((100 * n) / of).toFixed(1) : "-")
const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)

console.log(`typescript ontology truth — ${LANG}`)
console.log(`enum split: engine.ts Imports=${JSON.stringify(enumSplit.engineImports)}  types.ts Imports=${JSON.stringify(enumSplit.typesImports)}  agree=${enumSplit.agree}`)
for (const d of enumSplit.membersDiffering) console.log(`  DIFFERING MEMBER ${d.member}: engine=${JSON.stringify(d.engine)} types.ts=${JSON.stringify(d.types)}`)
console.log(`  values in engine but NOT in types.ts: ${enumSplit.engineValuesNotInTypes.length ? enumSplit.engineValuesNotInTypes.join(", ") : "(none)"}`)
console.log("")
console.log(`corpus ${CR}: ${admitted.length} admitted, ${parsed} parsed, ${failed} failed`)
console.log(`symbols ${totalSymbols.toLocaleString()}  relationships ${totalRels.toLocaleString()}  files with edges ${filesWithRels.size}`)
if (errText.length) console.log(`errors: ${errText.join(" | ")}`)
console.log("")

console.log(`${pad("type", 13)}${pad("emitted", 10)}${pad("files", 8)}${pad("oracle", 10)}${pad("srcName%", 10)}${pad("tgtName%", 10)}${pad("tgtLeaf%", 10)}${pad("xFile%", 9)}${pad("empty", 7)}${pad("self", 7)}${pad("R7", 6)}confidence`)
console.log("-".repeat(150))
const out: any = {
  at: new Date().toISOString(),
  lang: LANG,
  corpusRoot: CR,
  filesAdmitted: admitted.length,
  filesParsed: parsed,
  filesFailed: failed,
  totalSymbols,
  totalRelationships: totalRels,
  filesWithRelationships: filesWithRels.size,
  maxBytes: MAX_BYTES,
  enumSplit,
  oracle: {
    ran: WANT_ORACLE,
    files: oracleFiles,
    nodeVisits: oracleVisited,
    totals: oracleTotal,
    skippedConstructs: ORACLE_LIMITS.skipped,
    extendsOnlyAnalyzer: [...analyzerSeenExtends].slice(0, 8),
    extendsOnlyOracle: [...oracleSeenExtends].slice(0, 8),
    implementsOnlyAnalyzer: [...analyzerSeenImplements].slice(0, 8),
    implementsOnlyOracle: [...oracleSeenImplements].slice(0, 8),
    instantiatesOnlyAnalyzer: [...analyzerSeenInstantiates].slice(0, 8),
    instantiatesOnlyOracle: [...oracleSeenInstantiates].slice(0, 8),
    setAgreement: {
      extends: {
        analyzer: analyzerSeenExtends.size, oracle: oracleSeenExtends.size,
        both: [...analyzerSeenExtends].filter((k) => oracleSeenExtends.has(k)).length,
        // FULL diff lists, not an 8-element sample. A sample cannot answer the
        // question it looks like it answers: at 500 files `implements` reported
        // 29 of 38 shared while both 8-element samples diffed EMPTY, because the
        // eight sampled keys all happened to be in both sets. Reading the sample
        // as "no disagreement" would have been a fabricated clean.
        analyzerOnly: [...analyzerSeenExtends].filter((k) => !oracleSeenExtends.has(k)).slice(0, 200),
        oracleOnly: [...oracleSeenExtends].filter((k) => !analyzerSeenExtends.has(k)).slice(0, 200),
      },
      implements: {
        analyzer: analyzerSeenImplements.size, oracle: oracleSeenImplements.size,
        both: [...analyzerSeenImplements].filter((k) => oracleSeenImplements.has(k)).length,
        analyzerOnly: [...analyzerSeenImplements].filter((k) => !oracleSeenImplements.has(k)).slice(0, 200),
        oracleOnly: [...oracleSeenImplements].filter((k) => !analyzerSeenImplements.has(k)).slice(0, 200),
      },
      instantiates: {
        analyzer: analyzerSeenInstantiates.size, oracle: oracleSeenInstantiates.size,
        both: [...analyzerSeenInstantiates].filter((k) => oracleSeenInstantiates.has(k)).length,
        analyzerOnly: [...analyzerSeenInstantiates].filter((k) => !oracleSeenInstantiates.has(k)).slice(0, 200),
        oracleOnly: [...oracleSeenInstantiates].filter((k) => !analyzerSeenInstantiates.has(k)).slice(0, 200),
      },
    },
  },
  types: {},
  offOntology: {},
  errors: errText,
}
for (const t of ALL_TYPES) {
  const s = rows.get(t)!
  const hist = [...s.conf.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" ")
  out.types[t] = {
    emitted: s.count,
    files: s.files.size,
    fileSample: [...s.files].slice(0, 10),
    distinctLines: s.lines.size,
    srcResolvesByName: s.srcResolves,
    targetResolvesByName: s.tgtResolves,
    bothResolveByName: s.bothResolve,
    srcResolvesById: s.srcResolvesId,
    targetResolvesById: s.tgtResolvesId,
    srcResolvesByLeaf: s.srcResolvesLeaf,
    targetResolvesByLeaf: s.tgtResolvesLeaf,
    targetNotInThisFile: s.crossFileTargets,
    emptyEndpoints: s.emptyEndpoints,
    selfLoops: s.selfLoops,
    placeholderSrc: s.placeholderSrc,
    placeholderTgt: s.placeholderTgt,
    confidenceHistogram: Object.fromEntries(s.conf),
    evidenceClassHistogram: Object.fromEntries(s.evidence),
    confidenceReasonHistogram: Object.fromEntries([...s.reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)),
    metadataKeyHistogram: Object.fromEntries([...s.metaKeys.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)),
    positionHistogram: Object.fromEntries([...s.positions.entries()].sort((a, b) => b[1] - a[1])),
    targetShapeHistogram: Object.fromEntries(s.targetShapes),
    oracleConstructs: oracleTotal[t],
    examples: s.examples,
  }
  console.log(
    pad(t, 13) + pad(s.count.toLocaleString(), 10) + pad(String(s.files.size), 8) +
    pad(WANT_ORACLE ? oracleTotal[t].toLocaleString() : "-", 10) +
    pad(pct(s.srcResolves, s.count), 10) + pad(pct(s.tgtResolves, s.count), 10) +
    pad(pct(s.tgtResolvesLeaf, s.count), 10) + pad(pct(s.crossFileTargets, s.count), 9) +
    pad(String(s.emptyEndpoints), 7) + pad(String(s.selfLoops), 7) +
    pad(String(s.placeholderSrc + s.placeholderTgt), 6) + hist,
  )
}
const zero = ALL_TYPES.filter((t) => rows.get(t)!.count === 0)
const oracleOnly = WANT_ORACLE ? ALL_TYPES.filter((t) => oracleTotal[t] > 0 && rows.get(t)!.count === 0) : []
console.log(`\nEMITTED ZERO: ${zero.length ? zero.join(", ") : "(none)"}`)
console.log(`ORACLE SAW, ANALYZER EMITTED ZERO: ${oracleOnly.length ? oracleOnly.join(", ") : "(none)"}`)
if (offOntology.size) {
  console.log(`\nOFF-ONTOLOGY LABELS (must be empty; anything here is an 11th type):`)
  for (const [k, v] of [...offOntology.entries()].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${pad(k, 20)} ${String(v.count).padStart(8)}  files ${v.files.size}  e.g. ${v.examples.slice(0, 2).join(" ; ")}`)
    out.offOntology[k] = { count: v.count, files: v.files.size, fileSample: [...v.files].slice(0, 8), examples: v.examples }
  }
}
const r7 = ALL_TYPES.reduce((a, t) => a + rows.get(t)!.placeholderSrc + rows.get(t)!.placeholderTgt, 0)
const empty = ALL_TYPES.reduce((a, t) => a + rows.get(t)!.emptyEndpoints, 0)
console.log(`\nR7 placeholder endpoints total: ${r7}   empty endpoints total: ${empty}`)
if (WANT_ORACLE) {
  const bd = [...oracleBreakdown.newCtorShape.entries()].sort((a, b) => b[1] - a[1])
  console.log(`oracle new_expression classification: ${bd.map(([k, v]) => `${k}=${v}`).join("  ")}`)
  out.oracle.newExpressionTotal = oracleTotal.newExpressionTotal
  out.oracle.newCtorShape = Object.fromEntries(bd)
}
if (WANT_ORACLE) {
  const a = out.oracle.setAgreement
  for (const k of ["extends", "implements", "instantiates"] as const) {
    console.log(`oracle agreement ${k}: analyzer ${a[k].analyzer}  oracle ${a[k].oracle}  in BOTH ${a[k].both}`)
    const SEP2 = String.fromCharCode(31)
    for (const row of a[k].analyzerOnly.slice(0, 10)) console.log(`    ANALYZER-ONLY  ${row.split(SEP2).slice(1).join(" -> ")}  @ ${row.split(SEP2)[0]}`)
    for (const row of a[k].oracleOnly.slice(0, 10)) console.log(`    ORACLE-ONLY    ${row.split(SEP2).slice(1).join(" -> ")}  @ ${row.split(SEP2)[0]}`)
  }
}
out.notEmitted = zero
out.oracleOnly = oracleOnly
out.r7Total = r7
out.emptyTotal = empty
if (OUT) {
  writeFileSync(OUT, JSON.stringify(out, null, 2))
  console.log(`\nwrote ${OUT}`)
}
void MODULE_LEAF_EXTS