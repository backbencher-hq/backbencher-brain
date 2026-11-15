/**
 * GraphQL ANALYZER ABLATION — which part of the analyzer costs what.
 *
 * `perf-attribution.mts` established that the new analyzer is ~3x slower than
 * the one it replaced on the GitHub public schema (1,145 ms vs 299 ms under the
 * same wasm). A guess about the cause would be worthless, so this probe rebuilds
 * the analyzer with ONE cost removed at a time and times each variant on the
 * same tree, in the same process, best of 3.
 *
 * Each variant is a real code deletion, not a flag, so a variant that is fast
 * tells you the deleted work was the cost. The `text` ablation is the one the
 * hand-analysis suspected first: `node.text` in web-tree-sitter walks the node's
 * span out of the source buffer on every access, and this analyzer reads it once
 * per field (`rawType`), once per description, and once per directive argument.
 */
import * as fs from "fs"
import * as path from "path"
import { CORPORA, GQL, OUT, ROOT } from "../paths.mts"

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new ParserClass()
parser.setLanguage(await Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-graphql.wasm"))))

const SRC = fs.readFileSync(path.join(ROOT, "src/ast/real-graphql-analyzer.ts"), "utf8")
const WORK = path.join(GQL, "mutants")
fs.mkdirSync(WORK, { recursive: true })

const onlyIdx0 = process.argv.indexOf("--variant")
const only0 = onlyIdx0 >= 0 ? process.argv[onlyIdx0 + 1] : undefined
const files = process.argv.slice(2).filter((a) => a !== only0 && !a.startsWith("--"))
if (files.length === 0) files.push(`${CORPORA}/graphql-js/benchmark/github-schema.graphql`)
const trees = files.map((f) => ({ f, src: fs.readFileSync(f, "utf8"), lines: fs.readFileSync(f, "utf8").split("\n").length }))
for (const t of trees) t.tree = parser.parse(t.src)

interface Variant {
  id: string
  /** what is removed, in the reviewer's words */
  removes: string
  edits: Array<[string, string]>
}

const VARIANTS: Variant[] = [
  {
    id: "baseline",
    removes: "nothing — the analyzer as shipped",
    edits: [],
  },
  {
    id: "no-node-text",
    removes: "every `node.text` read (rawType, the description source, a directive argument's constant value)",
    edits: [[`...(typeNode ? { rawType: typeNode.text } : {}),`, `...(typeNode ? {} : {}),`],
            [`...(typeNode ? { rawType: typeNode.text, nullable: !this.isNonNullType(typeNode) } : {}),`, `...(typeNode ? { nullable: !this.isNonNullType(typeNode) } : {}),`],
            [`          if (argName && value) args[argName] = value.text`, `          if (argName && value) args[argName] = "?"`],
            [`    const raw = sv.text`, `    const raw = '""'`]],
  },
  {
    id: "no-description-of",
    removes: "the Description read + §2.9.4 unquote/dedent on every described symbol",
    edits: [[`  private descriptionOf(node: Node): string | undefined {`, `  private descriptionOf(node: Node): string | undefined {\n    if (node) return undefined // ablation: no description extraction`]],
  },
  {
    id: "no-directive-applications",
    removes: "the Directives scan on every declaration (findChild + per-directive findChild + childrenOfType)",
    edits: [[`    const directives = this.findChild(node, (n) => n.type === "Directives")`, `    const directives = null // ablation: no directive scan`]],
  },
  {
    id: "no-has-extension-of",
    removes: "the per-scalar-definition top-level rescan that records `extended`",
    edits: [[`          if (t === "ScalarTypeDefinition" && this.hasExtensionOf(node, "ScalarTypeExtension", name)) {`, `          if (false) {`]],
  },
  {
    id: "no-top-level-declaration-filter",
    removes: "the final per-symbol `isTopLevelDeclaration` pass that builds `exports`",
    edits: [[`      if (!this.isTopLevelDeclaration(s)) continue`, `      if (true) continue // ablation: no exports filter`]],
  },
  {
    id: "no-collect-named-types",
    removes: "the subtree walk that finds every NamedType in the nested implements/union rules (direct children only)",
    edits: [[`  private collectNamedTypes(node: Node): Array<{ name: string; node: Node }> {
    const out: Array<{ name: string; node: Node }> = []
    const seen = new Set<string>()`, `  private collectNamedTypes(node: Node): Array<{ name: string; node: Node }> {
    const out: Array<{ name: string; node: Node }> = []
    const seen = new Set<string>()
    if (node) { const c = node.namedChild(0); if (c && c.type === "NamedType") { const n = this.nameOf(c); if (n) out.push({ name: n, node: c }); } return out } // ablation: direct children only`]],
  },
  {
    id: "no-relationship-metadata",
    removes: "the metadata object built for every relationship (the spread + relationshipRole key)",
    edits: [[`      relationships.push({
        source,
        target,
        type,
        confidence: 1,
        line_number: line,
        metadata: { ...metadata, relationshipRole: role },
      })`, `      relationships.push({ source, target, type, confidence: 1, line_number: line, metadata: { relationshipRole: role } }) // ablation: no metadata spread`]],
  },
]

async function load(source: string, tag: string) {
  const file = path.join(WORK, `abl-${tag}.ts`)
  fs.writeFileSync(file, source.replace('from "./engine"', `from "${ROOT}/src/ast/engine"`))
  const mod: any = await import(`${file}?v=${tag}-${Date.now()}`)
  return mod.RealGraphqlAnalyzer
}

const only = only0
const results: any[] = []
for (const v of VARIANTS) {
  if (only && v.id !== only) continue
  let src = SRC
  let applied = true
  for (const [find, repl] of v.edits) {
    if (!src.includes(find)) {
      applied = false
      console.log(`  !! ${v.id}: anchor not found -> ${JSON.stringify(find.slice(0, 64))}`)
      break
    }
    src = src.replace(find, repl)
  }
  let best = Number.MAX_SAFE_INTEGER
  let facts = 0
  if (applied) {
    const A = await load(src, v.id)
    const REPS = Number(process.env.ABL_REPS ?? 3)
    for (let i = 0; i < REPS; i++) {
      const t0 = Date.now()
      for (const t of trees) {
        const r: any = new A().analyze(t.tree.rootNode, t.src, t.f)
        facts = r.symbols.length + r.relationships.length
      }
      const ms = Date.now() - t0
      if (ms < best) best = ms
    }
  }
  const totalLines = trees.reduce((a, t) => a + t.lines, 0)
  results.push({ id: v.id, removes: v.removes, applied, ms: applied ? best : null, facts, lines: totalLines })
  if (only && applied) {
    console.log(JSON.stringify({ variant: v.id, ms: best, facts, lines: totalLines }))
    fs.writeFileSync(path.join(OUT, `abl-${v.id}.json`), JSON.stringify({ variant: v.id, ms: best, facts, lines: totalLines }, null, 2))
    fs.rmSync(path.join(WORK, `abl-${v.id}.ts`), { force: true })
    process.exit(0)
  }
  if (applied) {
    const base = results[0].ms
    console.log(
      `${v.id.padEnd(28)} ${String(best).padStart(5)}ms  facts=${String(facts).padStart(5)}  ` +
        `${Math.round(totalLines / best * 1000).toLocaleString()} lines/s  ` +
        `delta=${best - base >= 0 ? "+" : ""}${best - base}ms` +
        (v.id === "baseline" ? "   (reference)" : `   [removes: ${v.removes.slice(0, 60)}]`),
    )
  }
}

const base = results[0].ms
console.log(`\n=== ablation, sorted by time SAVED (baseline ${base}ms) ===`)
for (const r of results.filter((x) => x.applied && x.id !== "baseline").sort((a, b) => a.ms - b.ms)) {
  const saved = base - r.ms
  const pct = Math.round((saved / base) * 100)
  console.log(`  ${r.id.padEnd(28)} saved ${String(saved).padStart(5)}ms  (${String(pct).padStart(3)}% of the analyzer)  ${r.removes.slice(0, 90)}`)
}
fs.writeFileSync(path.join(OUT, "perf-ablation.json"), JSON.stringify({ generatedAt: new Date().toISOString(), files, baselineMs: base, results }, null, 2))
for (const v of VARIANTS) fs.rmSync(path.join(WORK, `abl-${v.id}.ts`), { force: true })
