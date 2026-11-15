/**
 * Protobuf M12 CORPUS-ERRORS artifact.
 *
 * The m60 `corpus` cell reads `validation/m12/results/protobuf-corpus-errors.json`
 * and compares the manifest's `measured.grammarErrorFiles` against the artifact's
 * `errorFiles`. With no artifact the comparison is vacuous and the cell reads
 * `fail` — so this writes one, from measurement, through the PRODUCTION
 * `ASTEngine.parseFile` pipeline rather than by calling the analyzer directly.
 * The distinction matters: a probe that parses with its own loader proves the
 * analyzer works, and says nothing about whether the engine reaches it.
 *
 * The primary corpus is the reference implementation, which is also where the one
 * RULED construct lives. That file therefore gets a `namedGrammarLimits` entry
 * carrying its reason, because the gate rejects a bare number (H2: "bare number =
 * smoothing") and a limit without a stated cause is exactly the kind of number
 * that gets baselined deeper instead of closed.
 *
 * Usage: tsx m12-corpus-errors.mts
 */
import { execFileSync } from "child_process"
import * as fs from "fs"
import * as path from "path"
import { MANIFEST, OUT, ROOT } from "../paths.mts"

const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine"))
const { WASM } = await import("../paths.mts")
const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new ParserClass()
parser.setLanguage(await Language.load(fs.readFileSync(WASM)))

const ARTIFACT = path.join(ROOT, "validation/m12/results/protobuf-corpus-errors.json")
const PRIMARY = "pb-reference"
/** The directory name the m12 gate resolves candidates by — see `corpusRepo` below. */
const CORPUS_ID = "protobuf-reference"

const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8")) as { corpora: any[] }
const corpus = manifest.corpora.find((c) => c.name === PRIMARY)
if (!corpus) {
  console.error(`  the corpus manifest has no "${PRIMARY}" — stage it per ${MANIFEST}`)
  process.exit(1)
}
if (!fs.existsSync(corpus.root)) {
  console.error(`  corpus root missing: ${corpus.root}`)
  process.exit(1)
}

const git = (...args: string[]): string =>
  execFileSync("git", ["-C", corpus.root, ...args], { encoding: "utf8", maxBuffer: 1 << 26 }).trim()

function walk(dir: string): string[] {
  const out: string[] = []
  const stack = [dir]
  while (stack.length) {
    const d = stack.pop()!
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === ".git") continue
      const abs = path.join(d, e.name)
      if (e.isDirectory()) stack.push(abs)
      else if (abs.endsWith(".proto")) out.push(abs)
    }
  }
  return out.sort()
}

/** The ruled construct, named so the limit entry is a reason and not a number. */
const RULED = {
  file: "src/google/protobuf/unittest_custom_options.proto",
  grammarLimit:
    "the proto2 MessageSet form `any { … }`, which the specification deprecates. RULED, not missed: 9 ERROR nodes, all " +
    "inside this one file of the corpus. Every other construct in the same file parses correctly in isolation, so the errors " +
    "tree-sitter reports on nearby lines are recovery misattributing damage from the `any { }` further down rather than " +
    "independent defects. Recorded as a limit because the fix would be a permanent grammar cost for a construct real schemas " +
    "do not contain; recorded rather than smoothed because the gate rejects a bare number.",
}

const files = walk(corpus.root)
const errorFileList: any[] = []
const namedGrammarLimits: any[] = []
const errorLineSignatures: Record<string, number> = {}
let errorNodes = 0
let errorEntries = 0
let symbols = 0
let relationships = 0
let crashFiles = 0
const crashes: any[] = []

for (const abs of files) {
  const src = fs.readFileSync(abs, "utf8")
  const rel = path.relative(corpus.root, abs).split(path.sep).join("/")
  let res: any
  try {
    res = await ASTEngine.parseFile(abs, src)
  } catch (e) {
    crashFiles++
    crashes.push({ file: rel, error: e instanceof Error ? e.message : String(e) })
    continue
  }
  symbols += res.symbols?.length ?? 0
  relationships += res.relationships?.length ?? 0
  // The production pipeline's own damage signal. `errors` is what the engine
  // reports; the tree's ERROR nodes are counted from the same source the engine
  // used, so the two are not two opinions.
  const errs = (res.errors ?? []) as any[]
  if (errs.length === 0) continue
  errorEntries += errs.length
  // The pipeline reports one entry per reported error, and an entry is not a
  // node: this file yields 13 entries and 9 ERROR/MISSING NODES, because
  // recovery reports the same span more than once. Both are recorded rather than
  // one being picked, because a single number here would have been compared
  // against the other instrument's number and found wanting.
  const nodes = countErrorNodes(src)
  errorNodes += nodes
  const first = errs.find((e: any) => typeof e?.range?.startLine === "number") ?? errs[0]
  const line = first?.range?.startLine ?? 0
  const text = line ? (src.split("\n")[line - 1] ?? "").trim().slice(0, 80) : ""
  errorLineSignatures[text] = (errorLineSignatures[text] ?? 0) + 1
  errorFileList.push({
    file: rel,
    errorEntries: errs.length,
    errorNodes: nodes,
    firstRow: line,
    firstLine: text,
    severities: errs.reduce((a: Record<string, number>, e: any) => {
      a[e?.severity ?? "unknown"] = (a[e?.severity ?? "unknown"] ?? 0) + 1
      return a
    }, {}),
  })
  if (rel === RULED.file) {
    namedGrammarLimits.push({
      file: rel,
      count: nodes,
      grammarLimit: RULED.grammarLimit,
    })
  }
}

