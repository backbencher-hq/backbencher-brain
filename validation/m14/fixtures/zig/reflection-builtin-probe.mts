/**
 * ZIG REFLECTION-BUILTIN CENSUS — `@hasDecl` and `@field`, counted on the parse tree.
 *
 * ## The question
 *
 * Zig can name a container's declaration as a STRING, not as an identifier:
 *
 *     if (@hasDecl(S, "a")) {}
 *     const v = @field(S, "b");
 *
 * Both are `references` in the ordinary sense — the code reads a declaration that
 * exists — and the shared `references` type is what this lane already emits for a
 * declared type read as an identifier. The analyzer's source contains no `hasDecl`
 * and no `@field` (measured: 0 occurrences of either), so either the corpus never
 * uses them — instrument B, a parse-tree count of zero, RULED — or the corpus uses
 * them and this lane is not reading them, which is a GAP.
 *
 * ## Why a tree walk and not a text search
 *
 * `@hasDecl` can appear in a comment, in a doc string, in a test that asserts the
 * compiler REJECTS it, and in a string literal. A text count cannot tell those
 * apart, so this probe counts `builtin_function` nodes with a `builtin_identifier`
 * child, which is the only shape on which the builtin is actually CALLED.
 *
 * ## What it reports
 *
 *   - occurrences per builtin, and the files they came from
 *   - for each occurrence, the container argument and the named declaration
 *   - whether the named declaration is PUBLISHED in the same file, which is what
 *     decides whether a `references` edge for it could resolve at both ends
 *
 * ## Why this is sharded, and why the shard count is not decoration
 *
 * A raw `parser.parse()` in one long process **throws an uncatchable-looking wasm
 * `RuntimeError: Aborted()` on 1,708 of the 3,848 corpus files** — measured, 44.4%. The
 * first draft of this probe ran unsharded, caught each one, and reported 784 occurrences
 * over the 2,140 files that survived: a count over 55.6% of the corpus presented as if
 * it were a count over all of it. `parseFile` from `src/ast/pool-worker.ts` parses all
 * 3,834 admitted files, so the loss is this probe's process lifetime, not the grammar's
 * reach. Sharding is therefore what makes the number a total rather than a floor, and
 * the merged report states the coverage it actually achieved.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/zig/reflection-builtin-probe.mts --shard N --shards M --out p
 *   python3 validation/m14/fixtures/zig/reflection-merge.py <expected-shards> <out.json>
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { Parser, Language } from "web-tree-sitter"

const ROOT = path.resolve(process.cwd())
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const arg = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const SAMPLE = Number(arg("sample", "0"))
const SHARD = Number(arg("shard", "-1"))
const SHARDS = Number(arg("shards", "1"))
const OUT = arg("out", "")

await Parser.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const language: any = await Language.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-zig.wasm")))
const parser = new Parser()
parser.setLanguage(language)

const BUILTINS = new Set(["@hasDecl", "@field"])

function walk(dir: string, acc: string[]): string[] {
  let ents: import("node:fs").Dirent[]
  try {
    ents = readdirSync(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const e of ents) {
    if (e.name === ".git" || e.name === "zig-cache" || e.name === "zig-out" || e.name === ".zig-cache") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (e.isFile() && e.name.endsWith(".zig")) acc.push(p)
  }
  return acc
}

const all = walk(CR, []).sort()
const corpusFiles = all.length
const files =
  SHARD >= 0 && SHARDS > 1
    ? all.filter((_, i) => i % SHARDS === SHARD)
    : SAMPLE > 0 && SAMPLE < all.length
      ? all.slice(0, SAMPLE)
      : all

type Occ = {
  builtin: string
  file: string
  line: number
  col: number
  container: string | null
  name: string | null
  namePublishedInFile: boolean | null
}

/**
 * The declaration names the file PUBLISHES, as one pass over an ALREADY PARSED tree.
 *
 * This deliberately takes the tree rather than the source. A first draft parsed each
 * file twice — once to look for the builtins, once to collect the declared names — and
 * a second `parser.parse()` of the same source in the same process is the exact shape
 * this lane has already measured to trip the wasm allocator
 * (`trap-second-parse.ts`), which killed the run on the first large file with an
 * uncatchable `RuntimeError: Aborted()`. One parse, two facts.
 */
