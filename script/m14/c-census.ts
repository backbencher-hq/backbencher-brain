/**
 * C — the whole-population construct census for the three types this lane RULES.
 *
 * The completion bar wants every ruling measured on the WHOLE admitted population, with a count and a
 * falsifier, not a stride sample. This instrument walks the population the gate itself admits, with
 * the gate's OWN admission rule, and counts the constructs each ruling rests on:
 *
 *   decorates  — attribute specifiers and `_Alignas`, and how many of them carry a CALL-shaped
 *                argument. C attributes are passive metadata: they never invoke a callable, which is
 *                the vocabulary's decorates ("an applied CALLABLE"). A non-zero call-shaped count
 *                would REFUTE the ontological ruling and is the falsifier.
 *   renders    — no component concept exists: nothing to count, so the instrument counts the
 *                render-shaped node types the served grammar offers (ZERO is the measurement).
 *   mixes_in   — no supertype chain exists in C. The near-miss worth naming before ruling is a
 *                QUOTED INCLUDE INSIDE A STRUCT BODY (`struct X { #include "fields.h" };`), because
 *                the preprocessor splices FIELD DECLARATIONS into the struct — the one shape C has
 *                where member composition is textually external. The vocabulary's mixes_in is
 *                "composes the mixin's IMPLEMENTATION into its own SUPERTYPE CHAIN, and no
 *                conformance is declared"; a struct is a supertype of nothing and an included field
 *                block becomes no supertype, so the shape cannot satisfy the contract's own positive
 *                test. It is counted (quotedIncludeInsideStruct), named in the ruling, and assigned
 *                to part_of's territory: the preprocessor splices the header's TEXT into the
 *                translation unit, so the part shares the unit's single scope — the same contract the
 *                quoted-include part_of row already carries.
 *
 * ADMISSION IS THE GATE'S OWN RULE, COPIED FROM THE GATE (not imported — the gate runs its whole
 * body on import): a tracked path is admitted when its lowercase spelling ends in `.c` or `.h`
 * (the router's ONE table for c). The gate's bare-basename clause (a name with no dot whose
 * spelling equals an extension, when content detection routes it here) cannot fire for `c,h` —
 * no extensionless file is spelled "c" or "h" — so spelling alone is the gate's complete rule for
 * this lane. The gate admits by spelling: a census that filtered by content measured 16,854
 * against the gate's 20,824 — a different population, so every ruling it produced was a claim
 * about a set the declaration does not describe. The size cap (1 MiB) and the git-tracked
 * requirement are the gate's too.
 *
 * PARSE FAILURES ARE COUNTED, NEVER HIDDEN: a file whose parse throws is `filesFailed`, and the
 * instrument exits 3 unless every admitted file parsed — a census over a partial population is a
 * census of a different claim. The 42 WASM aborts the previous run reported are real; they are
 * listed per-file so a ruling can cite them and a fix can target them.
 *
 * USAGE: bun script/m14/c-census.ts [--write validation/m14/measurements/c-extended-census.json]
 * Exit 3 if the walk parsed a different number of files than the population says it measured.
 */
