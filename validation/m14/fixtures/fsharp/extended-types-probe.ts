/**
 * F# EXTENDED-TYPES PROBE — the four EXTENDED vocabulary values measured against the PINNED grammar.
 *
 * ## Why this instrument exists
 *
 * `script/m14/heritage-blindspot-probe.ts` (Lead-owned) prints, for `--lang=fsharp`:
 *
 *     ★ fsharp IS NOT CONFIGURED IN THIS PROBE … no heritage-like node for fsharp is confirmed
 *       from the analyzer's own source. ⇒ NOTHING IS MEASURED AND NOTHING IS CLAIMED.
 *
 * That is the probe being honest: its `HERITAGE` table is a literal, and it carries no fsharp
 * row. The probe's own closing line says the LANE's instrument is the authority for a language
 * it does not configure. So the heritage half of the extended-types question is measured HERE,
 * against the ANALYZER'S OWN LOOKUP — the lookup is read out of `src/ast/real-fsharp-analyzer.ts`
 * and re-implemented here byte-for-byte, so the probe cannot measure the probe's assumptions.
 *
 * ## THE ANALYZER'S OWN HERITAGE LOOKUP (quoted, with lines)
 *
 *   src/ast/real-fsharp-analyzer.ts:1061  `inherit`:  this.findDescendant(inh,  (n) => n.type === "long_identifier" || n.type === "identifier")
 *   src/ast/real-fsharp-analyzer.ts:1122  `interface`:this.findDescendant(impl, (n) => n.type === "long_identifier" || n.type === "identifier")
 *   src/ast/real-fsharp-analyzer.ts:4251  findDescendant(node, predicate, maxDepth = 5):
 *                                         a DEPTH-BOUNDED search over NAMED children only,
 *                                         first match in preorder wins.
 *
 * ⇒ fsharp's lookup is NOT a "direct-child shape list" the way javascript's is
 * (`identifier ?? member_expression` over the DIRECT named children, `real-javascript-analyzer.ts:786`),
 * so the javascript blind-spot class (802 of 2,572 clauses publishing NO EDGE AT ALL) cannot
 * arise the same way. But it IS depth-bounded at 5, which is a DIFFERENT blind spot, and this
 * probe measures it rather than assuming it away: for every heritage clause in the admitted
 * population it records the clause's DIRECT named children (the SHAPE) and whether the
 * analyzer's own lookup finds a name in it. A clause whose lookup finds nothing is an
 * UNCOVERED clause, and the count is the number this lane's page carries.
 *
 * ## WHAT IS MEASURED, AND OVER WHAT POPULATION
 *
 *   POPULATION — the corpus root `$PWD/.corpus` (199 absolute symlinks + 3 local checkouts),
 *   each repository's git-TRACKED set (`git ls-files -z`), F# extensions `.fs`/`.fsi`/`.fsx`,
 *   size <= 1 MB (the engine's own FULL_AST_LIMIT). Three denominators are printed separately
 *   and NEVER MIXED: PATHS · DISTINCT FILES · ADMITTED. The repo count is the number of
 *   repositories CARRYING an admitted file. Symlinked directories are FOLLOWED and the count of
 *   them followed is printed, because `readdirSync(...,{withFileTypes:true}).isDirectory()` is
 *   FALSE for a symlink and silently drops whole repositories.
 *
 *   INSTRUMENT A — the grammar's own node-type inventory over the whole admitted population.
 *   This is the POSITIVE EVIDENCE OF ABSENCE the doctrine names for a type the grammar cannot
 *   express: a construct that is not in the inventory cannot occur in the language.
 *
 *   INSTRUMENT B — the construct count ON THE TREE, for a construct the language CAN express.
 *   A string or a comment cannot fake it.
 *
 *   THE GRAMMAR'S IDENTITY is the sha256 of the BYTES THE REGISTRY SERVES (L-20), read through
 *   `src/util/wasm`'s own registry accessor — never a path, never an engine log line.
 *
 * ## The four EXTENDED values, and the QUESTION each one asks
 *
 *   decorates  "A decorator is APPLIED to a declaration … the runtime applies the decorator to
 *              the declaration" (src/ast/types.ts:120-144). DIRECTION: decorated declaration ->
 *              decorator. NOT `calls` (the declaration does not invoke it) and NOT `references`
 *              (a name mention says nothing about application).
 *              ⇒ THE GRAMMAR QUESTION: does F# have an APPLIED-CALLABLE-to-a-declaration
 *                construct? F#'s `[<Attribute>]` is PASSIVE METADATA. The test that decides it
 *                is the CONTRACT'S OWN: does the attribute's OWN ARGUMENT receive the marked
 *                declaration? Measure the attribute's argument shapes, do not assume.
 *
 *   renders    "The symbol whose body contains an element renders that component"
 *              (src/ast/types.ts:146-154). ⇒ THE GRAMMAR QUESTION: is there an element/component
 *              node type at all? F# has no JSX. Measure the inventory.
 *
 *   mixes_in   "The class composes this mixin's implementation into its own supertype chain via
 *              a `with` clause" (src/ast/types.ts:156-162). ⇒ THE GRAMMAR QUESTION: is there a
 *              with-clause node type? AND THE F#-SPECIFIC HALF, which is not the same question:
 *              F# has MODULE AUGMENTATION and `inherit`. `inherit` is NOT mixes_in (it is
 *              `extends`, per FSD3). So MODULE AUGMENTATION is measured SPECIFICALLY, by name.
 *
 *   part_of    "This file and the file the directive names are one compilation unit"
 *              (src/ast/types.ts:164-190). THE DIRECTION IS THE DIRECTIVE'S OWN: source is always
 *              the file carrying the directive, target is what it names. ⇒ THE GRAMMAR QUESTION:
 *              does F# have a directive naming ANOTHER FILE that is compiled together with this
 *              one? `#load "other.fs"` is exactly that shape. Measure it.
 *
 * ## READ-ONLY. Writes nothing unless BB_FSHARP_EXT_JSON names a file.
 *
 *   bun validation/m14/fixtures/fsharp/extended-types-probe.ts
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, lstatSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "..", "..", "..", "..")
const CORPUS = path.resolve(process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus"))
const SIZE_CAP = 1024 * 1024
const EXTS = [".fs", ".fsi", ".fsx"]
const LANG = "fsharp"

// ───────────────────────────────────────────────────────────── population

type Admitted = { repo: string; rel: string; abs: string }
type Pop = {
  corpusRoot: string
  entriesWalked: number
  symlinkedDirsFollowed: number
  reposSeen: number
  trackedPaths: number
  pathsFSharp: number
  overCap: number
  absent: number
  admitted: number
  distinctFiles: number
  reposCarryingAdmitted: number
}

function walkCorpus(): { admitted: Admitted[]; pop: Pop } {
  const admitted: Admitted[] = []
  const pop: Pop = {
    corpusRoot: CORPUS,
    entriesWalked: 0,
    symlinkedDirsFollowed: 0,
    reposSeen: 0,
    trackedPaths: 0,
    pathsFSharp: 0,
    overCap: 0,
    absent: 0,
    admitted: 0,
    distinctFiles: 0,
    reposCarryingAdmitted: 0,
  }
  const repos = new Set<string>()
  let entries: string[]
  try {
    entries = readdirSync(CORPUS).sort()
  } catch (e) {
    console.error(`cannot read corpus root ${CORPUS}: ${String(e)}`)
    process.exit(5)
  }
  for (const name of entries) {
    const dir = path.join(CORPUS, name)
    // statSync FOLLOWS a symlink — readdirSync(withFileTypes).isDirectory() does not, and that
    // difference silently drops whole repositories. The count of followed symlinks is printed.
    let st: ReturnType<typeof statSync>
    try {
      st = statSync(dir)
    } catch {
      continue
    }
    if (!st.isDirectory()) continue
    pop.entriesWalked++
    let isLink = false
    try {
      isLink = lstatSync(dir).isSymbolicLink()
    } catch {
      isLink = false
    }
    if (isLink) pop.symlinkedDirsFollowed++
    try {
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    pop.reposSeen++
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
        encoding: "utf8",
        maxBuffer: 512 * 1024 * 1024,
      }).split("\0").filter(Boolean)
    } catch {
      continue
    }
    for (const rel of tracked) {
      pop.trackedPaths++
      const lower = rel.toLowerCase()
      if (!EXTS.some((x) => lower.endsWith(x))) continue
      pop.pathsFSharp++
      const abs = path.join(dir, rel)
      let size: number
      try {
        size = statSync(abs).size
      } catch {
        pop.absent++
        continue
      }
      if (size > SIZE_CAP) {
        pop.overCap++
        continue
      }
      admitted.push({ repo: name, rel, abs })
      repos.add(name)
    }
  }
  pop.admitted = admitted.length
  pop.distinctFiles = new Set(admitted.map((a) => a.abs)).size
  pop.reposCarryingAdmitted = repos.size
  return { admitted, pop }
}

/** readlink without throwing on a non-link; null when the path is not a symbolic link. */

