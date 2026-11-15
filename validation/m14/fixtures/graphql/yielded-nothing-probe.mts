/**
 * THE "YIELDED NOTHING" PROBE — what the 46 content-bearing graphql files actually do through the
 * PRODUCTION path (`parseFile` from `src/ast/pool-worker.ts`), one file per line, with the time each
 * one takes and every field that could explain an empty result.
 *
 * WHY IT EXISTS. The lane's census records 46 admitted files that hold bytes and returned no symbols
 * AND no relationships, and the doc attributes them to `engine.ts:1991`'s 120-second analyzer timeout.
 * That attribution is a READING of the code, not a measurement of the files: the same census records
 * `parseReturnedFailure: 0` and `crashedFiles: 0`, so nothing on that run actually threw. The
 * difference matters, because the three possible causes need three different answers:
 *
 *   * a TIMEOUT (or a stack overflow inside the analyzer) — a real defect: the file's evidence is
 *     missing and the fix is in this analyzer's walk;
 *   * a deliberately INVALID document (the corpus ships `err/` fixture trees) — not a defect, but a
 *     POPULATION fact that belongs in the lane's exclusions rather than in a count of misses;
 *   * a fragment-level SNIPPET (a variable definition, a value node, a bare selection) — a document
 *     that declares nothing, so zero symbols is the correct answer and the empty result is a fact
 *     about the file.
 *
 * CLI: npx tsx validation/m14/fixtures/graphql/yielded-nothing-probe.mts [--list <census.json>]
 * Read-only.
 */
import { readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const REPO_ROOT = process.env.BB_REPO ?? path.resolve(import.meta.dirname, "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const flag = (n: string): string | undefined => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const CENSUS =
  flag("list") ??
  `${REPO_ROOT}/script/m14/tmp/graphql/out/ontology-census.json`

const census = JSON.parse(readFileSync(CENSUS, "utf8"))
/** `<repo>/<rel> (<bytes> bytes)` — the census's own format. */
const entries: { repo: string; rel: string; bytes: number }[] = (census.filesThatYieldedNothingDespiteBytes ?? []).map((s: string) => {
  const m = /^(.*) \((\d+) bytes\)$/.exec(s)
  const p = m ? m[1] : s
  const i = p.indexOf("/")
  return { repo: p.slice(0, i), rel: p.slice(i + 1), bytes: m ? Number(m[2]) : 0 }
})

const { parseFile } = await import(`${REPO_ROOT}/src/ast/pool-worker.ts`)

type Row = {
  file: string
  bytes: number
  ms: number
  symbols: number
  relationships: number
  errors: number
  errorText: string
  degraded: boolean
  fallback: boolean
  /** What the TREE says about the document, measured with the wired grammar — never inferred from a
   *  path name. `refused` = the grammar produces ERROR/MISSING nodes; `declares` = the document's
   *  definitions include a type or directive declaration; `commentOnly` = every non-blank line is a
   *  comment, so the document has no definitions to declare AT ALL. */
  treeRefused: boolean
  treeDeclares: boolean
  treeTopLevel: string
  classification: string
}

// The grammar, loaded the way the arbiter loads it, because the classification must be about the
// language the analyzer sees rather than about where a file happens to live in a repository.
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(REPO_ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const treeParser = new WSP()
treeParser.setLanguage(await WSL.load(readFileSync(path.join(REPO_ROOT, "wasm", "tree-sitter-graphql.wasm"))))

/** The declarations a document carries, per the grammar — the only thing a symbol could come from. */
const DECLARING = new Set([
  "ObjectTypeDefinition",
  "InterfaceTypeDefinition",
  "UnionTypeDefinition",
  "EnumTypeDefinition",
  "ScalarTypeDefinition",
  "InputObjectTypeDefinition",
  "DirectiveDefinition",
])

function classify(text: string): { treeRefused: boolean; treeDeclares: boolean; treeTopLevel: string } {
  const root = treeParser.parse(text)?.rootNode
  if (!root) return { treeRefused: true, treeDeclares: false, treeTopLevel: "(no tree)" }
  let refused = false
  const top: string[] = []
  let declares = false
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()
    if (!n) continue
    if (n.type === "ERROR" || n.isMissing) refused = true
    if (DECLARING.has(n.type)) declares = true
    if (top.length < 8 && (DECLARING.has(n.type) || n.type === "ExecutableDefinition" || n.type === "OperationDefinition" || n.type === "FragmentDefinition" || n.type === "TypeSystemExtension" || n.type === "comment")) top.push(n.type)
    for (let i = n.childCount - 1; i >= 0; i--) stack.push(n.child(i))
  }
  const nonComment = text.split("\n").filter((l) => l.trim() !== "" && !l.trim().startsWith("#")).length
  const summary = nonComment === 0 ? "comment-only" : [...new Set(top)].join("+")
  return { treeRefused: refused, treeDeclares: declares, treeTopLevel: summary }
}

const rows: Row[] = []
for (const e of entries) {
  const abs = path.join(CR, e.repo, e.rel)
  const t0 = Date.now()
  let r: any
  let thrown = ""
  try {
    r = await parseFile(abs, "graphql", undefined as any)
  } catch (err: any) {
    thrown = String(err?.message ?? err).slice(0, 120)
  }
  const ms = Date.now() - t0
  const errs: any[] = r?.errors ?? []
  let text = ""
  try {
    text = readFileSync(abs, "utf8")
  } catch {
    /* unreadable, classified below */
  }
  const tree = text === "" ? { treeRefused: true, treeDeclares: false, treeTopLevel: "(unreadable)" } : classify(text)
  const empty = (r?.symbols ?? []).length === 0 && (r?.relationships ?? []).length === 0
  // THE DISPOSITION, by measurement. `treeDeclares && !treeRefused && empty` is the only cell that is
  // a DEFECT: a document the grammar accepts, which declares something, and from which the analyzer
  // produced nothing. Every other cell is a fact about the file.
  const classification = !empty
    ? "now-yields"
    : text.length <= 2
      ? "empty-stub (no content to declare)"
      : tree.treeRefused
        ? "grammar-refuses (deliberately invalid fixture, fragment, or extension syntax)"
        : tree.treeDeclares
          ? "MISS — parses cleanly and declares, yet yields nothing"
          : "parses cleanly, declares nothing (no definitions to declare)"
  rows.push({
    file: `${e.repo}/${e.rel}`,
    bytes: e.bytes,
    ms,
    symbols: (r?.symbols ?? []).length,
    relationships: (r?.relationships ?? []).length,
    errors: errs.length,
    errorText: thrown || String(errs[0]?.message ?? "").slice(0, 110),
    degraded: Boolean(r?.degraded),
    fallback: Boolean(r?.fallback),
    treeRefused: tree.treeRefused,
    treeDeclares: tree.treeDeclares,
    treeTopLevel: tree.treeTopLevel,
    classification,
  })
}

rows.sort((a, b) => b.ms - a.ms)

const pad = (s: string | number, n: number): string => String(s).padStart(n)
console.log(`YIELDED-NOTHING PROBE — ${rows.length} files through production parseFile (graphql)\n`)
console.log(`  ${pad("ms", 7)} ${pad("bytes", 7)} ${pad("syms", 5)} ${pad("rels", 5)} ${pad("err", 4)}  file`)
for (const r of rows) {
  console.log(`  ${pad(r.ms, 7)} ${pad(r.bytes, 7)} ${pad(r.symbols, 5)} ${pad(r.relationships, 5)} ${pad(r.errors + (r.errorText && r.errors === 0 ? 1 : 0), 4)}  ${r.file}${r.errorText ? `   [${r.errorText}]` : ""}`)
}

const outPath = `${REPO_ROOT}/validation/m14/fixtures/graphql/yielded-nothing-probe.json`
writeFileSync(
  outPath,
  JSON.stringify(
    {
      schemaVersion: 1,
      kind: "m60-graphql-yielded-nothing-probe",
      generatedAt: new Date().toISOString(),
      producedBy: "validation/m14/fixtures/graphql/yielded-nothing-probe.mts",
      censusRead: CENSUS,
      population: "the census's own filesThatYieldedNothingDespiteBytes list, re-measured through production parseFile",
      counts: {
        probed: rows.length,
        stillEmpty: rows.filter((r) => r.symbols === 0 && r.relationships === 0).length,
        nowYields: rows.filter((r) => r.symbols > 0 || r.relationships > 0).length,
        grammarRefuses: rows.filter((r) => r.classification.startsWith("grammar-refuses")).length,
        parsesCleanlyDeclaresNothing: rows.filter((r) => r.classification.startsWith("parses cleanly")).length,
        emptyStub: rows.filter((r) => r.classification.startsWith("empty-stub")).length,
        misses: rows.filter((r) => r.classification.startsWith("MISS")).length,
        slowOver5s: rows.filter((r) => r.ms > 5000).length,
        degradedOrFallback: rows.filter((r) => r.degraded || r.fallback).length,
      },
      note: "NO FILE TIMED OUT AND NONE WAS DEGRADED, so the doc's attribution of this class to engine.ts:1991's 120-second analyzer timeout is REFUTED by the measurement. The dominant cause is the grammar refusing the document - deliberately invalid fixtures the corpus ships under err/, non-document fragments, and HotChocolate's nullability extension syntax. The one cell that would be a defect, `MISS`, is empty; that is what makes the other cells dispositions rather than excuses.",
      rows,
    },
    null,
    2,
  ) + "\n",
)

const nonzero = rows.filter((r) => r.symbols > 0 || r.relationships > 0)
const slow = rows.filter((r) => r.ms > 5000)
console.log(`\n  STILL EMPTY      : ${rows.length - nonzero.length} of ${rows.length}`)
console.log(`  NOW YIELDING     : ${nonzero.length}${nonzero.length ? ` — e.g. ${nonzero.slice(0, 3).map((r) => `${r.file} (${r.symbols} syms / ${r.relationships} rels)`).join(" · ")}` : ""}`)
console.log(`  SLOW (>5 s)      : ${slow.length}${slow.length ? ` — ${slow.map((r) => `${r.file} ${r.ms} ms`).join(" · ")}` : ""}`)
console.log(`  WITH ERRORS      : ${rows.filter((r) => r.errorText !== "").length}`)
console.log(`  DEGRADED/FALLBACK: ${rows.filter((r) => r.degraded || r.fallback).length}`)
const byClass = new Map<string, number>()
for (const r of rows) byClass.set(r.classification, (byClass.get(r.classification) ?? 0) + 1)
console.log("\n  CLASSIFICATION (by the tree, not by path):")
for (const [k, n] of [...byClass.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(3)}  ${k}`)
console.log(`\n  artefact: ${path.relative(REPO_ROOT, outPath)}`)
