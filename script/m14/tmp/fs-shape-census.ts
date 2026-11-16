/**
 * script/m14/tmp/fs-shape-census.ts
 *
 * The fsharp lane has no F5 seat, and an oracle written from the analyzer would
 * only be the analyzer's own shadow. So before any oracle is written, measure
 * what the WIRED grammar (tree-sitter-fsharp.wasm, v0.3.11 + the lane's two
 * rule additions) actually produces on real F# files:
 *
 *   - a node-type census (which of the analyzer's handled types exist at all —
 *     the "worst defect class is a silently dead rule" lesson), and
 *   - child-TYPE distributions at the shapes an oracle must read (callee of an
 *     application, type-body wrappers, inheritance / interface blocks, member
 *     modifiers, module/open forms), and
 *   - subtree dumps (type + field names + truncated text) of the first few
 *     instances of each interesting type, so the oracle's rules cite measured
 *     shapes rather than remembered ones.
 *
 * Reads the corpus under <corpus-root>/bb_tests/repositories/fsharp through
 * the same web-tree-sitter + repo wasm the engine loads. Writes only
 * validation/m14/results/archive/fsharp-shape-census.json.
 *
 * Run: bun script/m14/tmp/fs-shape-census.ts [sampleSize]
 */
import * as fs from "fs"
import * as path from "path"
import { createHash } from "crypto"
import { execSync } from "child_process"

const ROOT = path.resolve(import.meta.dir ?? path.dirname(Bun.main), "..", "..", "..")
const CORPUS = "<corpus-root>/bb_tests/repositories/fsharp"
const OUT = path.join(ROOT, "validation/m14/results/archive/fsharp-shape-census.json")
const SAMPLE = Number(process.argv[2] ?? 120)

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex")

// Deterministic corpus draw: sorted .fs/.fsi files at least 1 KB, every k-th.
function draw(n: number): string[] {
  const files: string[] = []
  const walk = (dir: string) => {
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".git" || e.name === "artifacts" || e.name === "obj" || e.name === "bin") continue
        walk(p)
      } else if ((e.name.endsWith(".fs") || e.name.endsWith(".fsi")) && fs.statSync(p).size >= 1024) {
        files.push(p)
      }
    }
  }
  walk(CORPUS)
  files.sort()
  const step = Math.max(1, Math.floor(files.length / n))
  const picked: string[] = []
  for (let i = 0; i < files.length && picked.length < n; i += step) picked.push(files[i])
  return picked
}

const INTERESTING = new Set([
  "type_definition", "class_inherits_decl", "interface_implementation", "member_defn",
  "additional_constr_defn", "member_signature", "val_property_defn", "app_expression",
  "application_expression", "dot_expression", "infix_expression", "open_statement",
  "open_decl", "import_decl", "module_abbrev", "named_module", "namespace", "module_defn",
  "value_declaration", "function_or_value_defn", "method_or_prop_defn", "type_extension",
  "object_expression", "active_pattern", "exception_definition", "attribute", "long_identifier",
  "identifier", "identifier_pattern", "long_identifier_or_op", "type_name", "anon_type_defn",
  "record_type_defn", "union_type_defn", "enum_type_defn", "interface_type_defn",
  "delegate_type_defn", "type_abbrev_defn", "union_type_case", "enum_type_case",
  "record_field", "function_declaration_left", "value_declaration_left", "argument_patterns",
  "paren_pattern", "compiler_directive_decl", "fsi_directive_decl", "ERROR", "MISSING",
  // The patched rule's own node (this grammar's addition): what a module-level
  // binding looks like, since the analyzer has no branch for it.
  "module_val_declaration", "declaration_expression", "fun_expression",
])
// Child-type distributions to measure: for each parent type, the (field,type) of its named children.
const DIST_PARENTS = new Set([
  "app_expression", "application_expression", "dot_expression", "class_inherits_decl",
  "interface_implementation", "member_defn", "additional_constr_defn", "type_definition",
  "function_or_value_defn", "value_declaration", "open_statement", "open_decl", "import_decl",
  "module_defn", "named_module", "type_extension", "object_expression",
  // Second pass (oracle-authoring needs): where the member's ARGS live (the
  // property/method split), what a `new`-prefixed construction looks like, and
  // how a declaration's NAME is wrapped.
  "method_or_prop_defn", "prefixed_expression", "function_declaration_left",
  "value_declaration_left", "type_name", "simple_type", "generic_type",
])

