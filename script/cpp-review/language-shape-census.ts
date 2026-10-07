/**
 * The C++ lane's LANGUAGE-SHAPE CENSUS — what constructs the pinned grammar can
 * actually see in a real corpus, counted as AST nodes, plus the AST-shape probes
 * that decide a GAP or a LOSS verdict.
 *
 * This is the falsifiable instrument behind every RULED verdict and every
 * "the analyzer emits nothing here" claim. "C++ has no `implements` keyword" is a
 * prose claim about the language; the form that survives review is "over N real
 * C++ files the grammar produced M nodes of the construct, and the analyzer read
 * 0 of them". A probe that finds a non-zero count overturns the ruling, which is
 * the point — see `script/m14/ontology-coverage-gate.ts`'s header for why a prose
 * justification was not enough.
 *
 * TWO INSTRUMENTS, and which one applies is decided by the QUESTION:
 *
 *   A. GRAMMAR INVENTORY — every distinct node type the pinned wasm actually
 *      produces across the corpus, counted. Absence of a node type the language
 *      would need is positive evidence that the grammar cannot see the construct.
 *   B. AST-SHAPE PROBE — a count on the tree, for a construct the language CAN
 *      express and the grammar CAN see but the analyzer does not read.
 *
 * The first version of this file's `imports` probe was a TEXT regex over
 * `^[ \t]*import `, which is the wrong instrument and is why it is not here: a
 * regex cannot tell a C++20 module import from an `import` used as an ordinary
 * identifier, and it cannot tell `__declspec(dllexport)` from the word `export`
 * in a comment. Every probe below runs on the tree.
 *
 *   BB_CORPUS_ROOT=... CPP_REPOS=sqlite,cpp-sample \
 *     bun run script/cpp-review/language-shape-census.ts [--limit N] [--out p]
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { detectLanguageFromPath } from "../../src/ast/language-detection"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const OUT = process.env.CPP_OUT ?? "/tmp/opencode/cpp-review"
const EXTS = new Set([".cpp", ".cc", ".cxx", ".c++", ".hpp", ".hxx", ".hh", ".h++", ".h", ".ipp", ".tpp"])
const SKIP = new Set([".git", "build", "node_modules", ".github", "cmake-build-debug", "bazel-bin", "CMakeFiles"])

/** Node types whose PRESENCE decides a verdict. Read from the pinned fork's own
 *  `grammar.js` rule names where the rule exists, so a node type a future fork
 *  adds cannot be missed by a list written before it existed. */
const WATCHED = [
  // --- `implements`: C++ has no implements clause; these are the constructs that
  // express a satisfaction relation the base-class list does not.
  "concept_definition", "requires_clause", "requires_expression", "requires_parameter_list",
  "constraint_conjunction", "constraint_disjunction",
  // --- `imports` / `exports`: C++20 modules, and the platform export markers.
  "preproc_include", "import_declaration", "module_declaration", "module_name", "export_declaration",
  "ms_declspec_modifier", "attribute_specifier", "attribute_declaration",
  "using_declaration", "alias_declaration", "namespace_alias_definition",
  // --- `overrides` / `extends`: the shapes the inheritance reader must find.
  "base_class_clause", "virtual_specifier", "class_specifier", "struct_specifier",
  "function_definition", "declaration", "field_declaration", "pure_virtual_clause",
  "call_expression", "new_expression", "field_expression",
]

function walkFiles(root: string): string[] {
  const out: string[] = []
  const stack = [root]
  while (stack.length) {
    const d = stack.pop()!
    let entries: import("node:fs").Dirent[]
    try { entries = readdirSync(d, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue
      const full = path.join(d, e.name)
      if (e.isDirectory()) stack.push(full)
      else if (EXTS.has(path.extname(e.name))) out.push(full)
    }
  }
  return out.sort()
}

const arg = (f: string): string | undefined => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : undefined }

/** Is this identifier a MACRO SPELLING? The analyzer's own `isMacroSpelling`
 *  rule, restated char-wise. This is a MEASUREMENT instrument, not the analyzer,
 *  so it is stated here rather than imported — an imported copy would make the
 *  probe agree with the analyzer by construction, which is the both-sides blind
 *  spot the differential cannot see. */