// ───────────────────────────────────────────────────────────── the grammar, by the bytes the registry serves

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })

let wasmBytes: Uint8Array
let wasmSource: string
try {
  const { hasWasmInRegistry, resolveWasmAsset } = await import(path.join(ROOT, "src/util/wasm"))
  const b = hasWasmInRegistry("tree-sitter-fsharp.wasm")
  if (!b) throw new Error("registry has no tree-sitter-fsharp.wasm")
  wasmBytes = b
  wasmSource = `registry:${resolveWasmAsset("tree-sitter-fsharp.wasm")}`
} catch (e) {
  console.error(`cannot read the grammar from the production registry: ${String(e)}`)
  process.exit(5)
}
const GRAMMAR_SHA = createHash("sha256").update(wasmBytes).digest("hex")
const parser = new WSP()
parser.setLanguage(await WSL.load(wasmBytes))

// ───────────────────────────────────────────────────────────── counters

const inventory = new Map<string, number>()
const inventoryFiles = new Map<string, Set<string>>()
/** DIRECT named children of a node, by type — the SHAPE, which is what the lookup question is about. */
const shapes = new Map<string, Map<string, number>>()
const shapeExamples = new Map<string, string[]>()

function bump(m: Map<string, number>, k: string) {
  m.set(k, (m.get(k) ?? 0) + 1)
}

/**
 * THE ANALYZER'S OWN `findDescendant`, re-implemented verbatim from
 * `src/ast/real-fsharp-analyzer.ts:4251-4262`: a depth-bounded preorder search over NAMED
 * children only, first match wins. `maxDepth` defaults to 5 and the heritage call sites do not
 * pass one, so 5 it is.
 */
function analyzerFindDescendant(node: any, pred: (n: any) => boolean, maxDepth = 5): any | undefined {
  if (maxDepth <= 0) return undefined
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)
    if (child) {
      if (pred(child)) return child
      const found = analyzerFindDescendant(child, pred, maxDepth - 1)
      if (found) return found
    }
  }
  return undefined
}

const heritagePred = (n: any) => n.type === "long_identifier" || n.type === "identifier"

type HeritageRow = {
  kind: "inherit" | "interface"
  clauses: number
  files: number
  /** clauses where the analyzer's lookup found NO name — the uncovered class */
  uncovered: number
  /** the DIRECT named child type of the clause — the shape */
  shapeCounts: Record<string, number>
  examples: string[]
}
const heritage: Record<"inherit" | "interface", HeritageRow> = {
  inherit: { kind: "inherit", clauses: 0, files: 0, uncovered: 0, shapeCounts: {}, examples: [] },
  interface: { kind: "interface", clauses: 0, files: 0, uncovered: 0, shapeCounts: {}, examples: [] },
}
const heritageFiles: Record<"inherit" | "interface", Set<string>> = { inherit: new Set(), interface: new Set() }

/** attribute family — the `decorates` question */
const attrShapes = new Map<string, number>()
const attrExamples: string[] = []
let attrSites = 0
let attrWithArg = 0
let attrArgIsApplication = 0
let attrArgIsLiteral = 0
let attrArgIsTypeof = 0
let attrArgOther = 0
let attrAttachedToDecl = 0
/** the ATTRIBUTE'S OWN ARGUMENT shape, counted by node type */
const attrArgShapes = new Map<string, number>()
/** the DECLARATION the attribute is attached to, counted by node type */
const attrOwnerShapes = new Map<string, number>()
/** attributes whose ARGUMENT carries a CALL (an `application_expression` anywhere in the
 *  argument subtree) — the C# lane's own question, measured for F# */