/**
 * ERROR and MISSING nodes, counted from a parse with the SAME wasm the engine
 * loads. This is not a second opinion on correctness — a node count is a
 * property of the tree, not of the extractor — and the engine does not surface
 * it. It is the number the corpus probe reports, so the two artifacts can be
 * compared instead of appearing to disagree.
 */
function countErrorNodes(src: string): number {
  const t: any = parser.parse(src)
  let n = 0
  const stack = [t.rootNode]
  while (stack.length) {
    const node = stack.pop()
    for (const c of node.children) {
      if (!c) continue
      if (c.type === "ERROR" || c.isMissing) n++
      else stack.push(c)
    }
  }
  return n
}

const measuredFiles = files.length
const errorFiles = errorFileList.length
const out = {
  schemaVersion: 1,
  kind: "protobuf_corpus_errors",
  analyzer: "protobuf",
  corpus: PRIMARY,
  // NOT the GitHub URL. The gate's H7 matches this field against the manifest
  // candidate's repo token, and the convention across lanes is that the three
  // agree: candidate `luvit@…` <-> artifact `corpusRepo: "luvit"` <-> a
  // directory named `luvit` under a CORPUS_ROOT. Recording the URL here made
  // H7 fail on a lane whose every number was correct. The real origin is kept
  // beside it, because a corpus you cannot trace is not a pinned corpus.
  corpusRepo: CORPUS_ID,
  corpusUrl: corpus.url,
  corpusPath: corpus.root,
  revision: corpus.rev,
  currentCommit: git("rev-parse", "HEAD"),
  extensions: ["*.proto"],
  mode: "full-corpus",
  measuredFiles,
  symbols,
  relationships,
  errorFiles,
  cleanFiles: measuredFiles - errorFiles - crashFiles,
  errorEntries,
  errorNodes,
  errorNodeCounting:
    "ERROR + MISSING nodes from the production parse; `errorEntries` is the pipeline's own reported-error list, and the two differ because recovery reports one span more than once (13 entries vs 9 nodes on the ruled file)",
  grammarErrorFiles: errorFiles,
  crashFiles,
  errorLineSignatures,
  errorFileList,
  namedGrammarLimits,
  crashes,
  passed: errorFiles === 0,
  policy:
    "Every .proto file in the primary corpus is audited through the PRODUCTION `ASTEngine.parseFile` pipeline — the same " +
    "path the engine uses — rather than by calling the analyzer directly, so this measures the shipped route and not just the " +
    "extractor. Damage comes from the pipeline's own error signal. The one error file carries a `namedGrammarLimits` entry with " +
    "its reason, because a limit stated as a bare number is indistinguishable from a number that was baselined deeper instead of " +
    "closed. `passed` is false here and is expected to stay false: the ruled MessageSet construct is a decision, not a defect, and " +
    "a corpus audit that reported 0 because the one known limit was hidden would be the worse artifact.",
  note:
    "Written by probe/m12-corpus-errors.mts. It is the artifact the m60 `corpus` cell compares the manifest's " +
    "`measured.grammarErrorFiles` against; without it that cell is a vacuous comparison rather than a pass.",
}

fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true })
fs.writeFileSync(ARTIFACT, JSON.stringify(out, null, 2) + "\n")

console.log(`\n  corpus: ${PRIMARY} @ ${corpus.rev.slice(0, 8)}`)
console.log(`  files ${measuredFiles}  clean ${out.cleanFiles}  errorFiles ${errorFiles}  errorNodes ${errorNodes}  crashes ${crashFiles}`)
console.log(`  symbols ${symbols}  relationships ${relationships}`)
for (const f of errorFileList) console.log(`    ${f.file}  nodes=${f.errorNodes} line=${f.firstRow}`)
console.log(`\n  wrote ${path.relative(ROOT, ARTIFACT)}`)
console.log(`  manifest must claim grammarErrorFiles = ${errorFiles}`)