function isMacroSpelling(s: string): boolean {
  if (!s.length) return false
  if (s.charCodeAt(0) < 65 || s.charCodeAt(0) > 90) return false
  for (let i = 1; i < s.length; i++) {
    const c = s.charCodeAt(i)
    const ok = (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95
    if (!ok) return false
  }
  return true
}

type Hit = { file: string; line: number; what: string; detail: string }

async function main() {
  const rootsRaw = (process.env.CPP_REPOS ?? "").split(",").filter(Boolean)
  const roots = rootsRaw.length
    ? rootsRaw.map((r) => path.join(CORPUS, r))
    : readdirSync(CORPUS).map((d) => path.join(CORPUS, d))
  let candidates: string[] = []
  for (const r of roots) candidates = candidates.concat(walkFiles(r))
  candidates = [...new Set(candidates)].sort().slice(0, Number(arg("--limit") ?? Number.POSITIVE_INFINITY))

  const files: string[] = []
  const excluded: Record<string, number> = {}
  for (const f of candidates) {
    let c = ""
    try { c = readFileSync(f, "utf8") } catch { continue }
    const lang = detectLanguageFromPath(f, c)
    if (lang === "cpp") files.push(f)
    else excluded[`${path.basename(path.dirname(path.dirname(f)))}/${lang ?? "unknown"}`] = (excluded[`${path.basename(path.dirname(path.dirname(f)))}/${lang ?? "unknown"}`] ?? 0) + 1
  }

  const nodeCounts: Record<string, number> = {}
  const nodeFiles: Record<string, Set<string>> = {}
  /** EVERY distinct node type the pinned wasm produced — instrument A. */
  const grammarSurface = new Map<string, number>()
  /** instrument B, keyed by probe id */
  const hits: Record<string, Hit[]> = {
    // --- `imports`
    preproc_include: [],
    cpp20_module_keyword: [],
    // --- `exports`
    export_macro_on_specifier: [],
    declspec_dllexport: [],
    attribute_visibility_default: [],
    export_macro_on_declaration: [],
    // --- `implements`
    concept_definition: [],
    requires_clause: [],
    pure_virtual_site: [],
    // --- `overrides` / `extends`
    virtual_specifier_override: [],
    base_class_clause_readable: [],
    base_class_clause_lost_to_error: [],
    macro_decorated_specifier: [],
  }
  const probeFiles: Record<string, Set<string>> = {}
  for (const k of Object.keys(hits)) probeFiles[k] = new Set()
  const samples: Record<string, Hit[]> = {}
  const addHit = (id: string, file: string, line: number, what: string, detail: string) => {
    hits[id].push({ file, line, what, detail })
    probeFiles[id].add(file)
    if (!samples[id]) samples[id] = []
    if (samples[id].length < 6) samples[id].push({ file: `${path.basename(path.dirname(file))}/${path.basename(file)}`, line, what, detail })
  }

  let parsed = 0
  let errorFiles = 0
  const nodeTypesObserved = new Set<string>()

  for (const f of files) {
    let content: string
    try { content = readFileSync(f, "utf8") } catch { continue }
    if (content.length > 4_000_000) continue
    let tree: any
    try { tree = await ASTEngine.parseTree(f, content) } catch { continue }
    parsed++
    if (tree?.tree?.rootNode?.hasError) errorFiles++
    const label = `${path.basename(path.dirname(f))}/${path.basename(f)}`
    const stack: any[] = [tree.tree.rootNode]
    /** class name -> has a pure virtual method, for the implements probe */
    const pureVirtualClasses = new Map<string, boolean>()
    const classOfNode = new Map<any, string>()
    while (stack.length) {
      const n = stack.pop()
      const t = n.type
      nodeTypesObserved.add(t)
      grammarSurface.set(t, (grammarSurface.get(t) ?? 0) + 1)
      if (WATCHED.includes(t)) {
        nodeCounts[t] = (nodeCounts[t] ?? 0) + 1
        if (!nodeFiles[t]) nodeFiles[t] = new Set()
        nodeFiles[t].add(f)
      }
      const line = n.startPosition.row + 1

      if (t === "preproc_include") {
        const p = n.namedChild(0)
        addHit("preproc_include", f, line, "preproc_include", p ? p.text.slice(0, 70) : n.text.slice(0, 70))
      }
      // C++20 module declarations: the pinned fork declares no rule for them, so
      // the only honest measurement is "the grammar produced no such node over N
      // files". Recorded as a probe so a future fork that ADDS the rule shows a
      // non-zero count and the RULED verdict has to be revisited.
      if (t === "import_declaration" || t === "module_declaration" || t === "export_declaration") {
        addHit("cpp20_module_keyword", f, line, t, n.text.slice(0, 70))
      }
      if (t === "concept_definition") addHit("concept_definition", f, line, "concept_definition", n.text.replace(/\s+/g, " ").slice(0, 70))
      if (t === "requires_clause") addHit("requires_clause", f, line, "requires_clause", n.text.replace(/\s+/g, " ").slice(0, 70))

      // `exports`, form 1: a specifier head carrying a macro — `class BENCHMARK_EXPORT Foo`
      if (t === "class_specifier" || t === "struct_specifier" || t === "union_specifier") {
        const nameField = n.childForFieldName?.("name")?.text?.trim()
        let hasBody = false
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && (c.type === "class_body" || c.type === "field_declaration_list")) hasBody = true
        }
        const parent = n.parent
        if (!hasBody && nameField && isMacroSpelling(nameField) && parent?.type === "function_definition") {
          addHit("macro_decorated_specifier", f, line, `${t} head=${nameField}`, n.text.replace(/\s+/g, " ").slice(0, 60))
          addHit("export_macro_on_specifier", f, line, `${nameField} decorates a class/struct head`, n.text.replace(/\s+/g, " ").slice(0, 60))
        }
        // A readable inheritance clause, or one the grammar lost.
        if (hasBody) {
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c && c.type === "base_class_clause") {
              addHit("base_class_clause_readable", f, line, "base_class_clause", c.text.replace(/\s+/g, " ").slice(0, 60))
            }
          }
          const nm = n.childForFieldName?.("name")?.text?.trim()
          if (nm) classOfNode.set(n, nm)
        }
      }
      // `exports`, form 2: the platform markers.
      if (t === "ms_declspec_modifier" || t === "attribute_specifier" || t === "attribute_declaration") {
        const txt = n.text.replace(/\s+/g, " ")
        if (/dllexport/.test(txt)) addHit("declspec_dllexport", f, line, t, txt.slice(0, 70))
        if (/visibility\s*\(\s*["']?default/.test(txt)) addHit("attribute_visibility_default", f, line, t, txt.slice(0, 70))
      }
      // `overrides`: the `override` specifier is the WRITTEN proof that a base
      // virtual exists, independent of whether the analyzer can resolve it.
      if (t === "virtual_specifier" && n.text.trim() === "override") {
        addHit("virtual_specifier_override", f, line, "virtual_specifier 'override'", "")
      }
      // ONTOLOGY/D23 (probe repair, CPP2): this probe read 0 over the two pinned
      // corpora and a verdict was built on it. BOTH of its disjuncts are dead:
      //
      //   - `pure_virtual_clause` is a rule the pinned fork DOES declare
      //     (`grammar.js`: `pure_virtual_clause: _ => seq('=', /0/, ';')`) but reaches
      //     only from `inline_method_definition` and
      //     `constructor_or_destructor_definition`, and the corpus produces 0 of them.
      //     The instrument's own grammar inventory reports it `<-- ABSENT`, which is
      //     the tell: a watched node type the grammar declares and the corpus never
      //     produces is a probe pointed at the wrong node.
      //   - a `function_declarator`'s own TEXT ends at `)`. The `= 0` lives in the
      //     PARENT `declaration`'s `init_declarator` (`declaration [declarator=
      //     init_declarator] > init_declarator [declarator=function_declarator
      //     value=number_literal]`), so the regex can never see it.
      //
      // The repair reads the `= 0` INITIALISER off the grammar's own fields, which is
      // what `script/cpp-review/pure-virtual-census.ts` already did and what
      // `script/cpp-review/cpp2-implements-instrument.ts` Arm A now does
      // independently. Two instruments in one lane read 0 and 7; the 0 was the one a
      // verdict rested on. The correct population is 7 sites over 4 files, and the
      // probe is renamed to say what it counts rather than what it was meant to count.
      if (t === "field_declaration" || t === "declaration") {
        const direct = n.childForFieldName?.("declarator")
        let pvDirect = false
        if (direct?.type === "function_declarator") {
          for (let i = 0; i < n.childCount; i++) {
            const c = n.child(i)
            if (c?.type === "number_literal" && c.text.trim() === "0") { pvDirect = true; break }
          }
        }
        let pvInit = false
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c || c.type !== "init_declarator") continue
          const v = c.childForFieldName?.("value")
          const inner = c.childForFieldName?.("declarator")
          if (v?.type === "number_literal" && v.text.trim() === "0" && inner?.type === "function_declarator") { pvInit = true; break }
        }
        if (pvDirect || pvInit) {
          addHit("pure_virtual_site", f, line, pvDirect ? "field_declaration/direct" : "declaration/init_declarator", n.text.replace(/\s+/g, " ").slice(0, 60))
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c) stack.push(c)
      }
    }

    // A macro-decorated class that ALSO carries an inheritance clause: the
    // grammar puts the clause in an ERROR node, so `base_class_clause` never
    // appears and the analyzer cannot read it. Counted from the tree by asking
    // whether the recovery's ERROR node holds an `:` and access tokens.
    {
      const st2: any[] = [tree.tree.rootNode]
      while (st2.length) {
        const n = st2.pop()
        if (n.type === "ERROR") {
          const txt = n.text.replace(/\s+/g, " ")
          if (/:\s*(?:public|private|protected|virtual)/.test(txt)) {
            addHit("base_class_clause_lost_to_error", f, n.startPosition.row + 1, "ERROR holds ': access Base'", txt.slice(0, 70))
          }
        }
        for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) st2.push(c) }
      }
    }
  }

  const outPath = arg("--out") ?? path.join(OUT, "language-shape-census.json")
  mkdirSync(path.dirname(outPath), { recursive: true })
  const probeRows = Object.keys(hits).map((id) => ({
    id, count: hits[id].length, files: probeFiles[id].size, samples: samples[id] ?? [],
  }))
  writeFileSync(outPath, JSON.stringify({
    at: new Date().toISOString(),
    corpus: CORPUS, repos: rootsRaw, candidatesConsidered: candidates.length,
    cppFilesParsed: parsed, grammarErrorFiles: errorFiles, excludedNotCpp: excluded,
    grammarSurface: { distinctNodeTypes: grammarSurface.size, counts: Object.fromEntries([...grammarSurface.entries()].sort((a, b) => b[1] - a[1])) },
    watchedNodes: Object.fromEntries(WATCHED.map((k) => [k, { count: nodeCounts[k] ?? 0, files: nodeFiles[k]?.size ?? 0 }])),
    probes: probeRows,
  }, null, 2))

  console.log(`candidates ${candidates.length} | cpp parsed ${parsed} | grammar-error files ${errorFiles}`)
  console.log(`EXCLUDED (another lane's language): ${JSON.stringify(excluded)}`)
  console.log(`\nINSTRUMENT A — grammar surface: ${grammarSurface.size} distinct node types produced by the pinned wasm`)
  console.log(`  has import_declaration: ${grammarSurface.has("import_declaration")} | module_declaration: ${grammarSurface.has("module_declaration")} | concept_definition: ${grammarSurface.has("concept_definition")} | requires_clause: ${grammarSurface.has("requires_clause")}`)
  console.log(`\nWATCHED NODE COUNTS (a node exists only if the pinned grammar produced it)`)
  for (const k of WATCHED) {
    const c = nodeCounts[k] ?? 0
    console.log(`  ${k.padEnd(30)} ${String(c).padStart(8)}  files ${String(nodeFiles[k]?.size ?? 0).padStart(5)}${c === 0 ? "   <-- ABSENT" : ""}`)
  }
  console.log("\nINSTRUMENT B — AST-shape probes (the falsifiable instrument for RULED and for a GAP/LOSS verdict)")
  for (const p of probeRows) {
    console.log(`  ${p.id.padEnd(34)} ${String(p.count).padStart(7)}  files ${String(p.files).padStart(5)}`)
    for (const s of p.samples) console.log(`      | ${s.file}:${s.line} ${s.what} ${s.detail}`)
  }
  console.log(`\nevidence: ${outPath}`)
}

await main()