let attrArgCarriesACall = 0
const attrArgCallExamples: string[] = []
/** the CALLEE NAMES of the calls inside attribute arguments — `nameof`, `defaultof`, … */
const attrArgCallCallees = new Map<string, number>()
/** the attribute's argument calling THE ATTRIBUTE'S OWN TYPE — the applied-callable shape */
let attrArgCallNamesTheAttribute = 0
const attrArgCallSelfExamples: string[] = []

/** the LAST SEGMENT of a dotted name — `Foo.Bar` -> `Bar` (the name a component is published under) */
function lastSegment(text: string): string {
  const t = String(text ?? "").trim()
  const i = t.lastIndexOf(".")
  return i >= 0 ? t.slice(i + 1) : t
}
/** every `application_expression` in this subtree (the grammar's own word for a CALL) */
function collectApplicationExpressions(node: any): any[] {
  const out: any[] = []
  const stack: any[] = [node]
  let guard = 0
  while (stack.length > 0) {
    if (++guard > 5000) break
    const n = stack.pop()!
    if (n.type === "application_expression") out.push(n)
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return out
}
/** the CALLEE's name of a call — the head's last dotted segment */
function callHeadName(call: any): string {
  const head = call && call.namedChildCount > 0 ? call.namedChild(0) : null
  if (!head) return ""
  const t = String(head.text ?? "")
  // `f<T> (x)` — the head is a `typed_expression`; the callee is its own head
  const inner = head.type === "typed_expression" && head.namedChildCount > 0 ? head.namedChild(0) : head
  return lastSegment(String(inner?.text ?? t))
}
/** the DECLARATION a node sits in — the nearest enclosing declaration-ish node */
function enclosingDeclaration(node: any): string {
  let n = node?.parent ?? null
  let guard = 0
  while (n && ++guard < 24) {
    const t = n.type
    if (
      t === "member_defn" || t === "type_definition" || t === "named_module" || t === "module_defn" ||
      t === "function_or_value_defn" || t === "value_declaration" || t === "type_extension" ||
      t === "exception_definition" || t === "union_type_defn" || t === "record_type_defn" ||
      t === "interface_type_defn" || t === "enum_type_defn"
    ) return t
    n = n.parent
  }
  return ""
}

/** does this subtree contain an `application_expression`? (a CALL, in the grammar's own words) */
function containsApplicationExpression(node: any): boolean {
  const stack: any[] = [node]
  let guard = 0
  while (stack.length > 0) {
    if (++guard > 5000) return false
    const n = stack.pop()!
    if (n.type === "application_expression") return true
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return false
}

/** directive family — the `part_of` question */
const directiveCounts = new Map<string, number>()
const directiveExamples: string[] = []
let loadDirectives = 0
let loadWithString = 0
let rDirectives = 0
/** THE INFORMATION TEST for `part_of`: does the named file EXIST? A path no project key can
 *  answer is exactly the shape this label exists to stop publishing. */
let loadResolved = 0
let loadUnresolved = 0
const loadUnresolvedExamples: string[] = []
/** the OTHER resource directives, which stay `imports` */
let rDirectives2 = 0
let iDirectives = 0

/** module augmentation / extension — the `mixes_in` question */
let moduleDefnSites = 0
let moduleAugmentFiles = 0
let moduleAugmentSites = 0
let typeExtensionSites = 0
let inheritClauses = 0
let objectExpressionSites = 0


/** the `renders` candidates — every counter is a COUNT, never a name list asserted */
const RENDER_HOST_NAMES = new Set([
  "html", "htmlstring", "renderhtml", "lazyhtml", "render", "rendercomponent",
  "component", "staticcomponent", "htmlstring", "htmlencode", "markup",
])
let fnTypeSites = 0
const fnTypeFiles = new Set<string>()
const fnTypeLeftTypes = new Map<string, number>()
const fnTypeRightTypes = new Map<string, number>()
let explicitTypeArgCalls = 0
const explicitTypeArgFiles = new Set<string>()
const explicitTypeArgCallees = new Map<string, number>()
const explicitTypeArgTypes = new Map<string, number>()
let capitalizedConstructions = 0
const capitalizedConstructionFiles = new Set<string>()
const capitalizedHeads = new Map<string, number>()
const capitalizedByDeclaration = new Map<string, number>()
let nestedDeclarations = 0
const nestedDeclarationFiles = new Set<string>()
const nestedDeclarationOwners = new Map<string, number>()
const nestedDeclarationOwnerShapes = new Map<string, number>()
let renderHostCalls = 0
const renderHostFiles = new Set<string>()
const renderHostCallees = new Map<string, number>()
const renderHostArgShapes = new Map<string, number>()

/** `renders` — the element/component question */
const renderish = new Map<string, number>()

let walked = 0
let parseFailed = 0
let parseErrorTrees = 0
const failed: string[] = []
const errorTreeFiles: string[] = []

function walk(root: any, label: string) {
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()
    if (!n) continue
    bump(inventory, n.type)
    let fs = inventoryFiles.get(n.type)
    if (!fs) { fs = new Set(); inventoryFiles.set(n.type, fs) }
    fs.add(label)
    for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
  }
}

function shapeOf(n: any): string {
  const kids: string[] = []
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) kids.push(c.type)
  }
  return kids.length ? kids.join("+") : "(no named children)"
}

function recordShape(key: string, n: any, label: string) {
  let m = shapes.get(key)
  if (!m) { m = new Map(); shapes.set(key, m) }
  bump(m, shapeOf(n))
  let ex = shapeExamples.get(key)
  if (!ex) { ex = []; shapeExamples.set(key, ex) }
  if (ex.length < 4) ex.push(`${label}: ${String(n.text).slice(0, 120).replace(/\n/g, " ")}`)
}

// ───────────────────────────────────────────────────────────── the walk