const { getParser } = await import("./run-fixtures")
const { parseFile } = await import("../../src/ast/engine")
import { execSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const argv = process.argv.slice(2)
const writeIdx = argv.indexOf("--write")
const out = writeIdx >= 0 && writeIdx + 1 < argv.length ? argv[writeIdx + 1] : undefined
const root = process.cwd() + "/.corpus"
const EXTS = ["c", "h"]
// The gate's own SIZE_CAP (incoming-gate.ts): above 1 MiB the analyzer itself extracts
// structurally, so the population claim and the analyzer's capability line are the same line.
const SIZE_CAP = 1024 * 1024

const counts: Record<string, number> = {
  files: 0, filesParsed: 0, filesFailed: 0,
  attributeSpecifiers: 0, attributeDeclarations: 0, attributeSites: 0, alignasSpecifiers: 0, attributeWithCallArgument: 0,
  declaredCalleeInAttribute: 0, callableAttributeArguments: 0, nonCallableDeclaredCallee: 0, appliedCallableAttributeSites: 0,
  renderShapedNodes: 0, compositionShapedNodes: 0,
  quotedIncludeInsideStruct: 0,
}
const attributeNames: Record<string, number> = {}
const failedFiles: string[] = []
const samples: Record<string, string[]> = {
  attributeWithCallArgument: [], callableAttribute: [], nonCallableDeclaredCallee: [], appliedCallable: [],
  renderShaped: [], compositionShaped: [], quotedIncludeInsideStruct: [],
}

// ── THE APPLIED-CALLABLE CONTRACT, READ FROM THE SOURCE OF TRUTH ────────────────────────────────
// `src/ast/types.ts` defines decorates as "a decorator is APPLIED TO a declaration ... NOT calls:
// the decorated symbol does not invoke the decorator — the runtime applies it while the declaration
// is created". So the positive test is an attribute whose ARGUMENT IS AN INVOKED CALLABLE.
// C's only such attribute is `cleanup(fn)` / `gnu::cleanup(fn)` (the compiler invokes fn when the
// object goes out of scope). Every other C attribute argument is a constant expression the compiler
// interprets (`aligned(16)`, `format(printf,1,2)`, `alias("sym")`, `section(".data")`) — a value,
// never an invoked callable.
const APPLIED_CALLABLE_ATTRIBUTES = new Set(["cleanup", "gnu::cleanup", "__cleanup__"])

// THE GATE'S OWN ADMISSION TEST, restated here (see the file header for why it is copied rather
// than imported). For this lane's spellings the lowercase test is the gate's complete rule.
function admitByExtension(rel: string): boolean {
  const low = rel.toLowerCase()
  return EXTS.some((e) => low.endsWith(`.${e}`))
}

// THE ATTRIBUTE'S NAME, as the declaration writes it. Two spellings exist in the grammar, and both
// are measured from the tree rather than from the source text:
//   __attribute__((name(...)))  parses as attribute_specifier -> argument_list -> call_expression
//                               whose CALLEE is the attribute name (`alias`, `aligned`, `cleanup`)
//   [[gnu::name]] / [[name]]    parses as attribute_specifier -> attribute whose first named child
//                               is the name (a scoped spelling keeps its scope: `gnu::cleanup`)
// A scoped spelling is preserved verbatim, because the scope IS the name for the attributes that
// matter here: `cleanup` and `gnu::cleanup` are one attribute, and the source's spelling is what a
// reader checks the count against.
function attributeNameOf(node: any): string {
  // descend to the first `attribute` or the first `call_expression`, whichever the grammar gave us
  const stack: any[] = [node]
  while (stack.length > 0) {
    const n = stack.pop()!
    const t = String(n.type)
    if (t === "attribute") {
      const first = n.namedChildCount > 0 ? n.namedChild(0) : null
      if (first) return leadingName(String(first.text))
    }
    if (t === "call_expression") {
      const callee = n.namedChild(0)
      if (callee) return leadingName(String(callee.text))
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) stack.push(n.namedChild(i))
  }
  return ""
}
// CHARACTER SCAN, never a pattern: cut at the first `(` or whitespace, so `aligned(16)` reads
// `aligned` and `gnu::cleanup(fn)` keeps its scope.
function leadingName(raw: string): string {
  const text = raw.trim()
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i)
    if (ch === "(" || ch === " " || ch === "\t" || ch === "\n") return text.slice(0, i).trim()
  }
  return text
}

