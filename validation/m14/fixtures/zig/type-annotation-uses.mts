/**
 * TYPE-ANNOTATION `uses` — edges published for a DECLARED TYPE, on the `uses` label.
 *
 * ## The defect this measures
 *
 * `isTypePosition` walks up from a `field_expression` and returns TRUE at
 * `parameter` / `container_field` / `function_declaration` / `function_signature`,
 * and FALSE at any `VALUE_BOUNDARY` node — `variable_declaration` is one.
 *
 * But the grammar puts a variable's TYPE ANNOTATION in the SAME node as its
 * initializer:
 *
 *     var test_exe: ?*std.Build.Step.Compile = null;
 *     variable_declaration
 *       identifier      test_exe
 *       field_expression            <-- the annotation
 *       NULL                          <-- the initializer
 *
 * so the walk from the annotation reaches `variable_declaration`, reads it as a
 * value context, and the `uses` edge is emitted for every segment of the type
 * path:
 *
 *     uses build -> Compile   zig_field_access  "?*std.Build.Step.Compile"
 *     uses build -> Step      zig_field_access  "?*std.Build.Step"
 *     uses build -> Build     zig_field_access  "?*std.Build"
 *
 * Three edges, each naming a bare segment of a TYPE. `zigImportAliases` does not
 * rescue them either: the path's root IS the declared `std` alias, but
 * `zigExternalReceiverPath` needs the chain's innermost base to be a bare
 * identifier, and the chain's base is a `nullable_type`, so it returns null.
 *
 * The declared-type pass does not cover it back: it reads parameter types,
 * return types and container-field types, never a variable's own annotation, so
 * the fact is not merely mislabelled — on this shape it is carried NOWHERE.
 *
 * ## The population, and what would overturn it
 *
 * Counted as: a `zig_field_access` `uses` edge whose `line_number` lands on a
 * variable_declaration whose type annotation contains a field_expression AND
 * whose target equals a segment of that annotation.
 *
 * Overturn condition: a corpus in which no variable declaration annotates its
 * type with a dotted path — i.e. the walk never reaches `variable_declaration`
 * from a field_expression that is not also a value read.
 *
 * Usage: npx tsx validation/m14/fixtures/zig/type-annotation-uses.mts [maxFiles]
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { Parser, Language } from "web-tree-sitter"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const ROOT = "/home/ishaq2321/mcp/bb-lanes/zig"
const MAX = Number(process.argv[2] ?? 200)
const REPOS = (process.env.ZIG_REPOS ?? "zig,ghostty,mold,eastwood,duckdb,oven").split(",")

await Parser.init({ locateFile: () => `${ROOT}/node_modules/web-tree-sitter/tree-sitter.wasm` })
const language: any = await Language.load(readFileSync(`${ROOT}/wasm/tree-sitter-zig.wasm`))
const parser = new Parser()
parser.setLanguage(language)

function draw(n: number): string[] {
  const all: string[] = []
  for (const repo of REPOS) {
    const stack = [`${CR}/${repo}`]
    while (stack.length) {
      const d = stack.pop()!
      let ents: string[]
      try { ents = readdirSync(d) } catch { continue }
      for (const e of ents) {
        const p = `${d}/${e}`
        let st
        try { st = statSync(p) } catch { continue }
        if (st.isDirectory()) { if (e !== ".git") stack.push(p) }
        else if (e.endsWith(".zig")) all.push(p.slice(CR.length + 1))
      }
    }
  }
  all.sort()
  const stride = Math.max(1, Math.floor(all.length / n))
  const out: string[] = []
  for (let i = 0; out.length < n && i < all.length; i += stride) out.push(all[i])
  return out
}

/** every field_expression path segment that is part of a variable_declaration's TYPE
 *  annotation, keyed `line\u0000segment`. The annotation is namedChild 1 when the
 *  declaration has an initializer, and the last named child when it does not. */
function annotationSegments(root: any): Map<string, string[]> {
  const hit = new Map<string, string[]>()
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()
    if (n.type === "variable_declaration") {
      const kids: any[] = []
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) kids.push(c) }
      const ann = kids.find((k) => k !== kids[0] && (k.type === "field_expression" || k.type === "identifier" || k.type === "nullable_type" || k.type === "pointer_type" || k.type === "optional_type"))
      if (ann && ann.type !== "identifier") {
        // collect every identifier segment of the annotation
        const segs: string[] = []
        const inner: any[] = [ann]
        while (inner.length) {
          const m = inner.pop()
          if (m.type === "field_expression") {
            const last = m.namedChild(m.namedChildCount - 1)
            if (last && last.type === "identifier") segs.push(String(last.text))
            const b = m.namedChild(0)
            if (b) inner.push(b)
          } else {
            for (let i = 0; i < m.namedChildCount; i++) { const c = m.namedChild(i); if (c) inner.push(c) }
          }
        }
        if (segs.length) {
          const k = `${n.startPosition.row}\u0000`
          if (!hit.has(k)) hit.set(k, [])
          hit.get(k)!.push(...segs)
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  return hit
}

const files = draw(MAX)
let usesTotal = 0, fieldAccessUses = 0, onAnnotation = 0, offAnnotation = 0
let declSitesWithDottedAnnotation = 0, declSites = 0
const examples: any[] = []
const byRepo = new Map<string, number>()

for (const rel of files) {
  const f = `${CR}/${rel}`
  const tree = parser.parse(readFileSync(f, "utf8"))
  if (!tree) continue
  const anns = annotationSegments(tree.rootNode)
  for (const k of anns.keys()) declSitesWithDottedAnnotation++
  const r: any = await parseFile(f, "zig")
  if (!r) continue
  const repo = rel.split("/")[0]!
  for (const e of (r.relationships ?? []) as any[]) {
    const t = String(e.type)
    if (t !== "uses") continue
    usesTotal++
    if (e.metadata?.relationshipType !== "zig_field_access") continue
    fieldAccessUses++
    const line = e.line_number ?? (e.metadata?.line as number | undefined)
    const key = `${(line ?? -1) - 1}\u0000`
    const segs = anns.get(key)
    if (segs && segs.includes(String(e.target))) {
      onAnnotation++
      byRepo.set(repo, (byRepo.get(repo) ?? 0) + 1)
      if (examples.length < 25) examples.push({ file: rel, source: e.source, target: e.target, line, site: e.metadata?.fieldAccessExpression })
    } else offAnnotation++
  }
}

const out = {
  tool: "zig-type-annotation-uses",
  population: `${files.length} stride-sampled .zig files of 3834 admitted`,
  files: files.length,
  usesEdgesTotal: usesTotal,
  zigFieldAccessUses: fieldAccessUses,
  usesOnAVariableTypeAnnotation: onAnnotation,
  usesNotOnAnAnnotation: offAnnotation,
  shareOfFieldAccessUses: fieldAccessUses ? onAnnotation / fieldAccessUses : 0,
  variableDeclarationsWithADottedAnnotation: declSitesWithDottedAnnotation,
  byRepo: Object.fromEntries(byRepo),
  examples,
}
writeFileSync("validation/m14/fixtures/zig/measurements/type-annotation-uses.json", JSON.stringify(out, null, 2))
console.log(JSON.stringify({ ...out, examples: out.examples.slice(0, 10) }, null, 2))
