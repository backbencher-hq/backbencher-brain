/**
 * INCOMING_JAVA — CONSTRUCT PROBE. The instrument a RULED verdict has to be
 * built on, and the instrument that measures Java's genuine reflection.
 *
 * `ontology-coverage-gate.ts` states the choice of instrument precisely, and this
 * file follows it:
 *
 *   A: GRAMMAR INVENTORY — for a type that needs a node type the language does not
 *      have. Enumerating every node type the grammar actually produces is positive
 *      evidence of absence.
 *   B: PARSE-TREE SEMANTIC COUNT — for a type the language CAN express. A second
 *      declaration of a name is perfectly good bash, so no grammar inventory will
 *      find it; it has to be counted on the tree, where a string literal or an
 *      embedded heredoc cannot fake it.
 *
 * Every count here is on the tree. NOTHING is counted by matching source text.
 * That distinction is not pedantry: the ontology gate's first version returned two
 * false positives by regex — a probe for `extends` matched `class voice` inside a
 * telnet IAC word list in a string, and a probe for `instantiates` matched
 * `new Map(` inside a heredoc. Both would have convicted a correct ruling.
 *
 * WHAT IS PROBED
 *
 *   1. The JPMS module declaration (JLS 7.7) — `exports` and `requires` are
 *      LITERAL keywords in Java, not a convention. `exports_module_directive` and
 *      `requires_module_directive` are the constructs behind the `exports` and
 *      `imports` verdicts, and this counts them per file with example sites.
 *   2. Java's REFLECTION, which is the reason the resolver cannot be complete and
 *      the reason this lane refuses to guess targets. Counted by node type and
 *      field, never by text: a `forName` inside a string literal is not a call.
 *   3. The construct behind each of the ten types, so a RULED verdict has a
 *      measurement and an EMITTED one has a denominator.
 *
 * CLI: bun script/incoming-java/probe.ts [--dir java-lib] [--limit N]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const REPO = path.resolve(import.meta.dir, "..", "..")
const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"

function argOf(name: string, dflt: string): string {
  const i = process.argv.indexOf(name)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}
const DIR = argOf("--dir", "java-lib")
const LIMIT = Number(argOf("--limit", "0"))
const JAVA_DIR = path.join(CORPUS, DIR)

// ---------------------------------------------------------------- corpus
function javaFilesTracked(dir: string): string[] {
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { return [] }
  const out: string[] = []
  for (const rel of tracked) {
    if (!rel.endsWith(".java")) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 400_000) continue } catch { continue }
    out.push(abs)
  }
  out.sort()
  return LIMIT > 0 ? out.slice(0, LIMIT) : out
}

const { getParser } = await import(path.join(REPO, "src/ast/engine.ts"))
const parser = await getParser("java")
const files = javaFilesTracked(JAVA_DIR)
if (!files.length) { console.error(`no tracked .java under ${JAVA_DIR}`); process.exit(2) }

// ---------------------------------------------------------------- instruments
type Hit = { file: string; line: number; detail: string }

/** Instrument A: every node type the grammar actually produces across the corpus.
 *  Positive evidence of absence — a type the grammar never spells cannot be a
 *  construct the language expresses. */
const grammarNodeTypes = new Map<string, number>()

/** The ten types, each with the node types that would express it. Read off the
 *  language's own JLS construct names, then verified against what the grammar
 *  produces. A name that never appears in `grammarNodeTypes` is the ruling. */
const CONSTRUCTS: Record<string, { nodeTypes: string[]; describe: string }> = {
  calls: { nodeTypes: ["method_invocation", "explicit_constructor_invocation", "method_reference"], describe: "a call site" },
  uses: { nodeTypes: ["field_access", "array_access"], describe: "a member read" },
  contains: { nodeTypes: ["class_body", "interface_body", "enum_body", "field_declaration", "method_declaration", "constructor_declaration"], describe: "a member declaration" },
  imports: { nodeTypes: ["import_declaration", "requires_module_directive"], describe: "an import declaration, or a module requires clause (JLS 7.7.1)" },
  references: { nodeTypes: ["type_identifier", "scoped_type_identifier", "scoped_identifier"], describe: "a named type or path" },
  exports: { nodeTypes: ["exports_module_directive", "opens_module_directive"], describe: "a module exports/opens clause (JLS 7.7.2) — a LITERAL keyword" },
  extends: { nodeTypes: ["superclass"], describe: "a superclass clause" },
  implements: { nodeTypes: ["super_interfaces", "extends_interfaces"], describe: "a super-interface clause" },
  overrides: { nodeTypes: ["method_declaration", "annotation"], describe: "a method declaration, optionally @Override-annotated" },
  instantiates: { nodeTypes: ["object_creation_expression"], describe: "a `new` expression (JLS 15.9 — the ONLY way a java object is created)" },
}

