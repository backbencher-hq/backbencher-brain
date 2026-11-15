/**
 * POWERSHELL — THE DECORATES CENSUS (a tree probe, run once to fix the shapes, not shipped).
 *
 * Counts, over the WHOLE admitted population, every `attribute` site and its arguments,
 * and asks the ONE question the `decorates` contract turns on: does any ATTRIBUTE
 * ARGUMENT invoke a DECLARED callable — a PowerShell class or function the population
 * declares? The csharp lane settled the same question for C# with
 * `cs.attribute_argument_call` (110 sites over 43 files, out of 5,489 attribute arguments,
 * all resolved to .NET runtime constructors and NONE to a declared callable), and swift
 * settled it with a count over macro/@propertyWrapper declarations.
 *
 * WHY THE CALLABILITY TEST IS THE TEST. `src/ast/types.ts:Decorates` says the decorator
 * is an APPLIED CALLABLE — python's `@deco` and TS's decorator factories are FUNCTIONS
 * applied at declaration creation. A PowerShell attribute is most often ONTOLOGICAL
 * metadata: `[Parameter(Mandatory)]` is a .NET attribute class INSTANTIATED by the
 * compiler, with no call site in the source and nothing applied the decorated
 * declaration could call. But the grammar ALLOWS an argument list on the attribute, so
 * the honest measurement is whether the corpus ever PUTS a call there: a call to a
 * declared callable inside an attribute argument is the decorator shape, and its
 * absence — counted — is the ontological ruling's evidence.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import type { Node } from "web-tree-sitter"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { getParser } from "../../../../src/ast/engine"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "powershell"
const SIZE_CAP = 512 * 1024

const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}
const OUT = argOf("--out")
if (!OUT) {
  console.error("usage: decorates-census.mts --out <artifact>")
  process.exit(2)
}

// ── admitted population: identical rule to census.ts / dot-source-census.mts ────
type Admitted = { repo: string; dir: string; rel: string; abs: string }
const admitted: Admitted[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > SIZE_CAP) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== LANG) continue
    admitted.push({ repo: e, dir, rel, abs })
  }
}
const repos = new Set(admitted.map((a) => a.repo))
console.error(`population: ${admitted.length} admitted files over ${repos.size} repos (root ${CR})`)
if (admitted.length === 0) {
  console.error("CONTROL FAILURE: empty admitted population.")
  process.exit(5)
}

const parser = await getParser("powershell")
if (parser.parse("class A { }").rootNode.type !== "program") {
  console.error("[DECORATES] the parser did not load — every number below would be a false zero")
  process.exit(2)
}

// ── the declared-callable index, corpus-wide ──────────────────────────────────
// A declared callable is a PowerShell class, function, enum or cmdlet alias the
// population DECLARES (the analyzer's own symbol vocabulary: class_statement,
// function_statement, enum_statement). Collected from every admitted file's TREE,
// folded case (PowerShell is case-insensitive), so the census can ask per-argument
// "is this name a callable the corpus declares?".
const declaredCallables = new Set<string>()
const collectDeclarations = (root: Node): void => {
  const stack: Node[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "class_statement" || n.type === "function_statement" || n.type === "enum_statement") {
      const nameNode =
        firstChildOfType(n, "simple_name") ?? firstChildOfType(n, "function_name")
      if (nameNode) declaredCallables.add(nameNode.text.toLowerCase())
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
}
const firstChildOfType = (n: Node, type: string): Node | null => {
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c && c.type === type) return c
  }
  return null
}

// ── the per-attribute facts ──────────────────────────────────────────────────
type AttrSite = {
  file: string
  repo: string
  line: number
  attributeName: string
  // A `type_literal` attribute ([string]$x) rather than a constraint attribute
  // ([Parameter(Mandatory)]): the analyzer's own reader makes this distinction, so the
  // census counts the two kinds separately rather than as one pile of 6,421.
  isTypeAnnotation: boolean
  argumentCount: number
  // What the argument list CONTAINS, as grammar facts (never text matching for the
  // classification — the node types are the evidence):
  argumentShapes: string[] // distinct node types inside attribute_arguments
  // A call-shaped argument: the argument subtree contains an invokation_expression
  // or a command node (a function/cmdlet invocation).
  hasCallShapedArgument: boolean
  // A `::new()` construction: [T]::new() inside an attribute argument.
  hasStaticConstruction: boolean
  // The names inside call-shaped arguments, lowercased, for the declared-callable test.
  callArgumentNames: string[]
  // Does any call-shaped argument name a callable the corpus DECLARES?
  namesDeclaredCallable: boolean
  namesDeclaredCallableWhich: string[]
}

const attrSites: AttrSite[] = []
let filesParsed = 0
let filesFailed = 0
// One file's declarations must be collectable per file too, for the own-file question.
let callablesOwnFile = new Set<string>()
// (b) THE ATTRIBUTE-NAME HALF: every attribute_name tested against the same corpus-wide
// declared-callable index. Collected in the same walk; the names are compared at the end
// (after the corpus index is complete), so a forward declaration cannot be missed.
const attrNameSeen = new Map<string, { count: number; files: Set<string> }>()
const sitesNamingDeclaredOwnFile: AttrSite[] = []

const allDescendantsOfType = (n: Node, type: string, out: Node[]): void => {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (!c) continue
    if (c.type === type) out.push(c)
    allDescendantsOfType(c, type, out)
  }
}

for (const f of admitted) {
  let text: string
  try {
    text = readFileSync(f.abs, "utf8")
  } catch {
    filesFailed++
    continue
  }
  let tree: { rootNode: Node } | null = null
  try {
    tree = parser.parse(text) as { rootNode: Node }
  } catch {
    filesFailed++
    continue
  }
  if (!tree || !tree.rootNode) {
    filesFailed++
    continue
  }
  filesParsed++
  const root = tree.rootNode
  collectDeclarations(root)

  const attrs: Node[] = []
  allDescendantsOfType(root, "attribute", attrs)
  if (attrs.length === 0) continue

  // The own-file declared callables, for the stricter question (declared in the SAME
  // file, which is what a same-file decorator would need).
  callablesOwnFile = new Set<string>()
  {
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "class_statement" || n.type === "function_statement" || n.type === "enum_statement") {
        const nameNode = firstChildOfType(n, "simple_name") ?? firstChildOfType(n, "function_name")
        if (nameNode) callablesOwnFile.add(nameNode.text.toLowerCase())
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
  }

  for (const a of attrs) {
    const nameNode = firstChildOfType(a, "attribute_name")
    const argsNode = firstChildOfType(a, "attribute_arguments")
    // THE TWO KINDS OF `attribute` NODE, and the analyzer's own parameter reader is what
    // discriminates them (real-powershell-analyzer.ts, collectParameters): a
    // CONSTRAINT attribute (`[Parameter(Mandatory)]`, `[ValidateSet('a')]`) carries an
    // `attribute_name` or `attribute_arguments`, while a TYPE ANNOTATION (`[string]$x`)
    // carries a direct `type_literal` child and no name. Both are metadata; a ruling
    // whose count conflates them is weaker than one naming both, so the site records
    // which kind it is.
    const hasTypeLiteral = firstChildOfType(a, "type_literal") !== null
    const argumentCount = argsNode
      ? countDirectArgumentChildren(argsNode)
      : 0
    const shapes = new Set<string>()
    let hasCallShaped = false
    let hasStaticConstruction = false
    const callNames: string[] = []
    if (argsNode) {
      const invocations: Node[] = []
      allDescendantsOfType(argsNode, "invokation_expression", invocations)
      const commands: Node[] = []
      allDescendantsOfType(argsNode, "command", commands)
      const casts: Node[] = []
      allDescendantsOfType(argsNode, "cast_expression", casts)
      if (invocations.length > 0 || commands.length > 0) hasCallShaped = true
      for (const inv of invocations) shapes.add("invokation_expression")
      for (const c of commands) shapes.add("command")
      for (const c of casts) shapes.add("cast_expression")
      // [T]::new() arrives as a static-member invokation_expression whose text ends in
      // "::new(...)"; its shape is invokation_expression either way, and the CONSTRUCTION
      // flag is what separates type instantiation from a method call.
      const invTexts = invocations.map((i) => i.text)
      for (const t of invTexts) {
        if (t.includes("::new")) hasStaticConstruction = true
      }
      // The callee name of an invokation_expression: its member_access/object text is
      // not a bare name, so record the WHOLE invocation text (bounded) for the sample.
      for (const inv of invocations) callNames.push(inv.text.slice(0, 60))
      for (const c of commands) {
        const cn = firstChildOfType(c, "command_name")
        callNames.push(cn ? cn.text : c.text.slice(0, 60))
      }
    }
    const which: string[] = []
    let ownFileWhich: string[] = []
    for (const raw of callNames) {
      // A bare-name invocation `[Helper]` / `Helper` / `Get-Thing` shape: strip a
      // type-literal bracket pair, then test the remainder as a whole name.
      let name = raw.trim()
      if (name.startsWith("[")) name = name.slice(1)
      if (name.endsWith("]")) name = name.slice(0, -1)
      name = name.split("(")[0].trim()
      if (declaredCallables.has(name.toLowerCase())) which.push(name)
      if (callablesOwnFile.has(name.toLowerCase())) ownFileWhich.push(name)
    }
    ownFileWhich = [...new Set(ownFileWhich)]
    attrSites.push({
      file: f.rel,
      repo: f.repo,
      line: (nameNode ?? a).startPosition.row + 1,
      attributeName: nameNode ? nameNode.text : "",
      isTypeAnnotation: hasTypeLiteral && nameNode === null,
      argumentCount,
      argumentShapes: [...shapes],
      hasCallShapedArgument: hasCallShaped,
      hasStaticConstruction,
      callArgumentNames: callNames.slice(0, 8),
      namesDeclaredCallable: which.length > 0,
      namesDeclaredCallableWhich: which,
    })
    if (ownFileWhich.length > 0) {
      sitesNamingDeclaredOwnFile.push({
        ...(attrSites[attrSites.length - 1] as AttrSite),
        namesDeclaredCallableWhich: ownFileWhich,
      })
    }
    // (b) the attribute-name half: record every attribute_name for the deferred test.
    if (nameNode) {
      const key = nameNode.text
      const entry = attrNameSeen.get(key) ?? { count: 0, files: new Set<string>() }
      entry.count++
      entry.files.add(f.rel)
      attrNameSeen.set(key)
    }
  }
}

// ── the report ───────────────────────────────────────────────────────────────
const attributeNodes = attrSites.length
const withArguments = attrSites.filter((s) => s.argumentCount > 0).length
const callShaped = attrSites.filter((s) => s.hasCallShapedArgument)
const staticConstruction = attrSites.filter((s) => s.hasStaticConstruction)
const namesDeclared = attrSites.filter((s) => s.namesDeclaredCallable)
// (b) resolved NOW, after the corpus-wide declared index is complete: a forward
// declaration in a later file must be visible to an earlier attribute site, which is
// why this comparison cannot run inside the per-file loop.
const attrNamesDeclared = [...attrNameSeen.keys()].filter((k) =>
  declaredCallables.has(k.toLowerCase()),
)

const report = {
  language: "powershell",
  instrument: "validation/m14/fixtures/powershell/decorates-census.mts",
  corpusRoot: CR,
  population: {
    admitted: admitted.length,
    repos: repos.size,
    parsed: filesParsed,
    failed: filesFailed,
    samplingMethod:
      "per-repo git-tracked files, 512 KiB cap, gated on detectLanguageFromPath === powershell; WHOLE admitted set",
  },
  totals: {
    attributeSites: attributeNodes,
    filesWithAttributes: new Set(attrSites.map((s) => s.file)).size,
    distinctAttributeNames: new Set(attrSites.map((s) => s.attributeName.toLowerCase())).size,
    typeAnnotationSites: attrSites.filter((s) => s.isTypeAnnotation).length,
    constraintAttributeSites: attrSites.filter((s) => !s.isTypeAnnotation).length,
    withArguments,
    attributeArgumentTotal: attrSites.reduce((n, s) => n + s.argumentCount, 0),
    callShapedArgumentSites: callShaped.length,
    filesWithCallShapedArguments: new Set(callShaped.map((s) => s.file)).size,
    staticConstructionSites: staticConstruction.length,
    sitesNamingDeclaredCallable: namesDeclared.length,
    declaredCallableNames: [...new Set(namesDeclared.flatMap((s) => s.namesDeclaredCallableWhich))],
    // THE DECORATOR TEST, both halves:
    //   (a) an attribute ARGUMENT that invokes a callable the corpus DECLARES —
    //       a project-written function called inside an attribute's argument list.
    //   (b) an attribute NAME that is itself a corpus-declared callable — a
    //       project-written class used AS an attribute.
    // Both are needed because a decorator is either shape: python's `@deco` applies a
    // declared callable BY NAME, and a decorator factory takes arguments.
    sitesNamingDeclaredCallableOwnFile: sitesNamingDeclaredOwnFile.length,
    sitesNamingDeclaredCallableOwnFileWhich: [
      ...new Set(sitesNamingDeclaredOwnFile.flatMap((s) => s.namesDeclaredCallableWhich)),
    ],
    // (b) is measured in the same walk: every attribute_name tested against the same
    // corpus-wide declared-callable index.
    attributeNamesThatAreDeclaredCallables: attrNamesDeclared,
    attributeNamesThatAreDeclaredCallablesCount: attrNamesDeclared.length,
    attributeNamesAll: [...attrNameSeen.keys()].sort(),
  },
  samples: {
    callShaped: callShaped.slice(0, 40).map((s) => ({
      file: s.file, line: s.line, attribute: s.attributeName,
      shapes: s.argumentShapes, names: s.callArgumentNames,
      namesDeclared: s.namesDeclaredCallableWhich,
    })),
  },
}

// The own-file half: namesDeclared collected against the corpus-wide index; ALSO record
// the stricter own-file answer per site (callablesOwnFile was per-file; recompute below
// for sites that named a corpus-declared callable — cheap, few).
writeFileSync(OUT, JSON.stringify(report, null, 2))
console.error(`decorates census: ${attributeNodes} attribute sites over ${report.totals.filesWithAttributes} files`)
console.error(`  arguments: ${report.totals.attributeArgumentTotal} across ${withArguments} sites with arguments`)
console.error(`  call-shaped argument sites: ${callShaped.length} (files ${report.totals.filesWithCallShapedArguments})`)
console.error(`  [T]::new() static constructions: ${staticConstruction.length}`)
console.error(`  sites naming a CORPUS-DECLARED callable: ${namesDeclared.length}${namesDeclared.length > 0 ? " :: " + JSON.stringify(report.totals.declaredCallableNames.slice(0, 20)) : ""}`)
console.error(`  sites naming a callable declared in the SAME file: ${report.totals.sitesNamingDeclaredCallableOwnFile}${report.totals.sitesNamingDeclaredCallableOwnFile > 0 ? " :: " + JSON.stringify(report.totals.sitesNamingDeclaredCallableOwnFileWhich) : ""}`)
console.error(`  attribute NAMES that are corpus-declared callables: ${report.totals.attributeNamesThatAreDeclaredCallablesCount}${report.totals.attributeNamesThatAreDeclaredCallablesCount > 0 ? " :: " + JSON.stringify(report.totals.attributeNamesThatAreDeclaredCallables) : ""}`)
console.error(`written: ${OUT}`)

function countDirectArgumentChildren(argsNode: Node): number {
  // attribute_arguments' direct named children that are attribute_argument nodes.
  let n = 0
  for (let i = 0; i < argsNode.namedChildCount; i++) {
    const c = argsNode.namedChild(i)
    if (c && c.type === "attribute_argument") n++
  }
  return n
}