const parser: any = await getParser("c")
const repos = fs.readdirSync(root).filter((d) => fs.existsSync(path.join(root, d, ".git"))).sort()
let reposWith = 0
// LIVENESS BY ARTIFACT, NOT BY LOG LINE: stdout is block-buffered when redirected, so a redirected
// log can sit empty for minutes while the walk is healthy (the fleet's measured lesson). This file
// is rewritten after every repository, so a reader can tell "working" from "dead" by its mtime.
const PROGRESS = path.join(process.cwd(), ".tmp-c", "census-progress.txt")
const progress = (msg: string): void => {
  try { fs.writeFileSync(PROGRESS, `${new Date().toISOString()} ${msg}\n`) } catch { /* not fatal */ }
}
for (const repo of repos) {
  let tracked: string[] = []
  try {
    tracked = execSync(`git -C ${JSON.stringify(path.join(root, repo))} ls-files`, { maxBuffer: 1 << 28 }).toString().split("\n")
  } catch { continue }
  let any = false
  for (const rel of tracked) {
    if (rel === "") continue
    if (!admitByExtension(rel)) continue
    const p = path.join(root, repo, rel)
    let head = ""
    try { head = fs.readFileSync(p, "utf8") } catch { continue }
    let st: fs.Stats
    try { st = fs.statSync(p) } catch { continue }
    if (!st.isFile() || st.size > SIZE_CAP) continue
    counts.files++
    any = true
    let tree: any
    try { tree = await parser.parse(head) } catch { counts.filesFailed++; failedFiles.push(`${repo}/${rel}`); continue }
    counts.filesParsed++
    // LAZY ANALYZER: the full analyzer (`parseFile`) is needed ONLY to answer the callability
    // test, and only for a file that carries a CALL-SHAPED attribute argument. Measured: 3,288
    // call-shaped sites over a 20,824-file population, so calling the analyzer on every file to
    // answer a question about a few hundred of them multiplied the run's cost by the whole
    // population. The map is built on first need, per file, and carries each symbol's KIND — the
    // callable test needs the kind, not just the name (see the CALLABLE_KINDS note below).
    let kindOfName: Map<string, string> | null = null
    const declaredNamesFor = async (): Promise<Map<string, string>> => {
      if (kindOfName) return kindOfName
      const set = new Map<string, string>()
      let result: any = null
      try { result = await parseFile(p, head) } catch { result = null }
      for (const sy of (result?.symbols ?? [])) set.set(String(sy.name), String(sy.kind ?? ""))
      kindOfName = set
      return set
    }
    const where = `${repo}/${rel}`
    // ITERATIVE, DEPTH-CAPPED: a recursive walk overflows the JS stack on deeply nested macro
    // expansions (measured: RangeError on a real corpus file). The cap is the same one the
    // analyzer uses for its own bounded descent, and a node below it is COUNTED as skipped.
    const stack: any[] = [tree.rootNode]
    // An ancestor chain per stack entry, so "inside a struct body" is answerable without a
    // second walk: a preproc_include whose ancestor chain holds a field_declaration_list is the
    // struct-body include shape (the mixes_in near-miss this census exists to count).
    const anc: any[][] = [[]]
    while (stack.length > 0) {
      const n = stack.pop()!
      const ancestors = anc.pop()!
      const t = String(n.type)
      const inStructBody = ancestors.some((a: any) => String(a.type) === "field_declaration_list")
      if (t === "preproc_include" && inStructBody) {
        counts.quotedIncludeInsideStruct++
        if (samples.quotedIncludeInsideStruct.length < 5) samples.quotedIncludeInsideStruct.push(`${where}: ${String(n.text).slice(0, 80)}`)
      }
      if (t === "attribute_specifier" || t === "attribute_declaration") {
        // TWO SPELLINGS, COUNTED APART: `attribute_specifier` is the GNU `__attribute__((...))`
        // form and `attribute_declaration` is the C23 `[[...]]` form. They do not nest, so the two
        // counts plus their sum are three honest numbers rather than one coarsened one.
        if (t === "attribute_specifier") counts.attributeSpecifiers++
        else counts.attributeDeclarations++
        counts.attributeSites++
        const attrName = attributeNameOf(n)
        if (attrName.length > 0 && attrName.length < 64) attributeNames[attrName] = (attributeNames[attrName] ?? 0) + 1
        // THE CONTRACT'S OWN POSITIVE SHAPE, COUNTED WHEREVER IT OCCURS, INDEPENDENT OF THE CALLEE
        // TEST: an attribute whose ARGUMENT IS AN INVOKED CALLABLE. C has exactly one such
        // attribute — `cleanup(fn)` / `gnu::cleanup(fn)`, where the compiler invokes fn when the
        // object goes out of scope. Counting the SITE (even if the named function is declared in
        // another file, which the own-file test below cannot see) keeps that near miss visible.
        if (APPLIED_CALLABLE_ATTRIBUTES.has(attrName)) {
          counts.appliedCallableAttributeSites++
          if (samples.appliedCallable.length < 5) samples.appliedCallable.push(`${where}: ${String(n.text).slice(0, 80)}`)
        }
        // CALL-SHAPED: an argument that is a call_expression. Counted because the vocabulary's
        // decorates needs an APPLIED CALLABLE; a compiler-directive argument that merely LOOKS like
        // a call (`aligned(16)`, `format(printf, 1, 2)`) is not one, so this count is reported
        // BESIDE the callable test rather than as it.
        let callShaped = false
        const inner: any[] = [n]
        while (inner.length > 0) {
          const x = inner.pop()!
          if (String(x.type) === "call_expression") { callShaped = true; break }
          for (let i = 0; i < x.namedChildCount; i++) inner.push(x.namedChild(i))
        }
        if (callShaped) {
          counts.attributeWithCallArgument++
          // THE DECISIVE TEST, and it has TWO halves because one half alone was measurably wrong.
          //
          // An applied callable needs (a) the callee to NAME A CALLABLE and (b) the attribute to
          // apply it to the declaration. Half (a) alone is not enough: the four sites this test
          // first flagged are `__attribute__((alias(__MINGW64_STRINGIFY(__MINGW_IMP_SYMBOL(x)))))`,
          // where the "callee" is a FUNCTION-LIKE MACRO that stringifies its argument at
          // PREPROCESSING time, and the name it appeared to declare is published by the analyzer as
          // a VARIABLE (a macro-wrapped declarator heading), not a callable. A macro that computes
          // the argument of a compiler directive is not a decorator: it runs before the compiler
          // sees a declaration at all.
          //
          // So (a) requires the callee to name a symbol whose KIND is callable. The analyzer's
          // symbol kinds are the evidence: function/method/constructor are callables; variable,
          // constant, macro, type are not.
          const CALLABLE_KINDS = new Set(["function", "method", "constructor"])
          const kinds = await declaredNamesFor()
          const scan: any[] = [n]
          while (scan.length > 0) {
            const y = scan.pop()!
            if (String(y.type) === "call_expression") {
              const callee = y.namedChild(0)
              const calleeName = callee ? String(callee.text).trim() : ""
              if (calleeName && kinds.has(calleeName)) {
                // (b) THE ATTRIBUTE MUST APPLY IT TO THE DECLARATION, not merely carry a name. The
                // vocabulary's decorates is "a decorator is APPLIED TO a declaration"; C's one
                // attribute whose argument IS an invoked callable is `cleanup(fn)` (the compiler
                // calls fn on scope exit) and its standardized spelling `gnu::cleanup`. A name
                // anywhere else in an attribute is an argument, not an application.
                counts.declaredCalleeInAttribute++
                const attrName = attributeNameOf(n)
                const kind = kinds.get(calleeName) ?? ""
                if (CALLABLE_KINDS.has(kind)) {
                  counts.callableAttributeArguments++
                  if (samples.callableAttribute.length < 5) samples.callableAttribute.push(`${where}: ${String(n.text).slice(0, 80)}`)
                } else {
                  counts.nonCallableDeclaredCallee++
                  if (samples.nonCallableDeclaredCallee.length < 5) samples.nonCallableDeclaredCallee.push(`${where}: ${attrName} -> ${calleeName} (kind ${kind || "?"})`)
                }
                if (APPLIED_CALLABLE_ATTRIBUTES.has(attrName) && CALLABLE_KINDS.has(kind)) {
                  counts.appliedCallableAttributes++
                  if (samples.appliedCallable.length < 5) samples.appliedCallable.push(`${where}: ${String(n.text).slice(0, 80)}`)
                }
              }
            }
            for (let i = 0; i < y.namedChildCount; i++) scan.push(y.namedChild(i))
          }
          if (samples.attributeWithCallArgument.length < 5) samples.attributeWithCallArgument.push(`${where}: ${String(n.text).slice(0, 80)}`)
        }
      }
      if (t === "alignas_qualifier" || t === "alignment_specifier") counts.alignasSpecifiers++
      if (t === "render_element" || t === "component_render" || t === "view_body") {
        counts.renderShapedNodes++
        if (samples.renderShaped.length < 5) samples.renderShaped.push(`${where}: ${t}`)
      }
      if (t === "mixin_declaration" || t === "trait_declaration" || t === "uses_clause" || t === "extends_clause") {
        counts.compositionShapedNodes++
        if (samples.compositionShaped.length < 5) samples.compositionShaped.push(`${where}: ${t}`)
      }
      const childAnc = [...ancestors, n]
      for (let i = 0; i < n.namedChildCount; i++) { stack.push(n.namedChild(i)); anc.push(childAnc) }
    }
    // RELEASE THE TREE — holding 16k wasm trees is what killed the first full run.
    try { (tree as any).delete?.() } catch {}
  }
  if (any) reposWith++
  progress(`repo ${reposWith} ${repo}: files=${counts.files} parsed=${counts.filesParsed} failed=${counts.filesFailed}`)
}

