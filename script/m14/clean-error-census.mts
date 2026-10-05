/**
 * clean-error-census — how much of the corpus is a DAMAGED tree, and what the analyzer
 * publishes from the damage.
 *
 *   npx tsx script/m14/clean-error-census.mts [--limit N] [--shard K --shards M] [--out FILE]
 *
 * WHY THIS EXISTS. Limitation 0 of `docs/analyzers/real-clean-analyzer.md` counts FILES:
 * "655 of 2,179 wide-corpus files contain at least one ERROR node". That is the right
 * population for a grammar limitation and the wrong one for a graph limitation, because a
 * file is not damaged evenly. `clean-ide/Ide/edoptions.icl` carries ONE ERROR node
 * spanning lines 1-585 of 694, and inside it the parser's recovery reads
 *
 *     toStringC :: !Colour -> String
 *
 * as two declarations the file does not contain:
 *
 *     type_definition      name="Colour"   text=":: !Colour"
 *     operator_definition  name="->"       text="-> String\n\ttoStringC c = toString c\n\t..."
 *
 * Both are published verbatim, so the graph carries a TYPE named `Colour` that the file
 * never declares and a FUNCTION named `->`. Neither is a heuristic edge; they are
 * invented ROWS, and they are indistinguishable downstream from real declarations.
 *
 * So the question this instrument answers is not "how many files fail to parse" but
 *
 *   1. how much SOURCE is inside an ERROR region (lines, not files), and
 *   2. what the analyzer publishes from it — the invented names, and the declarations
 *      it demotes to `visibility: "local"`, which `emitExports` then withholds from the
 *      module interface.
 *
 * THE THREE INVENTED-NAME FAMILIES are each stated as a STRUCTURAL rule with the
 * corpus line that forced it, not as a spelling blacklist:
 *
 *   A  `operator_definition` whose name contains `,` or `_`. Clean's operator
 *      characters are `!#$%&*+./<=>?@\^|}~:` — `,` and `_` are not among them, so a
 *      parenthesised name carrying either is a PATTERN, not an operator. The corpus
 *      writes `(_,ps) = openModalDialog wloc wdef ps` (edoptions.icl:178, :392) and the
 *      recovery publishes a function named `(_,ps)`.
 *
 *   B  `operator_definition` named `->`. `->` is the function-TYPE arrow: grammar
 *      punctuation, and the whole reason the line above is inside an ERROR.
 *
 *   C  `type_definition` whose text is `::` followed by a UNIQUENESS marker and nothing
 *      that defines anything. Every Clean type form is `:: Name`, `:: Name = …`,
 *      `:: Name :== …`, `:: Name |` or `:: Name !a`; `:: !Colour` is the tail of a
 *      signature, and the tail is what the recovery keeps.
 *
 * Each family is dumped with file, line and source text so every count below is
 * re-derivable without re-running the walk.
 *
 * POPULATIONS, reported separately and never mixed (same contract as
 * `extends-construct-probe.mts`):
 *   TRACKED  what `git ls-files` admits — the 312 files
 *            `script/m14/ontology-coverage-gate.ts` walks.
 *   WIDE     TRACKED plus `script/m14/clean-wide-manifest.txt`.
 *
 * PARSE-TREE ONLY. This walks the grammar, not the analyzer, so it can be run while the
 * analyzer is being changed and still describe the same corpus. The analyzer-side
 * consequence (`visibility: "local"`, withheld exports) is measured separately by
 * `clean-error-impact.mts`, which goes through production `parseFile`.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { detectLanguageFromPath } from "../../src/ast/language-detection"

const ROOT = path.resolve(new URL(import.meta.url).pathname, "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const WIDE = path.join(ROOT, "script", "m14", "clean-wide-manifest.txt")
const argv = process.argv.slice(2)
const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : "" }
const LIMIT = Number(arg("--limit") ?? 0)
const SHARD = Number(arg("--shard") ?? -1)
const SHARDS = Number(arg("--shards") ?? 0)
const OUT = arg("--out") || path.join(ROOT, "validation", "m14", "measurements", "clean", "error-census.json")
const NDJSON = arg("--ndjson") || path.join(ROOT, "validation", "m14", "measurements", "clean", "error-census.ndjson")

function gitTrackedCleanFiles(): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const e of fs.readdirSync(CR)) {
    const dir = path.join(CR, e)
    try {
      if (!fs.statSync(dir).isDirectory()) continue
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      // EXTENSION FIRST. The first version of this loop called `detectLanguageFromPath`
      // on every tracked file in every corpus repo, which reads the file; on a repo like
      // dart-sdk that is hundreds of thousands of reads and the walk exceeded 280 s
      // without printing a figure. The extension filter is the same one
      // `script/m14/clean-census.ts` uses for its TRACKED population, so the two
      // instruments admit the same files — which is what makes the figures comparable.
      if (!/\.(icl|dcl)$/i.test(rel)) continue
      const abs = path.join(dir, rel)
      let text: string
      try { if (fs.statSync(abs).size > 512 * 1024) continue; text = fs.readFileSync(abs, "utf8") } catch { continue }
      if (detectLanguageFromPath(abs, text) !== "clean") continue
      if (seen.has(abs)) continue
      seen.add(abs); out.push(abs)
    }
  }
  return out.sort()
}

const tracked = gitTrackedCleanFiles()
const wide = new Set(tracked)
if (fs.existsSync(WIDE)) {
  for (const l of fs.readFileSync(WIDE, "utf8").split("\n")) {
    const abs = l.trim()
    if (!abs || wide.has(abs) || !fs.existsSync(abs)) continue
    if (!/\.(icl|dcl)$/i.test(abs)) continue
    if (fs.statSync(abs).size > 512 * 1024) continue
    if (detectLanguageFromPath(abs, fs.readFileSync(abs, "utf8")) !== "clean") continue
    wide.add(abs)
  }
}
const wideList = [...wide].sort()

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-clean.wasm")))
const parser = new P()
parser.setLanguage(grammar)

/**
 * The three families, as predicates over a node. Each returns the published NAME when the
 * node is damage and null when it is a declaration — so the caller can count the damage
 * without a separate list of "bad" names, which is what keeps this from being a blacklist.
 */
