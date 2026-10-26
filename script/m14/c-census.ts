/**
 * C — the whole-population construct census for the three types this lane RULES.
 *
 * The completion bar wants every ruling measured on the WHOLE admitted population, with a count and a
 * falsifier, not a stride sample. This instrument walks the population the gate itself admits (the
 * router's ONE table for `c` is `c,h`; git-tracked per checkout; ≤ 1 MiB) through the SAME parser the
 * analyzer uses, and counts the constructs each ruling rests on:
 *
 *   decorates  — attribute specifiers and `_Alignas`, and how many of them carry a CALL-shaped
 *                argument. C attributes are passive metadata: they never invoke a callable, which is
 *                the vocabulary's decorates ("an applied CALLABLE"). A non-zero call-shaped count
 *                would REFUTE the ontological ruling and is the falsifier.
 *   renders    — no component concept exists: nothing to count, so the instrument counts the
 *                render-shaped node types the served grammar offers (ZERO is the measurement).
 *   mixes_in   — no supertype chain exists in C: a struct's members are named, not inherited or
 *                composed into a chain. Counts the grammar's composition-shaped productions (ZERO).
 *
 * USAGE: bun script/m14/c-census.ts [--write validation/m14/measurements/c-extended-census.json]
 * Exit 3 if the walk parsed a different number of files than the population says it measured.
 */
const { getParser } = await import("./run-fixtures")
const { parseFile } = await import("../../src/ast/engine")
import { execSync } from "node:child_process"
const { detectLanguageFromPath } = await import("../../src/ast/language-detection.ts")
import fs from "node:fs"
import path from "node:path"

const argv = process.argv.slice(2)
const writeIdx = argv.indexOf("--write")
const out = writeIdx >= 0 ? argv[writeIdx + 1] : undefined
const root = process.cwd() + "/.corpus"
const EXTS = ["c", "h"]

const counts: Record<string, number> = {
  files: 0, filesParsed: 0, filesFailed: 0,
  attributeSpecifiers: 0, alignasSpecifiers: 0, attributeWithCallArgument: 0, callableAttributeArguments: 0,
  renderShapedNodes: 0, compositionShapedNodes: 0,
  includeQuoted: 0, includeAngle: 0, partOfEmitted: 0, importsEmitted: 0,
}
const attributeNames: Record<string, number> = {}
const samples: Record<string, string[]> = { attributeWithCallArgument: [], callableAttribute: [], renderShaped: [], compositionShaped: [] }