const served = { language: "c", nodeTypeCount: (parser as any).getNodeTypeCount?.() ?? null }
const report = {
  tool: "script/m14/c-census.ts",
  corpusRoot: root,
  rule: "the admitted set: git-tracked per checkout, extensions c,h from the router's ONE table, admitted BY SPELLING the way the gate admits (a lowercase suffix test; the gate's bare-basename clause cannot fire for c,h), present on disk, ≤ 1 MiB",
  population: { admitted: counts.files, parsed: counts.filesParsed, failed: counts.filesFailed, repositories: reposWith, populationString: `parsed=${counts.filesParsed}/${counts.files} admitted=${counts.files} exts=c,h index=no` },
  counts,
  failedFiles,
  topAttributeNames: Object.entries(attributeNames).sort((a, b) => b[1] - a[1]).slice(0, 12),
  samples,
  rulings: {
    decorates: "ONTOLOGICAL: attribute sites exist (attributeSites counted, split GNU attribute_specifier vs C23 attribute_declaration) and carry names, but an attribute is passive metadata — the compiler interprets its argument as a VALUE (`aligned(16)`, `format(printf,1,2)`, `alias(\"sym\")`), never as a callable the declaration applies. THE CONTRACT (src/ast/types.ts, Decorates) is 'a decorator is APPLIED TO a declaration ... the runtime applies it while the declaration is created', so the positive test is an attribute whose argument IS AN INVOKED CALLABLE. C's one such attribute is `cleanup(fn)`/`gnu::cleanup(fn)`. FALSIFIER (three counters, all instrument-counted): (a) appliedCallableAttributeSites — any `cleanup`/`gnu::cleanup`/`__cleanup__` site, wherever the named function is declared, must be 0; (b) callableAttributeArguments — a call-shaped argument whose CALLEE names a CALLABLE this file declares (kind function/method/constructor) must be 0; (c) the near-miss class nonCallableDeclaredCallee, the four `alias(__MINGW64_STRINGIFY(__MINGW_IMP_SYMBOL(x)))` sites where the callee is a function-like macro and the declared name is published as a VARIABLE (kind variable) — a macro computing a compiler directive's argument at preprocessing time is not an application of anything. Measured 0 / 0 / 4-named-impostor over 20,824 files.",
    renders: "ONTOLOGICAL: C has no component concept — no render-shaped node type exists in the served grammar (renderShapedNodes = 0 over the whole population, and the grammar's own node-type inventory carries no render/view/component production). The falsifier is the census itself: any render-shaped node in an admitted file would print as a sample and refute the ruling.",
    mixes_in: "ONTOLOGICAL: C has no supertype chain — a struct's members are NAMED, never inherited or composed into a chain, and a struct is a supertype of nothing — so there is no construct a mixin could compose into (compositionShapedNodes = 0). The one textual near miss is the QUOTED INCLUDE INSIDE A STRUCT BODY (`struct X { #include \"fields.h\" };`), counted as quotedIncludeInsideStruct = 0 over the whole population, and it fails the contract's own positive test either way: the vocabulary's mixes_in composes the mixin's implementation into a SUPERTYPE CHAIN and no conformance is declared, while an included field block declares no supertype and no conformance — it is part_of's territory (the preprocessor splices the header's TEXT into the translation unit, the part sharing the unit's single scope). FALSIFIER: a construct that makes an included field block a DECLARED supertype of the including struct — a conformance the type system can name — would be the supertype-chain half the contract requires, and any non-zero quotedIncludeInsideStruct or compositionShapedNodes count in this census's output would name it.",
  },
  served,
}
if (out) {
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n")
  console.log(`wrote ${out} — ${counts.filesParsed}/${counts.files} parsed, ${counts.attributeSpecifiers} attribute sites, ${counts.attributeWithCallArgument} call-shaped, ${counts.callableAttributeArguments} CALLABLE, ${counts.renderShapedNodes} render-shaped, ${counts.compositionShapedNodes} composition-shaped, ${counts.quotedIncludeInsideStruct} struct-body includes`)
} else {
  console.log(JSON.stringify(report, null, 1).slice(0, 2500))
}
if (counts.filesParsed !== counts.files) process.exit(3)