const OP_CHARS = new Set("!#$%&*+./<=>?@\\^|}~:".split(""))
function familyA(n: any): string | null {
  if (n.type !== "operator_definition") return null
  const name = n.childForFieldName("name")?.text ?? ""
  if (name === "") return null
  return /[,]/.test(name) || name.includes("_") ? name : null
}
function familyB(n: any): string | null {
  if (n.type !== "operator_definition") return null
  const name = n.childForFieldName("name")?.text ?? ""
  return name === "->" ? name : null
}
function familyC(n: any): string | null {
  if (n.type !== "type_definition") return null
  const name = n.childForFieldName("name")?.text ?? ""
  if (name === "") return null
  // `::` then a UNIQUENESS marker with nothing after it: the recovery kept the tail of a
  // signature. A real definition continues past the marker.
  const t = n.text
  return /^::[ \t]*[!#]/.test(t) ? name : null
}
const FAMILIES: [string, (n: any) => string | null][] = [
  ["A_operator_name_not_an_operator", familyA],
  ["B_arrow_as_a_definition", familyB],
  ["C_signature_tail_as_a_type", familyC],
]

type Row = { family: string; nodeType: string; published: string; file: string; line: number; column: number; inError: boolean; src: string }
const rows: Row[] = []

type Tally = {
  files: number; filesWithError: number; errorNodes: number; missingNodes: number
  totalLines: number; linesInError: number; filesWhollyInError: number
  errorTopLevelByType: Record<string, number>
  familyCounts: Record<string, number>
  familyFiles: Record<string, number>
  biggestErrorFiles: { file: string; errorNodes: number; linesInError: number; totalLines: number }[]
}
const emptyTally = (): Tally => ({
  files: 0, filesWithError: 0, errorNodes: 0, missingNodes: 0,
  totalLines: 0, linesInError: 0, filesWhollyInError: 0,
  errorTopLevelByType: Object.create(null),
  familyCounts: Object.create(null),
  familyFiles: Object.create(null),
  biggestErrorFiles: [],
})

function rel(p: string): string {
  const r = path.relative(CR, p)
  return r.startsWith("..") ? path.relative("$HOME/fixtures", p) : r
}

function run(list: string[], label: string): Tally {
  const t = emptyTally()
  for (const f of list) {
    if (SHARDS > 0 && list.indexOf(f) % SHARDS !== SHARD) continue
    t.files++
    const text = fs.readFileSync(f, "utf8")
    const srcLines = text.split("\n")
    let tree: any
    try { tree = parser.parse(text) } catch { tree = null }
    if (!tree) continue
    // Lines covered by an ERROR or MISSING node, counted once per line.
    const covered = new Set<number>()
    let errNodes = 0
    let missNodes = 0
    const walkErr = (n: any): void => {
      if (n.type === "ERROR") errNodes++
      else if (n.isMissing) missNodes++
      if (n.type === "ERROR" || n.isMissing) {
        for (let r = n.startPosition.row; r <= n.endPosition.row; r++) covered.add(r)
      }
      for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) walkErr(c) }
    }
    walkErr(tree.rootNode)
    t.errorNodes += errNodes
    t.missingNodes += missNodes
    t.totalLines += srcLines.length
    t.linesInError += covered.size
    if (errNodes > 0 || missNodes > 0) {
      t.filesWithError++
      if (covered.size >= srcLines.length - 1) t.filesWhollyInError++
      // The node types the recovery produced DIRECTLY under the outermost ERROR: these are
      // the shapes the grammar could not fit, so they are the grammar-gap inventory.
      const outer = (n: any): void => {
        if (n.type === "ERROR") {
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c) t.errorTopLevelByType[c.type] = (t.errorTopLevelByType[c.type] ?? 0) + 1
          }
        }
        for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) outer(c) }
      }
      outer(tree.rootNode)
      t.biggestErrorFiles.push({ file: rel(f), errorNodes: errNodes, linesInError: covered.size, totalLines: srcLines.length })
    }
    // The three families, anywhere in the tree.
    const fileFamilies = new Set<string>()
    const walkFam = (n: any): void => {
      for (const [fam, pred] of FAMILIES) {
        const got = pred(n)
        if (got === null) continue
        t.familyCounts[fam] = (t.familyCounts[fam] ?? 0) + 1
        fileFamilies.add(fam)
        const ln = n.startPosition.row + 1
        rows.push({
          family: fam, nodeType: n.type, published: got, file: rel(f), line: ln,
          column: n.startPosition.column, inError: n.parent?.type === "ERROR",
          src: (srcLines[ln - 1] ?? "").slice(0, 120),
        })
      }
      for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) walkFam(c) }
    }
    walkFam(tree.rootNode)
    for (const fam of fileFamilies) t.familyFiles[fam] = (t.familyFiles[fam] ?? 0) + 1
    tree.delete?.()
  }
  t.biggestErrorFiles.sort((a, b) => b.linesInError - a.linesInError || b.errorNodes - a.errorNodes)
  t.biggestErrorFiles = t.biggestErrorFiles.slice(0, 15)
  const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${((100 * a) / b).toFixed(1)}%`)
  console.log(`\n=== ${label}${SHARDS > 0 ? ` shard ${SHARD}/${SHARDS}` : ""} ===`)
  console.log(`  files walked                ${t.files}`)
  console.log(`  files with >=1 ERROR/MISSING ${t.filesWithError}  (${pct(t.filesWithError, t.files)})`)
  console.log(`  files wholly inside ERROR   ${t.filesWhollyInError}`)
  console.log(`  ERROR nodes                 ${t.errorNodes}`)
  console.log(`  MISSING nodes               ${t.missingNodes}`)
  console.log(`  source LINES inside ERROR   ${t.linesInError} of ${t.totalLines}  (${pct(t.linesInError, t.totalLines)})`)
  for (const [fam] of FAMILIES) {
    console.log(`  invented names ${fam.padEnd(34)} ${String(t.familyCounts[fam] ?? 0).padStart(5)} in ${String(t.familyFiles[fam] ?? 0).padStart(4)} files`)
  }
  console.log(`  recovery node types under the outermost ERROR:`)
  for (const [k, v] of Object.entries(t.errorTopLevelByType).sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, 12)) {
    console.log(`    ${String(v).padStart(6)}  ${k}`)
  }
  console.log(`  most damaged files by lines in ERROR:`)
  for (const b of t.biggestErrorFiles.slice(0, 8)) {
    console.log(`    ${String(b.linesInError).padStart(5)}/${String(b.totalLines).padEnd(5)} lines, ${String(b.errorNodes).padStart(4)} ERROR  ${b.file}`)
  }
  return t
}

const sample = (l: string[]) => (LIMIT > 0 ? l.slice(0, LIMIT) : l)
const trackedT = run(sample(tracked), "TRACKED (git ls-files)")
const wideT = run(sample(wideList), "WIDE (git-tracked + clean-wide-manifest.txt)")

if (SHARDS <= 0) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  const out = {
    instrument: "script/m14/clean-error-census.mts",
    parseTreeOnly: true,
    populations: { tracked: trackedT, wide: wideT },
    families: Object.fromEntries(FAMILIES.map(([f]) => [f, {
      rule: f.startsWith("A_") ? "operator_definition whose name contains `,` or `_` — neither is a Clean operator character"
        : f.startsWith("B_") ? "operator_definition named `->`, the function-type arrow"
        : "type_definition whose text is `::` + a uniqueness marker and no definition",
      rows: rows.filter((r) => r.family === f).length,
      ndjson: path.relative(ROOT, NDJSON),
    }])),
    ndjsonRows: rows.length,
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2))
  fs.writeFileSync(NDJSON, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""))
  console.log(`\nJSON  ${path.relative(ROOT, OUT)}`)
  console.log(`NDJSON ${path.relative(ROOT, NDJSON)}  ${rows.length} rows (one per invented name, with file:line:src)`)
}
