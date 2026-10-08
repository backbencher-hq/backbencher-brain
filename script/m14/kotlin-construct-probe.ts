/**
 * KOTLIN CONSTRUCT PROBE — the measurement that decides GAP vs RULED for the two
 * types the kotlin analyzer does not emit (docs/analyzers/ONTOLOGY-WORKSTREAM.md
 * Part 2). A prose justification is not sufficient: the gate exists because
 * `overrides` had one for a whole wave and it was wrong. A ruling is only
 * admissible with a COUNT, and a GAP needs a count too, or "the language has the
 * construct" is itself an unmeasured claim.
 *
 * TWO INSTRUMENTS, because one question has two shapes (the ontology gate's rule):
 *
 *   A: GRAMMAR INVENTORY. Every node type the pinned wasm actually produces across
 *      the corpus. Positive evidence of ABSENCE for a construct that would need a
 *      node type kotlin does not have. kotlin produces 100+ distinct node types, so
 *      a zero here is a fact about the grammar rather than a failure to look.
 *
 *   B: PARSE-TREE SEMANTIC COUNT. kotlin expresses BOTH missing types through
 *      something a grammar inventory cannot see:
 *        imports — `import_header` exists, but the *dependency* facts live in the
 *          path text and in the alias/wildcard child nodes.
 *        exports — kotlin has NO `export` keyword at all. Its public API surface is
 *          a CONVENTION plus a modifier vocabulary (`public` is the default; the
 *          modifiers that withdraw a declaration are `private`, `internal`,
 *          `protected`). An inventory that looked for an export node would find
 *          nothing and conclude the construct is absent — which is exactly the
 *          unsound reasoning that produced json's wrong `exports` ruling.
 *      So exports is counted on the tree, from `modifiers` + owner presence.
 *
 * It also measures the numbers the implementation needs to choose a SOURCE for the
 * edges: how many kotlin files carry no package header, and what the visibility
 * distribution of top-level declarations actually is.
 *
 * CLI: npx tsx script/m14/kotlin-construct-probe.ts [--sample N] [--out f.json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}
const REPOS = (argOf("--repo", "kotlin") ?? "kotlin").split(",").map((s) => s.trim()).filter(Boolean)
const SAMPLE = parseInt(argOf("--sample", "3000") ?? "3000")
const OUT = argOf("--out")
const MAX_BYTES = 512 * 1024

const files: { repo: string; dir: string; rel: string; abs: string; text: string }[] = []
for (const e of readdirSync(CR)) {
  if (!REPOS.includes(e)) continue
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > MAX_BYTES) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "kotlin") continue
    files.push({ repo: e, dir, rel, abs, text })
  }
}
files.sort((a, b) => (a.repo + "/" + a.rel < b.repo + "/" + b.rel ? -1 : 1))
const admitted = SAMPLE > 0 ? files.slice(0, SAMPLE) : files

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-kotlin.wasm"))))

// ── A: grammar inventory ──────────────────────────────────────────────────────
const nodeTypes = new Map<string, number>()
for (const f of admitted) {
  const t = parser.parse(f.text)
  if (!t) continue
  const v = (n: any) => { nodeTypes.set(n.type, (nodeTypes.get(n.type) ?? 0) + 1); for (let i = 0; i < n.childCount; i++) v(n.child(i)) }
  v(t.rootNode)
  t.delete?.()
}

type Stat = { occurrences: number; files: Set<string>; examples: string[] }
const stat = (): Stat => ({ occurrences: 0, files: new Set(), examples: [] })
const hit = (s: Stat, file: string, note: string) => {
  s.occurrences++
  s.files.add(file)
  if (s.examples.length < 4) s.examples.push(`${file}: ${note}`)
}

const IMPORT_HDR = stat()          // B: `import x.y.Z` declarations
const IMPORT_STAR = stat()         // B: `import x.y.*`
const IMPORT_ALIAS = stat()        // B: `import x.y.Z as W`
const IMPORT_HEADER_NODES = nodeTypes.get("import_header") ?? 0

const EXPORT_NODE = stat()         // A: is there an `export`/exposure node at all?
const TOPLEVEL_DECL = stat()       // B: top-level declarations = the exportable units
const TOPLEVEL_PUBLIC = stat()     // B: ... that are public (default or explicit)
const TOPLEVEL_PRIVATE = stat()
const TOPLEVEL_INTERNAL = stat()
const TOPLEVEL_PROTECTED = stat()  // B: not legal on a top-level declaration in kotlin
const NESTED_DECL = stat()         // B: declarations that carry an owner — ruled OUT of exports
const PKG_HEADER = stat()          // B: files that declare a package
const NO_PKG_FILES = stat()        // B: files with top-level declarations but no package header
const NO_PKG_DECLS = stat()        // ... how many such top-level declarations
const EXPORTABLE_KINDS = new Map<string, number>()
// The SOURCE question, measured: an `exports`/`imports` edge needs a non-empty
// source, and kotlin leaves two populations without a package to name.
const NO_PKG_BY_EXT = new Map<string, number>()
const KTS_TOPLEVEL_PUBLIC = stat()   // script top-level declarations: not an importable API
const KT_NO_PKG_PUBLIC = stat()      // .kt top-level, public, but in the ROOT package

// The modifiers node's own vocabulary, measured rather than assumed: this is what
// decides whether a declaration is part of the module's public surface.
const MODIFIER_WORDS = new Map<string, number>()

for (const f of admitted) {
  const t = parser.parse(f.text)
  if (!t) continue
  const label = `${f.repo}/${f.rel}`
  const hasPkg = t.rootNode.namedChildren?.some((c: any) => c.type === "package_header") ?? false
  if (hasPkg) hit(PKG_HEADER, label, "package_header present")
  let fileHasTopLevel = false
  let fileNoPkgTopLevel = 0

  // "Top level" is a PARENT-CHAIN property, not a depth. tree-sitter-kotlin wraps
  // a file in `source_file`, so a declaration's depth is 2 and a depth test reads
  // 0 top-level declarations on a corpus where every file has some — which is what
  // the first run of this probe did. The chain is the only test that means
  // "declared in the file, not inside a body".
  const DECL_NODES = new Set(["class_declaration", "object_declaration", "function_declaration", "property_declaration", "type_alias"])
  const isTopLevelDeclaration = (n: any): boolean => {
    if (!DECL_NODES.has(n.type)) return false
    let p = n.parent
    while (p) {
      if (DECL_NODES.has(p.type)) return false
      if (p.type === "class_body" || p.type === "object_literal" || p.type === "companion_object" || p.type === "enum_class_body" || p.type === "function_body" || p.type === "block" || p.type === "secondary_constructor" || p.type === "anonymous_initializer") return false
      p = p.parent
    }
    return true
  }

  const walk = (n: any, depth: number) => {
    if (n.type === "export" || n.type === "export_statement" || n.type === "export_declaration" || n.type === "module_structure") hit(EXPORT_NODE, label, n.type)
    if (n.type === "import_header") {
      hit(IMPORT_HDR, label, n.text.split("\n")[0].slice(0, 70))
      if (n.namedChildren?.some((c: any) => c.type === "wildcard_import")) hit(IMPORT_STAR, label, n.text.split("\n")[0].slice(0, 70))
      if (n.namedChildren?.some((c: any) => c.type === "import_alias")) hit(IMPORT_ALIAS, label, n.text.split("\n")[0].slice(0, 70))
    }
    if (n.type === "modifiers") {
      for (let i = 0; i < n.namedChildCount; i++) {
        const w = n.namedChild(i)?.text
        if (w) MODIFIER_WORDS.set(w, (MODIFIER_WORDS.get(w) ?? 0) + 1)
      }
    }
    if (isTopLevelDeclaration(n)) {
      fileHasTopLevel = true
      hit(TOPLEVEL_DECL, label, `${n.type} ${n.namedChildren?.find((c: any) => c.type === "simple_identifier" || c.type === "type_identifier")?.text ?? ""}`)
      EXPORTABLE_KINDS.set(n.type, (EXPORTABLE_KINDS.get(n.type) ?? 0) + 1)
      const mods = n.namedChildren?.find((c: any) => c.type === "modifiers")
      let vis = "public"
      if (mods) {
        for (let i = 0; i < mods.namedChildCount; i++) {
          const w = mods.namedChild(i)?.text
          if (w === "private") vis = "private"
          else if (w === "internal") vis = "internal"
          else if (w === "protected") vis = "protected"
        }
      }
      if (vis === "private") hit(TOPLEVEL_PRIVATE, label, "private top-level")
      else if (vis === "internal") hit(TOPLEVEL_INTERNAL, label, "internal top-level")
      else if (vis === "protected") hit(TOPLEVEL_PROTECTED, label, "protected top-level")
      else hit(TOPLEVEL_PUBLIC, label, "public (default) top-level")
      if (!hasPkg) fileNoPkgTopLevel++
    }
    // A nested declaration is any DECL_NODES node that is NOT top-level: the
    // complement of the predicate above, so the two counts cannot drift apart.
    if (DECL_NODES.has(n.type) && !isTopLevelDeclaration(n)) hit(NESTED_DECL, label, n.type)
    for (let i = 0; i < n.childCount; i++) walk(n.child(i), depth + 1)
  }
  walk(t.rootNode, 0)
  if (fileHasTopLevel && !hasPkg) {
    hit(NO_PKG_FILES, label, `${fileNoPkgTopLevel} top-level declaration(s), no package_header`)
    NO_PKG_DECLS.occurrences += fileNoPkgTopLevel
    const ext = f.rel.endsWith(".kts") ? ".kts" : ".kt"
    NO_PKG_BY_EXT.set(ext, (NO_PKG_BY_EXT.get(ext) ?? 0) + 1)
    if (ext === ".kts") hit(KTS_TOPLEVEL_PUBLIC, label, `${fileNoPkgTopLevel} script top-level declaration(s)`)
  }
  if (!hasPkg && !f.rel.endsWith(".kts") && fileHasTopLevel) hit(KT_NO_PKG_PUBLIC, label, `${fileNoPkgTopLevel} root-package top-level declaration(s)`)
  if (f.rel.endsWith(".kts") && hasPkg) KTS_TOPLEVEL_PUBLIC.occurrences += fileNoPkgTopLevel
  t.delete?.()
}

const out: any = {
  lane: "kotlin",
  instrument: "script/m14/kotlin-construct-probe.ts",
  repos: REPOS,
  tracked_kotlin_files: files.length,
  files_probed: admitted.length,
  instrument_A_grammar_inventory: {
    distinct_node_types: nodeTypes.size,
    import_header_nodes: IMPORT_HEADER_NODES,
    // Positive evidence of absence for an EXPORT KEYWORD: kotlin has none.
    export_named_nodes: EXPORT_NODE.occurrences,
    export_named_node_examples: EXPORT_NODE.examples,
    export_like_node_types_present: [...nodeTypes.keys()].filter((n) => /export/i.test(n)),
    all_node_types: [...nodeTypes.keys()].sort(),
  },
  instrument_B_parse_tree_counts: {
    imports: { import_header_declarations: IMPORT_HDR.occurrences, files: IMPORT_HDR.files, star_imports: IMPORT_STAR.occurrences, aliased_imports: IMPORT_ALIAS.occurrences, examples: IMPORT_HDR.examples },
    exports: {
      export_keyword_nodes: EXPORT_NODE.occurrences,
      top_level_declarations: TOPLEVEL_DECL.occurrences,
      top_level_public: TOPLEVEL_PUBLIC.occurrences,
      top_level_private: TOPLEVEL_PRIVATE.occurrences,
      top_level_internal: TOPLEVEL_INTERNAL.occurrences,
      top_level_protected: TOPLEVEL_PROTECTED.occurrences,
      nested_declarations_ruled_out: NESTED_DECL.occurrences,
      top_level_declaration_kinds: Object.fromEntries([...EXPORTABLE_KINDS.entries()].sort((a, b) => b[1] - a[1])),
      examples: TOPLEVEL_PUBLIC.examples,
    },
    package: {
      files_with_package_header: PKG_HEADER.occurrences,
      files_with_top_level_but_no_package_by_extension: Object.fromEntries(NO_PKG_BY_EXT),
      script_kts_top_level_declarations: KTS_TOPLEVEL_PUBLIC.occurrences,
      script_kts_files: KTS_TOPLEVEL_PUBLIC.files.size,
      root_package_kt_top_level_files: KT_NO_PKG_PUBLIC.files.size,
      files_with_top_level_but_no_package: NO_PKG_FILES.files.size,
      top_level_declarations_in_those_files: NO_PKG_DECLS.occurrences,
      root_package_kt_top_level_declarations: KT_NO_PKG_PUBLIC.occurrences,
      examples: NO_PKG_FILES.examples },
  },
  modifier_vocabulary_measured: Object.fromEntries([...MODIFIER_WORDS.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)),
}
const p = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`kotlin construct probe — ${admitted.length}/${files.length} tracked files, ${nodeTypes.size} distinct node types\n`)
console.log(`A: import_header nodes on the tree ...... ${IMPORT_HEADER_NODES.toLocaleString()}`)
console.log(`A: any node type matching /export/i .... ${out.instrument_A_grammar_inventory.export_like_node_types_present.length ? out.instrument_A_grammar_inventory.export_like_node_types_present.join(", ") : "NONE — kotlin has no export keyword node"}`)
console.log(`\nB: import_header declarations ........... ${IMPORT_HDR.occurrences} in ${IMPORT_HDR.files.size} files  (star ${IMPORT_STAR.occurrences}, aliased ${IMPORT_ALIAS.occurrences})`)
console.log(`B: top-level declarations ............... ${TOPLEVEL_DECL.occurrences}`)
console.log(`B:   public (default or explicit) ...... ${TOPLEVEL_PUBLIC.occurrences}`)
console.log(`B:   private ............................ ${TOPLEVEL_PRIVATE.occurrences}`)
console.log(`B:   internal ........................... ${TOPLEVEL_INTERNAL.occurrences}`)
console.log(`B:   protected .......................... ${TOPLEVEL_PROTECTED.occurrences}`)
console.log(`B: nested declarations (ruled out) ...... ${NESTED_DECL.occurrences}`)
console.log(`B: files with a package_header .......... ${PKG_HEADER.occurrences}`)
console.log(`B: files with top-level decls, NO pkg ... ${NO_PKG_FILES.files.size} (${NO_PKG_DECLS.occurrences} declarations) by ext ${JSON.stringify(Object.fromEntries(NO_PKG_BY_EXT))}`)
console.log(`B: .kts script top-level declarations ... ${KTS_TOPLEVEL_PUBLIC.occurrences} in ${KTS_TOPLEVEL_PUBLIC.files.size} files (a script has no importable API)`)
console.log(`B: .kt ROOT-package top-level .......... ${KT_NO_PKG_PUBLIC.files.size} files / ${KT_NO_PKG_PUBLIC.occurrences} declarations`)
console.log(`\nmeasured modifier vocabulary: ${Object.entries(out.modifier_vocabulary_measured).slice(0, 14).map(([k, v]) => `${k}=${v}`).join(" ")}`)
if (OUT) { writeFileSync(OUT, JSON.stringify(out, null, 1)); console.log(`\nwrote ${OUT}`) }