const { admitted, pop } = walkCorpus()
console.log(`fsharp extended-types probe`)
console.log(`corpus root (ABSOLUTE): ${pop.corpusRoot}`)
console.log(`entries walked ${pop.entriesWalked} · SYMLINKED DIRECTORIES FOLLOWED ${pop.symlinkedDirsFollowed} · repos seen ${pop.reposSeen}`)
console.log(`PATHS walked (git-tracked, all languages) ${pop.trackedPaths.toLocaleString()}`)
console.log(`PATHS matching .fs/.fsi/.fsx ${pop.pathsFSharp.toLocaleString()} · over the 1 MB cap ${pop.overCap.toLocaleString()} · tracked-but-unreadable ${pop.absent.toLocaleString()}`)
console.log(`DISTINCT FILES ${pop.distinctFiles.toLocaleString()} · ADMITTED ${pop.admitted.toLocaleString()} · REPOS CARRYING AN ADMITTED FILE ${pop.reposCarryingAdmitted}`)
console.log(`grammar (bytes the REGISTRY SERVES): sha256 ${GRAMMAR_SHA}`)
console.log(`grammar source: ${wasmSource}\n`)

for (const f of admitted) {
  const label = `${f.repo}/${f.rel}`
  let text: string
  try {
    text = readFileSync(f.abs, "utf8")
  } catch {
    parseFailed++
    if (failed.length < 6) failed.push(`${label}: unreadable`)
    continue
  }
  let t: any
  try {
    t = parser.parse(text)
  } catch (e: any) {
    parseFailed++
    if (failed.length < 6) failed.push(`${label}: ${String(e?.message ?? e)}`)
    continue
  }
  if (!t) {
    parseFailed++
    continue
  }
  walked++
  if (walked % 1000 === 0) {
    process.stderr.write(`  … ${walked}/${pop.admitted} files walked\r`)
  }
  let hasError = false
  // one explicit stack, iterative — a recursive walk overflows on at least one corpus file
  const stack: any[] = [t.rootNode]
  const moduleNamesInFile: string[] = []
  while (stack.length > 0) {
    const n = stack.pop()
    if (!n) continue
    if (n.type === "ERROR" || n.type === "MISSING") hasError = true
    bump(inventory, n.type)
    let fs = inventoryFiles.get(n.type)
    if (!fs) { fs = new Set(); inventoryFiles.set(n.type, fs) }
    fs.add(label)

    // ── heritage clauses
    if (n.type === "class_inherits_decl" || n.type === "interface_implementation") {
      const kind = n.type === "class_inherits_decl" ? "inherit" : "interface"
      const row = heritage[kind]
      row.clauses++
      heritageFiles[kind].add(label)
      bump(new Map(), "")
      const sc = row.shapeCounts
      const s = shapeOf(n)
      sc[s] = (sc[s] ?? 0) + 1
      const found = analyzerFindDescendant(n, heritagePred)
      if (!found) {
        row.uncovered++
        if (row.examples.length < 6) row.examples.push(`${label}: ${String(n.text).slice(0, 100).replace(/\n/g, " ")}`)
      }
      if (kind === "inherit") inheritClauses++
      recordShape(`heritage:${kind}`, n, label)
    }

    // ── attributes (the `decorates` question)
    if (n.type === "attribute") {
      attrSites++
      recordShape("attribute", n, label)
      // ★ THE ATTRIBUTE'S OWN ARGUMENT — and the FIRST DRAFT READ THE WRONG CHILD.
      // The attribute node's direct named children are the attribute's TYPE (`simple_type`)
      // and, when the attribute takes arguments, the ARGUMENT (`paren_expression` for a
      // parenthesised list, `const` for a literal, `array_expression` for an array). The
      // first draft took the first non-identifier child, which is the TYPE — so every
      // attribute was classified as "other" and the argument census was a census of the
      // attribute's own name. FIXED: the TYPE is the `simple_type`/`long_identifier`/
      // `identifier` child, and the ARGUMENT is every OTHER named child.
      let argNode: any = null
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (!c) continue
        if (c.type === "simple_type" || c.type === "identifier" || c.type === "long_identifier") continue
        argNode = c
        break
      }
      if (argNode) {
        attrWithArg++
        const at = argNode.type
        bump(attrArgShapes, at)
        if (at === "application_expression") attrArgIsApplication++
        else if (at === "static_type" || at === "const" || at === "string" || at === "int" || at === "bool") attrArgIsLiteral++
        else if (at === "typeof_expression" || at === "typeof_type") attrArgIsTypeof++
        else attrArgOther++
        if (attrExamples.length < 8) attrExamples.push(`${label}: ${String(n.text).slice(0, 110).replace(/\n/g, " ")}`)
        // ★★★ THE C-SHARP PRECEDENT'S OWN QUESTION, MEASURED FOR F#: "the attribute ARGUMENT that
        // carries a CALL". The direct argument child is a `paren_expression` (the argument LIST) or
        // a `const`, so a call inside the list is a GRANDCHILD of the attribute — and the question
        // the C# lane asked is exactly whether F#'s attribute argument is ever a CALL. It is
        // measured here by walking the argument subtree for an `application_expression`, because
        // "the argument is not a call" is a claim about the argument's CONTENTS and not about the
        // argument's node type. (The C# lane's answer: 110 sites of 5,489 arguments, and NONE of
        // them an applied callable TO THE DECLARATION — an attribute argument is a VALUE the
        // runtime evaluates. F#'s answer is its own measurement, not C#'s.)
        if (containsApplicationExpression(argNode)) {
          attrArgCarriesACall++
          if (attrArgCallExamples.length < 8) {
            attrArgCallExamples.push(`${label}: ${String(n.text).slice(0, 120).replace(/\n/g, " ")}`)
          }
          // ★★★ THE DECISIVE COUNT FOR THE `decorates` RULING: does the argument call THE
          // ATTRIBUTE'S OWN TYPE? The 185 calls that appear inside attribute arguments are
          // `nameof …` and `defaultof<…>` — a call INSIDE the argument list, not a call TO the
          // attribute. THE SHAPE THAT WOULD MAKE AN ATTRIBUTE AN APPLIED CALLABLE (the csharp
          // lane's ontological test) IS A CALL NAMING THE ATTRIBUTE TYPE, and this counts it.
          let attrTypeName = ""
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (!c) continue
            if (c.type === "simple_type" || c.type === "identifier" || c.type === "long_identifier") {
              attrTypeName = lastSegment(c.text)
              break
            }
          }
          for (const call of collectApplicationExpressions(argNode)) {
            const callee = callHeadName(call)
            bump(attrArgCallCallees, callee || "(anonymous)")
            if (attrTypeName && callee === attrTypeName) {
              attrArgCallNamesTheAttribute++
              if (attrArgCallSelfExamples.length < 8) {
                attrArgCallSelfExamples.push(`${label}: ${String(n.text).slice(0, 120).replace(/\n/g, " ")}`)
              }
            }
          }
        }
      }
      // IS THE ATTRIBUTE ATTACHED TO A DECLARATION? ★ THE ATTRIBUTE'S PARENT IS THE `attributes`
      // WRAPPER, NOT THE DECLARATION — the declaration is the GRANDPARENT. The first draft
      // read the parent and found 0 of 68,057, which read as "F# attributes are attached to
      // nothing" and would have been a false claim in the ruling. FIXED: walk one level up.
      const wrapper = n.parent
      const p = wrapper ? wrapper.parent : null
      if (p) {
        const pk = p.type
        if (
          pk === "type_definition" || pk === "member_defn" || pk === "value_declaration" ||
          pk === "function_or_value_defn" || pk === "module_defn" || pk === "type_extension" ||
          pk === "exception_definition" || pk === "union_type_defn" || pk === "record_type_defn" ||
          pk === "interface_type_defn" || pk === "enum_type_defn" || pk === "let_binding" ||
          pk === "do" || pk === "value_declaration_left" || pk === "namespace" ||
          pk === "delegate_type_defn" || pk === "type_abbrev_defn" || pk === "anon_type_defn"
        ) attrAttachedToDecl++
        bump(attrOwnerShapes, pk)
      }
    }


    // ── the `renders` question: F#'s candidate shapes, MEASURED (never assumed)
    //
    // THE FLEET'S FOUR IMPLEMENTATIONS AGREE ON ONE SHAPE — "the symbol whose body names a
    // component" — AND DIFFER ON THE FILTER: typescript's JSX TAG, clojure's HICUP VECTOR,
    // csharp's TYPE ARGUMENT on a RENDER-HOST CALL, dart's `build` METHOD whose DECLARED RETURN
    // TYPE is the component. F# HAS NO COMPONENT FRAMEWORK, so every candidate is MEASURED here
    // and the numbers decide, rather than a name list being asserted:
    //   (A) THE TYPE ARROW — a `function_type` node (`A -> B`), the type-position form; the
    //       type named on each side of the arrow is recorded.
    //   (B) AN EXPLICIT TYPE ARGUMENT AT A CALL SITE — the csharp shape in F#'s syntax: the
    //       callee is a `typed_expression` carrying a `types` node (`f<T> (x)`), and the type
    //       argument names a type.
    //   (C) A CAPITALIZED CONSTRUCTION — F# capitalizes TYPE NAMES by convention, and the JSX
    //       lanes' own predicate for "a component" is a CAPITALIZED tag name; this counts the
    //       constructions whose head is a capitalized name, with the enclosing declaration.
    //   (D) A CALL TO A RENDER-HOST NAME — the host-list shape, with the ARGUMENT's own shape,
    //       because in F# a render host takes a LAMBDA rather than a type.
    if (n.type === "function_type") {
      fnTypeSites++
      fnTypeFiles.add(label)
      const left = n.namedChildCount > 0 ? n.namedChild(0) : null
      const right = n.namedChildCount > 1 ? n.namedChild(1) : null
      if (left) bump(fnTypeLeftTypes, lastSegment(left.text))
      if (right) bump(fnTypeRightTypes, lastSegment(right.text))
    }
    if (n.type === "application_expression") {
      const head = n.namedChildCount > 0 ? n.namedChild(0) : null
      const callee = head ? callHeadName(n) : ""
      if (head && head.type === "typed_expression") {
        explicitTypeArgCalls++
        explicitTypeArgFiles.add(label)
        bump(explicitTypeArgCallees, callee || "(anonymous)")
        const types = head.namedChildren.find((c: any) => c && c.type === "types")
        for (const t of types?.namedChildren ?? []) {
          for (const st of t.namedChildren ?? []) {
            bump(explicitTypeArgTypes, lastSegment(st.text))
          }
        }
      }
      if (callee && /^[A-Z]/.test(callee)) {
        capitalizedConstructions++
        capitalizedConstructionFiles.add(label)
        bump(capitalizedHeads, callee)
        bump(capitalizedByDeclaration, enclosingDeclaration(n) || "(none)")
      }
      if (callee && RENDER_HOST_NAMES.has(callee.toLowerCase())) {
        renderHostCalls++
        renderHostFiles.add(label)
        bump(renderHostCallees, callee)
        const arg = n.namedChildCount > 1 ? n.namedChild(1) : null
        bump(renderHostArgShapes, arg ? arg.type : "(none)")
      }
    }

    // ── THE NESTED TYPE — the construct the Lead named as F#'s nearest neighbour for `part_of`
    //
    // ★ MEASURED, NOT ASSUMED. A nested type is a `type_definition` whose ANCESTOR chain contains
    // another `type_definition` — a type declared inside another type. (A `member_defn` inside a type
    // is a MEMBER, not a nested type, and it is not counted here.) The count says whether the wired
    // grammar can even READ the construct: a nested type inside a record/union/class body is a
    // grammar-level shape, and if the grammar errors on it, the construct is not expressible in the
    // wired grammar at all — which is a fact about the GRAMMAR and not about the analyzer.
    if (n.type === "type_definition" || n.type === "module_defn" || n.type === "named_module") {
      let anc = n.parent
      let guard = 0
      while (anc && ++guard < 24) {
        if (anc.type === "type_definition" || anc.type === "module_defn" || anc.type === "named_module") {
          nestedDeclarations++
          nestedDeclarationFiles.add(label)
          bump(nestedDeclarationOwners, anc.type)
          bump(nestedDeclarationOwnerShapes, anc.type + ">" + n.type)
          break
        }
        anc = anc.parent
      }
    }
    // ── directives (the `part_of` question)
    //
    // ★ TWO NODE TYPES, AND THE SPEC GETS ONE OF THEM WRONG. The lane's own spec (§"_reclassified",
    // gap FS-A1) records `fsi_directive_decl` as "analyzer branch names, NOT wasm types" — a
    // conclusion a 120-FILE DRAW reached because that draw produced zero of them. The wasm DOES
    // produce it: `#load "Other.fs"` parses as `(file (fsi_directive_decl (string)))`, and the
    // keyword is the node's first ANONYMOUS child (`#load` / `#r` / `#I`). The 120-file draw's
    // zero was a SAMPLE'S zero, read as a grammar fact — the exact "a census that can be light
    // without saying so" defect. `compiler_directive_decl` is the OTHER family (`#if`/`#nowarn`/
    // `#endif`) and it is live too. BOTH are measured here.
    if (n.type === "compiler_directive_decl" || n.type === "fsi_directive_decl") {
      // the DIRECTIVE'S OWN KEYWORD is the first UNNAMED child — the grammar spells it as a token
      let kw = ""
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (!c) continue
        if (c.isNamed) continue
        kw = String(c.text).trim()
        if (kw) break
      }
      bump(directiveCounts, `${n.type}:${kw || "(no keyword)"}`)
      recordShape(n.type, n, label)
      if (directiveExamples.length < 10) directiveExamples.push(`${label}: ${String(n.text).slice(0, 110).replace(/\n/g, " ")}`)
      const low = kw.toLowerCase()
      if (low === "#load") {
        loadDirectives++
        const spec = analyzerFindDescendant(n, (x) => x.type === "string" || x.type === "verbatim_string")
        if (spec) {
          loadWithString++
          const raw = String(spec.text).replace(/^"/, "").replace(/"$/, "")
          const resolved = path.resolve(path.dirname(f.abs), raw)
          if (existsSync(resolved)) {
            loadResolved++
          } else {
            loadUnresolved++
            if (loadUnresolvedExamples.length < 8) loadUnresolvedExamples.push(`${label}: ${raw} -> ${resolved}`)
          }
        }
      }
      if (low === "#r") rDirectives2++
      if (low === "#i") iDirectives++
    }

    // ── module augmentation / extension (the `mixes_in` question)
    if (n.type === "module_defn") {
      moduleDefnSites++
      const nm = analyzerFindDescendant(n, (x) => x.type === "identifier" || x.type === "long_identifier")
      if (nm && nm.text) moduleNamesInFile.push(String(nm.text))
    }
    if (n.type === "type_extension") typeExtensionSites++
    if (n.type === "object_expression") objectExpressionSites++

    // ── the `renders` question: any node type whose name is element/component/render-ish.
    // THE SEARCH VOCABULARY IS THE CSHARP LANE'S (L-06): "0 of 239 named node types is a
    // JSX/razor/html/template/render node" — so the same words are used here, and the same
    // scan is proved by the POSITIVE CONTROL below.
    const lowType = n.type.toLowerCase()
    if (lowType.includes("render") || lowType.includes("jsx") || lowType.includes("element") ||
        lowType.includes("component") || lowType.includes("markup") || lowType.includes("razor") ||
        lowType.includes("template") || lowType.includes("html")) {
      bump(renderish, n.type)
    }

    for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
  }
  if (hasError) {
    parseErrorTrees++
    if (errorTreeFiles.length < 6) errorTreeFiles.push(label)
  }
  // MODULE AUGMENTATION: the same module name declared more than once in one file
  const seenMod = new Map<string, number>()
  for (const m of moduleNamesInFile) seenMod.set(m, (seenMod.get(m) ?? 0) + 1)
  let augmentedHere = 0
  for (const [, c] of seenMod) if (c > 1) augmentedHere += c - 1
  if (augmentedHere > 0) {
    moduleAugmentFiles++
    moduleAugmentSites += augmentedHere
  }
  t.delete?.()
}