const constructHits = new Map<string, { nodes: number; files: number; examples: Hit[] }>()
for (const k of Object.keys(CONSTRUCTS)) constructHits.set(k, { nodes: 0, files: 0, examples: [] })

/** Reflection, by node shape. `method_invocation` whose `name` field is one of
 *  these and whose receiver names a reflect/Class/ClassLoader/Proxy type.
 *  `object` is read through the grammar field, so `getMethod` inside a comment or
 *  a string literal cannot be counted. */
const REFLECTIVE_CALL_NAMES = new Set([
  "forName", "getMethod", "getDeclaredMethod", "getMethods", "getDeclaredMethods",
  "getField", "getDeclaredField", "getFields", "getDeclaredFields",
  "getConstructor", "getDeclaredConstructor", "getConstructors", "getDeclaredConstructors",
  "newInstance", "loadClass", "findLoadedClass", "getResourceAsStream",
  "newProxyInstance", "getInvocationHandler", "defineClass",
])
/** The receiver types whose methods do reflective lookup. Matched on the LAST
 *  dotted segment of the receiver text, so `java.lang.Class` and `Class` agree and
 *  a user's own `Loader` does not. */
const REFLECTIVE_RECEIVERS = new Set([
  "Class", "ClassLoader", "Proxy", "MethodHandles", "Method", "Field", "Constructor",
  "ServiceLoader", "Module", "MethodType",
])
/** Non-invocation reflective forms. Each is a distinct node type or field, so each
 *  is counted by shape. */
const REFLECTIVE_NODES: Record<string, string> = {
  class_literal: "a class literal, `X.class` (JLS 15.8.2) — compiles to a reflective class handle",
}

const reflection = {
  reflectiveInvocation: 0, reflectiveFiles: new Set<string>(), examples: [] as Hit[],
  classLiteral: 0, classLiteralFiles: new Set<string>(), classLiteralExamples: [] as Hit[],
  reflectImport: 0, reflectImportFiles: new Set<string>(), reflectImportExamples: [] as Hit[],
  methodHandleLookup: 0, methodHandleExamples: [] as Hit[],
  /** String literals passed to Class.forName — the genuinely unresolvable case.
   *  Counted as the ARGUMENT of a forName invocation, so it is a value the grammar
   *  bound to that argument slot, not text that happens to look like a class name. */
  forNameLiteralArg: 0, forNameNonLiteralArg: 0, forNameExamples: [] as Hit[],
}

const moduleInfo = {
  files: 0, fileExamples: [] as string[],
  moduleDeclarations: 0,
  exportsDirectives: 0, exportsTo: [] as string[], exportsExamples: [] as Hit[],
  opensDirectives: 0, opensExamples: [] as Hit[],
  requiresDirectives: 0, requiresTo: [] as string[], requiresExamples: [] as Hit[],
  provides: 0, uses: 0,
}

/** Spring MVC route annotations — java's OTHER `exports` producer, a framework
 *  convention rather than a language construct. Counted so the two are not
 *  conflated in the verdict. */
const springRoute = { files: new Set<string>(), mappingAnnotations: 0 }

const treeHits = new Map<string, number>()
for (const k of Object.keys(CONSTRUCTS)) treeHits.set(k, 0)

// ---------------------------------------------------------------- walk
const lastSegment = (t: string): string => {
  const parts = t.split(".")
  return parts[parts.length - 1]
}

let parsed = 0
const failures: string[] = []

