/**
 * JAVA CONSTRUCT PROBE — the instrument a GAP/RULED verdict has to be made with.
 *
 * ## Which instrument, and why
 *
 * `script/m14/ontology-coverage-gate.ts` names two and says which applies is
 * decided by the QUESTION:
 *
 *   A. GRAMMAR INVENTORY — for a type needing a node type the language does not
 *      have. Enumerating every node type the grammar produces is positive
 *      evidence of absence.
 *   B. PARSE-TREE SEMANTIC COUNT — for a type the language CAN express. A second
 *      declaration of a name is perfectly good java, so no inventory finds it;
 *      it has to be counted on the tree, where a string or a comment cannot fake
 *      it.
 *
 * Every probe below is B, because every type java emits or is missing is a
 * construct java can express. A is still run and recorded, as the denominator
 * that says what the grammar produced at all.
 *
 * ## WHICH BYTES ARE PARSED
 *
 * Through the SAME resolution production uses — `require.resolve` of the
 * `tree-sitter-java` package, which is where `engine.ts`'s `resolveWasm` lands
 * (measured: the engine log reports
 * `node_modules/tree-sitter-java/tree-sitter-java.wasm`). Reading
 * `wasm/tree-sitter-java.wasm` instead would measure a different grammar build:
 * the repo's copy is 430,239 B / sha256 637aac44…, the installed package is
 * 414,641 B / sha256 4fdeac4c…, and the installed package ships `src/grammar.json`,
 * `src/node-types.json` and `src/parser.c` — so its version IS knowable
 * (tree-sitter-java 0.23.5), which the repo copy's does not.
 *
 *   npx tsx script/m60/java-construct-probe.ts out.json [maxFiles]
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync, statSync } from "node:fs"
import * as path from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPOS = (process.env.BB_JAVA_REPOS ?? "java-lib,java-sample").split(",").map((s) => s.trim()).filter(Boolean)
const OUT = process.argv[2] ?? ""
const MAX = Number(process.argv[3] ?? "0") || Infinity

const files: Array<{ repo: string; dir: string; rel: string; abs: string; text: string }> = []
const revisions: Record<string, string> = {}
for (const repo of REPOS) {
  const dir = path.join(CR, repo)
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.java"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
    revisions[repo] = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
    files.push({ repo, dir, rel, abs, text: readFileSync(abs, "utf8") })
  }
}
files.sort((a, b) => (a.repo + a.rel < b.repo + b.rel ? -1 : a.repo + a.rel > b.repo + b.rel ? 1 : 0))
const corpus = files.slice(0, MAX === Infinity ? files.length : MAX)

/* ---------------------------------------------------------------- grammar */
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })

const PKG_WASM = path.join(process.cwd(), "node_modules", "tree-sitter-java", "tree-sitter-java.wasm")
const REPO_WASM = path.join(process.cwd(), "wasm", "tree-sitter-java.wasm")
const bytes = readFileSync(PKG_WASM)
const grammarIdentity = {
  parsedFrom: "node_modules/tree-sitter-java/tree-sitter-java.wasm",
  bytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  packageVersion: JSON.parse(readFileSync(path.join(process.cwd(), "node_modules", "tree-sitter-java", "package.json"), "utf8")).version,
  repoCopyPresent: (() => { try { return statSync(REPO_WASM).size } catch { return null } })(),
  repoCopySha256: (() => { try { return createHash("sha256").update(readFileSync(REPO_WASM)).digest("hex") } catch { return null } })(),
}
const parser = new WSP()
parser.setLanguage(await WSL.load(bytes))

/* ------------------------------------------------- A: grammar inventory */
const nodeTypes = new Map<string, number>()
const examples = new Map<string, string>()
const walk = (root: any, visit: (n: any) => void) => {
  const stack: any[] = [root]
  while (stack.length) { const n = stack.pop()!; visit(n); for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) } }
}
const trees = new Map<string, any>()
for (const f of corpus) {
  const t = parser.parse(f.text)
  if (!t) continue
  const label = `${f.repo}/${f.rel}`
  trees.set(label, t)
  walk(t.rootNode, (n) => {
    nodeTypes.set(n.type, (nodeTypes.get(n.type) ?? 0) + 1)
    if (!examples.has(n.type)) examples.set(n.type, `${label}:${n.startPosition.row + 1} ${JSON.stringify(n.text.slice(0, 60))}`)
  })
}