function publishedNames(root: any): Set<string> {
  const names = new Set<string>()
  const visit = (n: any) => {
    // A declaration name is an `identifier` child of a *_declaration node.
    if (n.type === "identifier" && n.parent) {
      const pt = n.parent.type
      if (pt.endsWith("_declaration") || pt === "container_field") names.add(n.text)
    }
    for (let i = 0; i < n.namedChildCount; i++) visit(n.namedChild(i))
  }
  visit(root)
  return names
}

const occ: Occ[] = []
let parsed = 0
let parseErrors = 0

for (const f of files) {
  let src: string
  try {
    src = readFileSync(f, "utf8")
  } catch {
    continue
  }
  let t: any
  try {
    t = parser.parse(src)
    if (!t) {
      parseErrors++
      continue
    }
  } catch {
    parseErrors++
    continue
  }
  parsed++

  // ONE parse, two facts: the CALLED builtins and the names the file publishes.
  const declared = publishedNames(t.rootNode)
  const collect = (n: any) => {
    if (n.type === "builtin_function") {
      let bid: any = null
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c.type === "builtin_identifier" && BUILTINS.has(c.text)) {
          bid = c
          break
        }
      }
      if (bid) {
        let container: string | null = null
        let name: string | null = null
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c.type !== "arguments") continue
          for (let j = 0; j < c.namedChildCount; j++) {
            const a = c.namedChild(j)
            if (a.type === "identifier" && container === null) container = a.text
            else if (a.type === "string") {
              for (let k = 0; k < a.namedChildCount; k++) {
                const sc = a.namedChild(k)
                if (sc.type === "string_content") name = sc.text
              }
            }
          }
        }
        occ.push({
          builtin: bid.text,
          file: path.relative(CR, f),
          line: bid.startPosition.row + 1,
          col: bid.startPosition.column,
          container,
          name,
          namePublishedInFile: name === null ? null : declared.has(name),
        })
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) collect(n.namedChild(i))
  }
  collect(t.rootNode)
}

const byBuiltin: Record<string, number> = {}
for (const o of occ) byBuiltin[o.builtin] = (byBuiltin[o.builtin] ?? 0) + 1

const byFiles = new Map<string, number>()
for (const o of occ) byFiles.set(o.file, (byFiles.get(o.file) ?? 0) + 1)

const named = occ.filter((o) => o.name !== null)
const published = named.filter((o) => o.namePublishedInFile === true)

const report = {
  instrument: "validation/m14/fixtures/zig/reflection-builtin-probe.mts",
  method: "tree walk: builtin_function nodes with a builtin_identifier child in the CALLED set",
  corpusRoot: CR,
  shard: SHARD,
  shards: SHARDS,
  corpusFilesTotal: corpusFiles,
  corpusFiles: files.length,
  parsed,
  parseTraps: parseErrors,
  coveragePct: corpusFiles === 0 ? 0 : Number(((parsed / corpusFiles) * 100).toFixed(2)),
  occurrences: occ.length,
  byBuiltin,
  filesWithOccurrence: byFiles.size,
  topFiles: [...byFiles.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25),
  occurrencesWithAStringName: named.length,
  ofThoseNamePublishedInSameFile: published.length,
  ofThoseNameNotPublished: named.length - published.length,
  // The full occurrence list travels with the shard so the merge is a real union and
  // not a sum of rounded per-shard summaries.
  allOccurrences: occ,
}

console.log(
  JSON.stringify(
    {
      ...report,
      allOccurrences: undefined,
      corpusFiles,
      shard: `${SHARD}/${SHARDS}`,
      occurrences: occ.length,
      byBuiltin,
      parsed,
      parseTraps: parseErrors,
      coveragePct: report.coveragePct,
    },
    null,
    2,
  ),
)
if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n")