for (const abs of files) {
  const content = readFileSync(abs, "utf8")
  const rel = path.relative(JAVA_DIR, abs)
  let root: any
  try { root = parser.parse(content, abs).rootNode } catch (e) { failures.push(`${rel}: ${String(e).slice(0, 80)}`); continue }
  parsed++

  const hitFilesByType = new Set<string>()

  const visit = (n: any): void => {
    // Instrument A
    grammarNodeTypes.set(n.type, (grammarNodeTypes.get(n.type) ?? 0) + 1)

    // Instrument B, per declared construct.
    for (const [t, c] of Object.entries(CONSTRUCTS)) {
      if (!c.nodeTypes.includes(n.type)) continue
      treeHits.set(t, (treeHits.get(t) ?? 0) + 1)
      const h = constructHits.get(t)!
      h.nodes++
      hitFilesByType.add(t)
      if (h.examples.length < 3) h.examples.push({ file: rel, line: n.startPosition.row + 1, detail: n.type })
    }

    // --- JPMS module declaration (JLS 7.7)
    if (n.type === "module_declaration") {
      moduleInfo.moduleDeclarations++
      moduleInfo.files++
      if (moduleInfo.fileExamples.length < 8) moduleInfo.fileExamples.push(rel)
    }
    if (n.type === "exports_module_directive") {
      moduleInfo.exportsDirectives++
      const to = n.childForFieldName?.("name") ?? n.namedChildren.find((c: any) => c.type === "identifier" || c.type === "scoped_identifier")
      const pkg = to ? String(to.text) : ""
      if (moduleInfo.exportsTo.length < 12) moduleInfo.exportsTo.push(pkg)
      if (moduleInfo.exportsExamples.length < 4) moduleInfo.exportsExamples.push({ file: rel, line: n.startPosition.row + 1, detail: pkg })
    }
    if (n.type === "opens_module_directive") {
      moduleInfo.opensDirectives++
      if (moduleInfo.opensExamples.length < 4) moduleInfo.opensExamples.push({ file: rel, line: n.startPosition.row + 1, detail: n.text.slice(0, 60) })
    }
    if (n.type === "requires_module_directive") {
      moduleInfo.requiresDirectives++
      const mods = n.namedChildren.filter((c: any) => c.type === "identifier" || c.type === "scoped_identifier")
      for (const m of mods) if (moduleInfo.requiresTo.length < 20) moduleInfo.requiresTo.push(String(m.text))
      if (moduleInfo.requiresExamples.length < 6) moduleInfo.requiresExamples.push({ file: rel, line: n.startPosition.row + 1, detail: mods.map((m: any) => m.text).join(" ") })
    }
    if (n.type === "provides_module_directive") moduleInfo.provides++
    if (n.type === "uses_module_directive") moduleInfo.uses++

    // --- reflection, by shape
    if (n.type === "method_invocation") {
      const nameNode = n.childForFieldName("name")
      const name = nameNode ? String(nameNode.text) : ""
      if (REFLECTIVE_CALL_NAMES.has(name)) {
        const objNode = n.childForFieldName("object")
        const objText = objNode ? String(objNode.text) : ""
        const recv = lastSegment(objText)
        // A reflective LOOKUP is `Class.forName` / `obj.getMethod` on a Class
        // value. `Service.load` is ordinary construction and is not counted; the
        // receiver set is what separates the two.
        if (REFLECTIVE_RECEIVERS.has(recv) || recv.length === 0) {
          reflection.reflectiveInvocation++
          reflection.reflectiveFiles.add(rel)
          if (reflection.examples.length < 12) reflection.examples.push({ file: rel, line: nameNode ? nameNode.startPosition.row + 1 : n.startPosition.row + 1, detail: `${objText || "<implicit>"}.${name}` })
          if (name === "forName") {
            const args = n.childForFieldName("arguments")
            const first = args && args.namedChildCount > 0 ? args.namedChild(0) : null
            if (first && first.type === "string_literal") {
              reflection.forNameLiteralArg++
              if (reflection.forNameExamples.length < 8) reflection.forNameExamples.push({ file: rel, line: first.startPosition.row + 1, detail: first.text })
            } else {
              reflection.forNameNonLiteralArg++
              if (reflection.forNameExamples.length < 8) reflection.forNameExamples.push({ file: rel, line: n.startPosition.row + 1, detail: `forName(${first ? first.type : "no-args"})` })
            }
          }
        }
      }
    }
    if (n.type === "method_handles_lookup" || (n.type === "method_invocation" && n.childForFieldName("name")?.text === "lookup" && lastSegment(String(n.childForFieldName("object")?.text ?? "")) === "MethodHandles")) {
      reflection.methodHandleLookup++
      if (reflection.methodHandleExamples.length < 4) reflection.methodHandleExamples.push({ file: rel, line: n.startPosition.row + 1, detail: n.text.slice(0, 60) })
    }
    if (n.type === "class_literal") {
      reflection.classLiteral++
      reflection.classLiteralFiles.add(rel)
      if (reflection.classLiteralExamples.length < 8) reflection.classLiteralExamples.push({ file: rel, line: n.startPosition.row + 1, detail: n.text.slice(0, 60) })
    }
    if (n.type === "import_declaration") {
      const text = String(n.text)
      // `java.lang.reflect` / `javax.lang.reflect` / `java.util.ServiceLoader` —
      // matched on the DOTTED PATH the grammar parsed out of the declaration, split
      // on its own segments, never by scanning the file.
      const target = n.namedChildren.find((c: any) => c.type === "scoped_identifier" || c.type === "identifier")
      if (target) {
        const segs = String(target.text).split(".")
        for (let i = 0; i + 1 < segs.length; i++) {
          if (segs[i] === "reflect" || (segs[i] === "lang" && segs[i + 1] === "reflect") || (segs[i] === "util" && segs[i + 1] === "ServiceLoader")) {
            if (text.indexOf("static") === -1) {
              reflection.reflectImport++
              reflection.reflectImportFiles.add(rel)
              if (reflection.reflectImportExamples.length < 8) reflection.reflectImportExamples.push({ file: rel, line: n.startPosition.row + 1, detail: String(target.text) })
            }
            break
          }
        }
      }
    }

    // --- spring MVC route annotations, by AST-resolved annotation name
    if (n.type === "annotation" || n.type === "marker_annotation") {
      const id = n.namedChildren.find((c: any) => c.type === "identifier" || c.type === "scoped_identifier")
      const short = id ? lastSegment(String(id.text)) : ""
      if (short === "RequestMapping" || short === "GetMapping" || short === "PostMapping" || short === "PutMapping" || short === "DeleteMapping" || short === "PatchMapping" || short === "Path") {
        springRoute.mappingAnnotations++
        springRoute.files.add(rel)
      }
    }

    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) visit(c)
    }
  }
  visit(root)

  for (const t of hitFilesByType) constructHits.get(t)!.files++
}