const shape = (n: any, depth = 0, maxDepth = 6): string[] => {
  const out: string[] = []
  const field = (() => {
    const p = n.parent
    if (!p) return ""
    for (let i = 0; i < p.childCount; i++) {
      if (p.child(i)?.id !== n.id) continue
      const f = typeof p.fieldNameForChild === "function" ? p.fieldNameForChild(i) : null
      return f ? `${f}:` : ""
    }
    return ""
  })()
  const text = (n.childCount === 0 ? n.text ?? "" : "").replace(/\s+/g, " ").slice(0, 44)
  out.push(`${"  ".repeat(depth)}${field}${n.type}${text ? ` "${text}"` : ""}${n.isNamed ? "" : " (anon)"}`)
  if (depth >= maxDepth) return out
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c && (c.isNamed || depth < 3)) out.push(...shape(c, depth + 1, maxDepth))
  }
  return out
}

async function main() {
  const { Parser, Language } = await import("web-tree-sitter")
  await Parser.init()
  const parser = new Parser()
  const wasm = fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-fsharp.wasm"))
  parser.setLanguage(await Language.load(new Uint8Array(wasm)))

  const files = draw(SAMPLE)
  const nodeTypes: Record<string, number> = {}
  const dist: Record<string, Record<string, number>> = {}
  const examples: Record<string, Array<{ file: string; line: number; shape: string[] }>> = {}
  const MAX_EXAMPLES = 3
  let parseErrors = 0
  let totalNodes = 0

  for (const f of files) {
    const rel = f.replace(CORPUS + "/", "")
    const content = fs.readFileSync(f, "utf8")
    let tree: any
    try { tree = parser.parse(content) } catch { continue }
    if (!tree?.rootNode) continue
    if (tree.rootNode.hasError) parseErrors++
    const stack: any[] = [tree.rootNode]
    while (stack.length) {
      const n = stack.pop()
      totalNodes++
      nodeTypes[n.type] = (nodeTypes[n.type] ?? 0) + 1
      if (DIST_PARENTS.has(n.type)) {
        const bucket = (dist[n.type] ??= {})
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          const fld = typeof n.fieldNameForChild === "function" ? n.fieldNameForChild(i) : null
          const key = `${fld ? fld + ":" : ""}${c.type}`
          bucket[key] = (bucket[key] ?? 0) + 1
        }
      }
      if (INTERESTING.has(n.type)) {
        const list = (examples[n.type] ??= [])
        if (list.length < MAX_EXAMPLES) {
          list.push({ file: rel, line: n.startPosition.row + 1, shape: shape(n) })
        }
      }
      for (let i = n.childCount - 1; i >= 0; i--) { const c = n.child(i); if (c) stack.push(c) }
    }
  }

  const artifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    method: "deterministic every-k-th draw of .fs/.fsi >= 1KB under the fsharp corpus; parse with the wired wasm through web-tree-sitter; node-type census + named-child (field,type) distributions + subtree dumps of the first 3 instances of each interesting type",
    commit: execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim(),
    wasm: {
      file: "wasm/tree-sitter-fsharp.wasm",
      sha256: createHash("sha256").update(wasm).digest("hex"),
      bytes: wasm.length,
    },
    corpus: CORPUS,
    sampleSize: files.length,
    files: files.map((f) => f.replace(CORPUS + "/", "")),
    totalNodes,
    parseErrorFiles: parseErrors,
    nodeTypeCounts: Object.fromEntries(Object.entries(nodeTypes).sort((a, b) => b[1] - a[1])),
    interestingTypeCounts: Object.fromEntries(
      [...INTERESTING].map((t) => [t, nodeTypes[t] ?? 0]).sort((a, b) => (b[1] as number) - (a[1] as number)),
    ),
    childTypeDistributions: dist,
    examples,
  }
  fs.writeFileSync(OUT, JSON.stringify(artifact, null, 1))

  console.log(`files=${files.length} totalNodes=${totalNodes} parseErrorFiles=${parseErrors}`)
  console.log("\ninteresting type counts (0 = the analyzer's rule is DEAD):")
  for (const [t, c] of Object.entries(artifact.interestingTypeCounts)) console.log(`  ${String(c).padStart(8)} ${t}`)
  console.log("\nchild-type distributions:")
  for (const [p, bucket] of Object.entries(dist)) {
    const top = Object.entries(bucket).sort((a, b) => b[1] - a[1]).slice(0, 8)
    console.log(`  ${p}: ${top.map(([k, v]) => `${k}=${v}`).join(" ")}`)
  }
  console.log(`\nwrote ${path.relative(ROOT, OUT)} (sha256 ${sha256(JSON.stringify(artifact)).slice(0, 12)})`)
}

await main()