/* ---------------------------------------------------------------- B: probes */
type Probe = { name: string; question: string; occurrences: number; files: number; shapes?: Record<string, number>; examples: string[] }
const probes: Probe[] = []
const add = (name: string, question: string, fn: (root: any, label: string, hits: string[], shapes: Record<string, number>) => void) => {
  const hits: string[] = []
  const shapes: Record<string, number> = {}
  const hitFiles = new Set<string>()
  for (const [label, t] of trees) {
    const before = hits.length
    fn(t.rootNode, label, hits, shapes)
    if (hits.length > before) hitFiles.add(label)
  }
  probes.push({
    name, question, occurrences: hits.length, files: hitFiles.size,
    ...(Object.keys(shapes).length ? { shapes } : {}),
    examples: hits.slice(0, 5),
  })
}

/** Read the modifiers of a declaration node by walking its `modifiers` child. */
const modifiersOf = (n: any): string => {
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c && c.type === "modifiers") return c.text
  }
  return ""
}
const isPublicTopLevel = (n: any, hasPackage: boolean): boolean => {
  if (!hasPackage) return false
  // A top-level type is one with no enclosing class/interface/enum body.
  const mods = modifiersOf(n)
  return mods.indexOf("public") !== -1
}

/* -- the `imports` construct. JLS 7.5 has THREE import forms and JPMS adds a
      fourth (`requires`), so the shapes are counted separately: an on-demand
      import names a PACKAGE, a single-type import names a TYPE, a static import
      names a MEMBER, and `requires` names a MODULE. One counter would hide all
      four. -- */
add("import_declaration", "JLS 7.5 — does java have an import declaration?", (root, label, hits, shapes) => {
  walk(root, (n) => {
    if (n.type !== "import_declaration") return
    const txt = n.text.trim()
    const isStatic = txt.startsWith("import static") || txt.startsWith("import  static")
    const isOnDemand = txt.endsWith(".*;") || txt.endsWith(".*")
    const shape = isStatic && isOnDemand ? "static_on_demand" : isStatic ? "static_member" : isOnDemand ? "on_demand_package" : "single_type"
    shapes[shape] = (shapes[shape] ?? 0) + 1
    hits.push(`${label}:${n.startPosition.row + 1} ${shape} ${JSON.stringify(txt.slice(0, 70))}`)
  })
})
add("requires_module_directive", "JPMS module dependency — a module requires another module", (root, label, hits) => {
  walk(root, (n) => { if (n.type === "requires_module_directive") hits.push(`${label}:${n.startPosition.row + 1} ${JSON.stringify(n.text.slice(0, 60))}`) })
})
add("exports_module_directive", "JPMS exports — a module publishes a package", (root, label, hits) => {
  walk(root, (n) => { if (n.type === "exports_module_directive") hits.push(`${label}:${n.startPosition.row + 1} ${JSON.stringify(n.text.slice(0, 60))}`) })
})
add("module-info.java present", "is a module descriptor in the corpus at all?", (_root, label, hits) => {
  if (path.basename(label) === "module-info.java") hits.push(label)
})

/* -- the `exports` construct. JLS 7.6: a type in a NAMED package is exported iff
      it is public, and an import can only name an exported type (JLS 7.5.1 /
      7.5.2 make every other case a compile error). So the construct java has for
      `exports` is "public top-level type in a named package" — and that is the
      same unit the analyzer already collects into its ExportInfo list. The probe
      counts it on the tree, splitting the package-private and default-package
      cases, because those are NOT exported and an implementation that emits them
      would fabricate an edge. -- */