// ---------------------------------------------------------------- report
const corpusRev = (() => { try { return execFileSync("git", ["-C", JAVA_DIR, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { return "unknown" } })()
const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)

console.log(`INCOMING_JAVA construct probe — ${DIR} @ ${corpusRev}`)
console.log(`files ${files.length} enumerated, ${parsed} parsed, ${failures.length} failed`)
if (failures.length) console.log(`failures ${failures.slice(0, 3).join(" | ")}`)

console.log(`\nINSTRUMENT A — grammar vocabulary: ${grammarNodeTypes.size} distinct node types produced`)
console.log("\nINSTRUMENT B — construct counts on the tree (per type, and the node types that carry it)")
console.log(`${w("type", 14)}${w("node count", 12)}${w("files", 8)}node types that would express it`)
for (const [t, c] of Object.entries(CONSTRUCTS)) {
  const h = constructHits.get(t)!
  const absent = c.nodeTypes.filter((n) => !grammarNodeTypes.has(n))
  console.log(`${w(t, 14)}${w(String(h.nodes), 12)}${w(String(h.files), 8)}${c.nodeTypes.join(", ")}`)
  console.log(`${w("", 34)}  ABSENT from the grammar: ${absent.length ? absent.join(", ") : "(none — every one is produced)"}`)
}

console.log(`\nJPMS MODULE DECLARATION (JLS 7.7) — the literal \`exports\`/\`requires\` keywords`)
console.log(`  module-info files              ${moduleInfo.files}   e.g. ${moduleInfo.fileExamples.slice(0, 3).join(", ")}`)
console.log(`  module_declaration nodes       ${moduleInfo.moduleDeclarations}`)
console.log(`  exports_module_directive       ${moduleInfo.exportsDirectives}   packages: ${moduleInfo.exportsTo.join(", ")}`)
console.log(`  opens_module_directive         ${moduleInfo.opensDirectives}`)
console.log(`  requires_module_directive      ${moduleInfo.requiresDirectives}   modules: ${moduleInfo.requiresTo.join(", ")}`)
console.log(`  provides / uses directives     ${moduleInfo.provides} / ${moduleInfo.uses}`)
for (const e of moduleInfo.exportsExamples) console.log(`    exports @ ${e.file}:${e.line} -> ${e.detail}`)
for (const e of moduleInfo.requiresExamples) console.log(`    requires @ ${e.file}:${e.line} -> ${e.detail}`)

console.log(`\nJAVA REFLECTION — measured on the tree, never on text`)
console.log(`  reflective invocations         ${reflection.reflectiveInvocation} across ${reflection.reflectiveFiles.size} files`)
console.log(`  class literals  X.class         ${reflection.classLiteral} across ${reflection.classLiteralFiles.size} files`)
console.log(`  reflection type imports        ${reflection.reflectImport} across ${reflection.reflectImportFiles.size} files`)
console.log(`  MethodHandles.lookup           ${reflection.methodHandleLookup}`)
console.log(`  Class.forName(LITERAL)         ${reflection.forNameLiteralArg}`)
console.log(`  Class.forName(non-literal)     ${reflection.forNameNonLiteralArg}`)
for (const e of reflection.examples.slice(0, 10)) console.log(`    ${e.file}:${e.line}  ${e.detail}`)
for (const e of reflection.forNameExamples) console.log(`    forName arg @ ${e.file}:${e.line}  ${e.detail}`)
for (const e of reflection.reflectImportExamples.slice(0, 6)) console.log(`    reflect import @ ${e.file}:${e.line}  ${e.detail}`)

console.log(`\nSPRING MVC ROUTE ANNOTATIONS (a framework convention, not a language construct)`)
console.log(`  mapping annotations            ${springRoute.mappingAnnotations} across ${springRoute.files.size} files`)

const out = {
  instrument: "script/incoming-java/probe.ts",
  lane: "INCOMING_JAVA",
  corpus: { dir: DIR, rev: corpusRev, filesEnumerated: files.length, parsed, failures: failures.length },
  grammarNodeTypes: grammarNodeTypes.size,
  grammarNodeTypeNames: [...grammarNodeTypes.keys()].sort(),
  constructs: Object.fromEntries(Object.entries(CONSTRUCTS).map(([t, c]) => [t, {
    nodesOnTree: treeHits.get(t) ?? 0,
    filesWithIt: constructHits.get(t)!.files,
    nodeTypesThatWouldExpressIt: c.nodeTypes,
    absentFromGrammar: c.nodeTypes.filter((n) => !grammarNodeTypes.has(n)),
    describe: c.describe,
    examples: constructHits.get(t)!.examples,
  }])),
  moduleInfo,
  reflection: {
    reflectiveInvocation: reflection.reflectiveInvocation,
    reflectiveFiles: [...reflection.reflectiveFiles],
    classLiteral: reflection.classLiteral,
    classLiteralFiles: reflection.classLiteralFiles.size,
    reflectImport: reflection.reflectImport,
    reflectImportFiles: [...reflection.reflectImportFiles],
    methodHandleLookup: reflection.methodHandleLookup,
    forNameLiteralArg: reflection.forNameLiteralArg,
    forNameNonLiteralArg: reflection.forNameNonLiteralArg,
    examples: reflection.examples,
    forNameExamples: reflection.forNameExamples,
  },
  springRoute: { mappingAnnotations: springRoute.mappingAnnotations, files: springRoute.files.size },
}
const outPath = process.env.BB_OUT ?? path.join(REPO, "validation/m14/results/java-construct-probe.json")
writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n")
console.log(`\nwrote ${outPath}`)