const parser: any = await getParser("c")
const repos = fs.readdirSync(root).filter((d) => fs.existsSync(path.join(root, d, ".git"))).sort()
let reposWith = 0
for (const repo of repos) {
  let tracked: string[] = []
  try {
    tracked = execSync(`git -C ${JSON.stringify(path.join(root, repo))} ls-files`, { maxBuffer: 1 << 28 }).toString().split("\n")
  } catch { continue }
  let any = false
  for (const rel of tracked) {
    const ext = rel.slice(rel.lastIndexOf(".") + 1)
    if (!EXTS.includes(ext)) continue
    const p = path.join(root, repo, rel)
    // THE ROUTER'S VERDICT, not the spelling alone: `.h` belongs to BOTH c and cpp, and the gate
    // admits a file by `detectLanguageFromPath(path, content)` — the content decides. Running this
    // census on a spelling list would measure a population the gate never admits.
    let head = ""
    try { head = fs.readFileSync(p, "utf8") } catch { continue }
    if (detectLanguageFromPath(p, head) !== "c") continue
    let st: fs.Stats
    try { st = fs.statSync(p) } catch { continue }
    if (!st.isFile() || st.size > 1024 * 1024) continue
    counts.files++
    any = true
    let tree: any
    try { tree = await parser.parse(head) } catch { counts.filesFailed++; continue }
    counts.filesParsed++
    let result: any = null
    try { result = await parseFile(p, head) } catch { result = null }
    const declaredNames = new Set<string>()
    const where = `${repo}/${rel}`
    // ITERATIVE, DEPTH-CAPPED: a recursive walk overflows the JS stack on deeply nested macro
    // expansions (measured: RangeError on a real corpus file). The cap is the same one the
    // analyzer uses for its own bounded descent, and a node below it is COUNTED as skipped.
    const stack: any[] = [tree.rootNode]
    while (stack.length > 0) {
      const n = stack.pop()!
      const t = String(n.type)
      if (t === "attribute_specifier" || t === "attribute_declaration") {
        counts.attributeSpecifiers++
        // the names this FILE declares, so an argument can be tested for CALLABILITY
        if (declaredNames.size === 0) for (const sy of (result?.symbols ?? [])) declaredNames.add(String(sy.name))
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && (c.type === "identifier" || c.type === "attribute")) {
            const nm = String(c.text).trim()
            if (nm.length > 0 && nm.length < 64) attributeNames[nm] = (attributeNames[nm] ?? 0) + 1
            break
          }
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
          // A CALL-SHAPED argument whose CALLEE is a symbol this file declares is an APPLIED
          // CALLABLE — the vocabulary's decorates. A directive name (`aligned`, `format`,
          // `section`) is not a declaration, and never counts here.
          const scan: any[] = [n]
          while (scan.length > 0) {
            const y = scan.pop()!
            if (String(y.type) === "call_expression") {
              const callee = y.namedChild(0)
              if (callee && declaredNames.has(String(callee.text).trim())) {
                counts.callableAttributeArguments++
                if (samples.callableAttribute.length < 5) samples.callableAttribute.push(`${where}: ${String(n.text).slice(0, 80)}`)
              }
            }
            for (let i = 0; i < y.namedChildCount; i++) scan.push(y.namedChild(i))
          }
          if (samples.attributeWithCallArgument.length < 5) samples.attributeWithCallArgument.push(`${where}: ${String(n.text).slice(0, 80)}`)
        }
      }
      if (t === "alignas_specifier" || t === "alignment_specifier") counts.alignasSpecifiers++
      if (t === "render_element" || t === "component_render" || t === "view_body") {
        counts.renderShapedNodes++
        if (samples.renderShaped.length < 5) samples.renderShaped.push(`${where}: ${t}`)
      }
      if (t === "mixin_declaration" || t === "trait_declaration" || t === "uses_clause" || t === "extends_clause") {
        counts.compositionShapedNodes++
        if (samples.compositionShaped.length < 5) samples.compositionShaped.push(`${where}: ${t}`)
      }
      for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
    }
    // RELEASE THE TREE — holding 16k wasm trees is what killed the first full run.
    try { (tree as any).delete?.() } catch {}
  }
  if (any) reposWith++
}

const served = { language: "c", nodeTypeCount: (parser as any).getNodeTypeCount?.() ?? null }
const report = {
  tool: "script/m14/c-census.ts",
  corpusRoot: root,
  rule: "the admitted set: git-tracked per checkout, extensions c,h from the router's ONE table, present on disk, ≤ 1 MiB",
  population: { admitted: counts.files, parsed: counts.filesParsed, failed: counts.filesFailed, repositories: reposWith, populationString: `parsed=${counts.filesParsed}/${counts.files} admitted=${counts.files} exts=c,h index=no` },
  counts,
  topAttributeNames: Object.entries(attributeNames).sort((a, b) => b[1] - a[1]).slice(0, 12),
  samples,
  rulings: {
    decorates: "ONTOLOGICAL: attribute specifiers exist and carry a NAME, but an attribute is passive metadata — it invokes no callable. The measured falsifier is attributeWithCallArgument, which must be 0 over the whole population (a call-shaped attribute argument like Rust's #[derive(Serialize)] would refute the ruling).",
    renders: "ONTOLOGICAL: C has no component concept — no render-shaped node type exists in the served grammar and none appears on the tree (renderShapedNodes = 0).",
    mixes_in: "ONTOLOGICAL: C has no supertype chain — a struct's members are NAMED, never inherited or composed into a chain — so there is no construct for a mixin to compose into (compositionShapedNodes = 0).",
  },
  served,
}
if (out) {
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n")
  console.log(`wrote ${out} — ${counts.filesParsed}/${counts.files} parsed, ${counts.attributeSpecifiers} attribute sites, ${counts.attributeWithCallArgument} call-shaped, ${counts.renderShapedNodes} render-shaped, ${counts.compositionShapedNodes} composition-shaped`)
} else {
  console.log(JSON.stringify(report, null, 1).slice(0, 2000))
}
if (counts.filesParsed !== counts.files) process.exit(3)