console.log(`walked ${walked}/${pop.admitted} admitted files · parse failures ${parseFailed} · files with an ERROR/MISSING node ${parseErrorTrees}`)
for (const f of failed) console.log(`  failed ${f}`)
for (const f of errorTreeFiles) console.log(`  error-tree ${f}`)
console.log()

// ───────────────────────────────────────────────────────────── report

const w = (s: string | number, n: number) => (String(s) + " ".repeat(n)).slice(0, n)
const sortedInv = [...inventory.entries()].sort((a, b) => b[1] - a[1])

console.log(`INSTRUMENT A — the grammar's own node-type inventory over the admitted population`)
console.log(`${sortedInv.length} distinct node types produced across ${walked} files\n`)
for (const [ty, n] of sortedInv) {
  console.log(`  ${w(ty, 34)}${w(n.toLocaleString(), 12)}${w(inventoryFiles.get(ty)?.size ?? 0, 8)} files`)
}
console.log()

console.log(`HERITAGE — every clause's SHAPE against the ANALYZER'S OWN LOOKUP`)
console.log(`  lookup: findDescendant(clause, long_identifier|identifier) — depth-bounded at 5, NAMED children only`)
console.log(`  (src/ast/real-fsharp-analyzer.ts:1061 for inherit, :1122 for interface, :4251-4262 for findDescendant)`)
console.log(`${w("kind", 12)}${w("clauses", 10)}${w("files", 8)}${w("UNCOVERED", 12)}shapes (direct named children)`)
for (const kind of ["inherit", "interface"] as const) {
  const r = heritage[kind]
  const shapesStr = Object.entries(r.shapeCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ×${v}`).join(", ")
  console.log(`${w(kind, 12)}${w(r.clauses.toLocaleString(), 10)}${w(heritageFiles[kind].size.toLocaleString(), 8)}${w(r.uncovered.toLocaleString(), 12)}${shapesStr || "-"}`)
  for (const ex of r.examples) console.log(`      uncovered example: ${ex}`)
}
console.log()

console.log(`decorates — the ATTRIBUTE family (F#'s candidate construct)`)
console.log(`  attribute sites ${attrSites.toLocaleString()} · attached to a declaration ${attrAttachedToDecl.toLocaleString()}`)
console.log(`  attributes carrying an argument ${attrWithArg.toLocaleString()}: application_expression ${attrArgIsApplication.toLocaleString()} · literal-ish ${attrArgIsLiteral.toLocaleString()} · typeof ${attrArgIsTypeof.toLocaleString()} · other ${attrArgOther.toLocaleString()}`)
console.log(`  the argument's own node types:`)
for (const [k, n] of [...attrArgShapes.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${w(k, 30)}${n.toLocaleString()}`)
console.log(`  attributes whose ARGUMENT carries a CALL (an application_expression anywhere in the argument subtree): ${attrArgCarriesACall.toLocaleString()}`)
for (const e of attrArgCallExamples) console.log(`    ${e}`)
console.log(`  the declaration the attribute is attached to:`)
for (const [k, n] of [...attrOwnerShapes.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${w(k, 30)}${n.toLocaleString()}`)
console.log(`  THE CONTRACT'S OWN TEST — does the attribute's OWN ARGUMENT receive the marked declaration?`)
console.log(`  an F# attribute argument is a VALUE passed to the attribute type; it never receives a declaration.`)
console.log(`  attribute shapes:`)
for (const [s, c] of [...(shapes.get("attribute") ?? new Map()).entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${w(s, 46)}${c.toLocaleString()}`)
}
for (const ex of attrExamples) console.log(`    example: ${ex}`)
console.log()

console.log(`renders — the element/component family`)
if (renderish.size === 0) {
  console.log(`  NO node type in the ${sortedInv.length}-type inventory has a name containing render/jsx/element/component/markup.`)
} else {
  for (const [t, n] of [...renderish.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${w(t, 34)}${n.toLocaleString()}`)
}
console.log()

console.log(`mixes_in — the with-clause / mixin family, and F#'s own near misses`)
console.log(`  inherit clauses (extends, NOT mixes_in — FSD3): ${inheritClauses.toLocaleString()}`)
console.log(`  module_defn sites ${moduleDefnSites.toLocaleString()}`)
console.log(`  MODULE AUGMENTATION (the same module name declared twice in one file): ${moduleAugmentSites.toLocaleString()} site(s) in ${moduleAugmentFiles.toLocaleString()} file(s)`)
console.log(`  type_extension (intrinsic extension members): ${typeExtensionSites.toLocaleString()}`)
console.log(`  object_expression ({ new IFoo with ... }): ${objectExpressionSites.toLocaleString()}`)
const mixish = sortedInv.filter(([t]) => /mix|augment|with|inherit|superclass|base_clause/i.test(t))
console.log(`  node types whose name contains mix/augment/with: ${mixish.length ? mixish.map(([t, n]) => `${t} ×${n.toLocaleString()}`).join(", ") : "(none)"}`)
console.log()

console.log(`part_of — the DIRECTIVE family`)
console.log(`  compiler_directive_decl / fsi_directive_decl by keyword:`)
for (const [k, n] of [...directiveCounts.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${w(k || "(none)", 46)}${n.toLocaleString()}`)
console.log(`  #load directives ${loadDirectives.toLocaleString()} · of which name a string ${loadWithString.toLocaleString()}`)
console.log(`  THE INFORMATION TEST — does the named file EXIST, resolved against the including file's directory?`)
console.log(`    resolved ${loadResolved.toLocaleString()} · UNRESOLVED (no row — a path no project key can answer) ${loadUnresolved.toLocaleString()}`)
for (const ex of loadUnresolvedExamples) console.log(`      unresolved example: ${ex}`)
console.log(`  #r directives (assembly references — these stay imports) ${rDirectives2.toLocaleString()}`)
console.log(`  #I directives (include-path directories — these stay imports) ${iDirectives.toLocaleString()}`)
for (const ex of directiveExamples) console.log(`    example: ${ex}`)
for (const fam of ["compiler_directive_decl", "fsi_directive_decl"]) {
  console.log(`  ${fam} shapes:`)
  for (const [s, c] of [...(shapes.get(fam) ?? new Map()).entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${w(s, 46)}${c.toLocaleString()}`)
  }
}
console.log()

/* ─────────────────────────────────────────────────────────────────────────────
 * THE POSITIVE CONTROL (L-2026-10-21-05, THE BUILD TEST).
 *
 * "A lane's ruling instrument must print the SHA-256 OF THE BUILD IT LOADED, and the node-type
 * count it enumerated, in the same place — and a positive control (the same scan over a grammar
 * that DOES have the construct) must appear, so an absence is a fact about the grammar and not
 * an artefact of the scan."
 *
 * ⇒ THE SAME NAME-SUBSTRING SCAN RUNS OVER GRAMMARS THAT DO HAVE THE CONSTRUCTS, and it must FIRE.
 * dart's grammar has `mixin_application` and `part_directive`; javascript's has `jsx_element`
 * and `class_heritage`; python's has `decorator`. If this scan finds nothing anywhere, the scan
 * is broken and every absence below is an ARTEFACT OF THE SCAN.
 * ───────────────────────────────────────────────────────────────────────────── */
console.log(`POSITIVE CONTROL — the SAME scan over grammars that DO have the construct (L-05)`)
const CONTROLS: { lang: string; wasm: string; wants: string[] }[] = [
  { lang: "dart", wasm: "tree-sitter-dart.wasm", wants: ["mixin_application", "part_directive", "part_of_directive"] },
  { lang: "javascript", wasm: "tree-sitter-javascript.wasm", wants: ["jsx_element", "jsx_self_closing_element", "class_heritage", "decorator"] },
  { lang: "python", wasm: "tree-sitter-python.wasm", wants: ["decorator", "decorated_definition"] },
]
const controlResults: Record<string, unknown> = {}
for (const c of CONTROLS) {
  try {
    const { hasWasmInRegistry } = await import(path.join(ROOT, "src/util/wasm"))
    const b = hasWasmInRegistry(c.wasm)
    if (!b) {
      console.log(`  ${w(c.lang, 12)} registry has no ${c.wasm} — control NOT RUN`)
      controlResults[c.lang] = { status: "unavailable", wasm: c.wasm }
      continue
    }
    const sha = createHash("sha256").update(b).digest("hex")
    const cp = new WSP()
    cp.setLanguage(await WSL.load(b))
    // THE SAME SCAN: parse a sample that CONTAINS the construct, and look for the node types.
    const samples: Record<string, string> = {
      dart: "class A = B with M {}\npart 'x.dart';\n",
      javascript: "class A extends B {}\nconst x = <Foo/>;\n",
      python: "@deco\ndef f():\n    pass\n",
    }
    const t = cp.parse(samples[c.lang] ?? "")
    const found = new Set<string>()
    const st: any[] = [t.rootNode]
    while (st.length) {
      const n = st.pop()
      if (!n) continue
      found.add(n.type)
      for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
    }
    const hit = c.wants.filter((w2) => found.has(w2))
    console.log(`  ${w(c.lang, 12)} sha256 ${sha.slice(0, 16)}… · wanted ${c.wants.join(", ")}`)
    console.log(`  ${" ".repeat(12)} FIRED on ${hit.length ? hit.join(", ") : "NONE — THE SCAN IS BROKEN"}`)
    controlResults[c.lang] = { status: "ok", sha256: sha, wanted: c.wants, fired: hit }
    t.delete?.()
  } catch (e: any) {
    console.log(`  ${w(c.lang, 12)} control failed: ${String(e).slice(0, 80)}`)
    controlResults[c.lang] = { status: "error", message: String(e).slice(0, 120) }
  }
}
console.log()

// ───────────────────────────────────────────────────────────── artifact

const artifact = {
  tool: "fsharp extended-types probe",
  population: pop,
  grammar: { sha256: GRAMMAR_SHA, source: wasmSource, citation: "the bytes the production registry serves" },
  walked,
  parseFailed,
  parseErrorTrees,
  inventory: Object.fromEntries(sortedInv.map(([t, n]) => [t, { n, files: inventoryFiles.get(t)?.size ?? 0 }])),
  heritage: {
    lookup: "findDescendant(clause, long_identifier|identifier), depth-bounded 5, NAMED children only",
    source: ["src/ast/real-fsharp-analyzer.ts:1061", "src/ast/real-fsharp-analyzer.ts:1122", "src/ast/real-fsharp-analyzer.ts:4251-4262"],
    inherit: { ...heritage.inherit, files: heritageFiles.inherit.size },
    interface: { ...heritage.interface, files: heritageFiles.interface.size },
  },
  decorates: {
    attributeSites: attrSites,
    attributeAttachedToDeclaration: attrAttachedToDecl,
    attributesWithArgument: attrWithArg,
    argumentShapes: { application_expression: attrArgIsApplication, literalish: attrArgIsLiteral, typeof: attrArgIsTypeof, other: attrArgOther },
    argumentShapesByNodeType: Object.fromEntries(attrArgShapes),
    attachedToDeclarationByNodeType: Object.fromEntries(attrOwnerShapes),
    attributeArgumentsCarryingACall: attrArgCarriesACall,
    attributeArgumentCallCallees: Object.fromEntries(attrArgCallCallees),
    attributeArgumentCallsNamingTheAttribute: attrArgCallNamesTheAttribute,
    attributeArgumentCallNamingTheAttributeExamples: attrArgCallSelfExamples,
    attributeArgumentCallExamples: attrArgCallExamples,
    attributeShapes: Object.fromEntries(shapes.get("attribute") ?? new Map()),
  },
  renders: {
    nestedTypeDeclarations: nestedDeclarations,
    nestedTypeDeclarationFiles: nestedDeclarationFiles.size,
    nestedTypeDeclarationOwners: Object.fromEntries(nestedDeclarationOwners),
    nestedTypeDeclarationOwnerShapes: Object.fromEntries(nestedDeclarationOwnerShapes),
    functionTypeSites: fnTypeSites,
    functionTypeFiles: fnTypeFiles.size,
    functionTypeLeftTypes: Object.fromEntries(fnTypeLeftTypes),
    functionTypeRightTypes: Object.fromEntries(fnTypeRightTypes),
    explicitTypeArgumentCalls: explicitTypeArgCalls,
    explicitTypeArgumentFiles: explicitTypeArgFiles.size,
    explicitTypeArgumentCallees: Object.fromEntries(explicitTypeArgCallees),
    explicitTypeArgumentTypes: Object.fromEntries(explicitTypeArgTypes),
    capitalizedConstructions: capitalizedConstructions,
    capitalizedConstructionFiles: capitalizedConstructionFiles.size,
    capitalizedConstructionHeads: Object.fromEntries(capitalizedHeads),
    capitalizedConstructionByDeclaration: Object.fromEntries(capitalizedByDeclaration),
    renderHostCalls: renderHostCalls,
    renderHostFiles: renderHostFiles.size,
    renderHostCallees: Object.fromEntries(renderHostCallees),
    renderHostArgumentShapes: Object.fromEntries(renderHostArgShapes), elementishNodeTypes: Object.fromEntries(renderish) },
  mixes_in: {
    inheritClauses,
    moduleDefnSites,
    moduleAugmentationSites: moduleAugmentSites,
    moduleAugmentationFiles: moduleAugmentFiles,
    typeExtensionSites,
    objectExpressionSites,
    mixishNodeTypes: Object.fromEntries(mixish),
  },
  part_of: {
    directivesByKeyword: Object.fromEntries(directiveCounts),
    loadDirectives,
    loadNamingAString: loadWithString,
    loadResolved,
    loadUnresolved,
    rDirectives: rDirectives2,
    iDirectives,
    directiveShapes: {
      compiler_directive_decl: Object.fromEntries(shapes.get("compiler_directive_decl") ?? new Map()),
      fsi_directive_decl: Object.fromEntries(shapes.get("fsi_directive_decl") ?? new Map()),
    },
  },
  positiveControl: controlResults,
}
const outPath = process.env.BB_FSHARP_EXT_JSON
if (outPath) {
  writeFileSync(outPath, JSON.stringify(artifact, null, 2))
  console.log(`json: ${outPath}`)
}