add("public top-level type in a named package (JLS 7.6 export)", "does java have an exportable unit?", (root, label, hits, shapes) => {
  const hasPackage = root.namedChildren.some((c: any) => c.type === "package_declaration")
  for (const c of root.namedChildren) {
    if (!["class_declaration", "interface_declaration", "enum_declaration", "record_declaration", "annotation_type_declaration"].includes(c.type)) continue
    const name = c.childForFieldName?.("name")?.text ?? "?"
    if (isPublicTopLevel(c, hasPackage)) {
      shapes["public_top_level_named_package"] = (shapes["public_top_level_named_package"] ?? 0) + 1
      hits.push(`${label}:${c.startPosition.row + 1} ${c.type} ${name}`)
    } else if (!hasPackage) {
      shapes["top_level_default_package"] = (shapes["top_level_default_package"] ?? 0) + 1
      hits.push(`${label}:${c.startPosition.row + 1} ${c.type} ${name} (DEFAULT PACKAGE — not importable)`)
    } else {
      shapes["package_private_top_level"] = (shapes["package_private_top_level"] ?? 0) + 1
      hits.push(`${label}:${c.startPosition.row + 1} ${c.type} ${name} (package-private — not exported)`)
    }
  }
})

/* -- the constructs behind the eight types java already emits, so the table can
      report the construct's own count rather than only the edge's. -- */
const countNode = (t: string) => (root: any, label: string, hits: string[]) => {
  walk(root, (n) => { if (n.type === t) hits.push(`${label}:${n.startPosition.row + 1} ${JSON.stringify(n.text.slice(0, 60))}`) })
}
add("superclass / extends_interfaces / super_interfaces", "the extends+implements clauses", (root, label, hits, shapes) => {
  walk(root, (n) => {
    if (n.type === "superclass") { shapes["extends"] = (shapes["extends"] ?? 0) + 1; hits.push(`${label}:${n.startPosition.row + 1} extends ${JSON.stringify(n.text.slice(0, 50))}`) }
    if (n.type === "extends_interfaces") { shapes["extends_interface"] = (shapes["extends_interface"] ?? 0) + 1; hits.push(`${label}:${n.startPosition.row + 1} extends-iface ${JSON.stringify(n.text.slice(0, 50))}`) }
    if (n.type === "super_interfaces") { shapes["implements"] = (shapes["implements"] ?? 0) + 1; hits.push(`${label}:${n.startPosition.row + 1} implements ${JSON.stringify(n.text.slice(0, 50))}`) }
  })
})
add("object_creation_expression", "a `new` expression — the instantiates construct", countNode("object_creation_expression"))
add("method_invocation", "a method invocation — the calls construct", countNode("method_invocation"))
add("method_declaration with a body", "an overridable member — the overrides construct", (root, label, hits) => {
  walk(root, (n) => {
    if (n.type !== "method_declaration") return
    hits.push(`${label}:${n.startPosition.row + 1} ${JSON.stringify(n.childForFieldName?.("name")?.text ?? "")}`)
  })
})
add("type_identifier", "a named type in a type position — the declared-type references construct", countNode("type_identifier"))
add("class_body / enum_body / interface_body", "a type body — the contains construct", (root, label, hits, shapes) => {
  walk(root, (n) => {
    if (["class_body", "enum_body", "interface_body", "annotation_type_body", "enum_body_declarations"].includes(n.type)) {
      shapes[n.type] = (shapes[n.type] ?? 0) + 1
      hits.push(`${label}:${n.startPosition.row + 1} ${n.type}`)
    }
  })
})

const out = {
  tool: "script/m60/java-construct-probe.ts",
  corpus: { repos: REPOS, revisions, files: corpus.length },
  grammarIdentity,
  instrumentA: {
    distinctNodeTypes: nodeTypes.size,
    counts: Object.fromEntries([...nodeTypes.entries()].sort((a, b) => b[1] - a[1])),
    examples: Object.fromEntries(examples),
  },
  instrumentB: probes,
}
console.log(JSON.stringify(out.instrumentB, null, 2))
console.log(`\ngrammar inventory: ${out.instrumentA.distinctNodeTypes} distinct node types across ${corpus.length} files`)
console.log(`grammar identity: ${JSON.stringify(grammarIdentity)}`)
if (OUT) { writeFileSync(OUT, JSON.stringify(out, null, 2)); console.log(`wrote ${OUT}`) }