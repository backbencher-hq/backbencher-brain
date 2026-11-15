/**
 * GraphQL M12 CORPUS-ERRORS artifact.
 *
 * The m60 `corpus` cell compares the m12 manifest's `measured.grammarErrorFiles`
 * against this artifact's `errorFiles`, and it was failing: the manifest claimed 1
 * and the only artifact on disk said 0 — a 1,970-byte placeholder dated three days
 * before the claim, carrying `symbols: null`, `corpusRepo: null` and the revision
 * of the PRE-PATCH grammar rather than of any corpus. A stale artifact that reads
 * like a measurement is worse than no artifact, because it looks like evidence.
 *
 * Two things are corrected here, and the DIRECTION matters:
 *
 *   - the manifest's claim was aligned to the measurement, not the artifact edited
 *     to match the claim. The second direction turns any gate green and destroys
 *     the evidence the gate exists to protect.
 *   - the corpus was re-fetched AT THE PINNED REVISION, file by file, rather than
 *     re-cloned. `bb_tests/repositories/graphql-js` is now an empty shell — the
 *     corpus was removed because the disk was at 96% — and a clone would have
 *     undone that decision for two files totalling 368 KB. Fetching the two named
 *     files at `9c245018` costs less than a megabyte and re-establishes exactly
 *     what the manifest claims: 20,367 + 65 lines, matching its `sample` field.
 *
 * Damage is read from the PRODUCTION `ASTEngine.parseFile` pipeline, not by
 * calling the analyzer directly, so this measures the shipped route.
 *
 * Usage: tsx m12-corpus-errors.mts
 */
import * as fs from "fs"
import * as path from "path"
import { HERE, ROOT } from "../paths.mts"

const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine"))
const { WASM } = await import("../paths.mts")
const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new ParserClass()
parser.setLanguage(await Language.load(fs.readFileSync(WASM)))

/** The corpus id the m12 gate resolves candidates by — must equal the manifest's. */
const CORPUS_ID = "graphql_js"
const CORPUS_URL = "https://github.com/graphql/graphql-js"
/** The revision the manifest declares. The two files are fetched at exactly this. */
const REVISION = "9c245018484668b7c35f3ed219092a98855bd51e"
/** Where the fetched files live. NOT `bb_tests/repositories/graphql-js`, which is
 *  an empty shell left by the disk-space cleanup and must stay that way. */
const STAGE = process.env.GQL_CORPUS_STAGE ?? "/home/ishaq2321/bb_tests/graphql-corpus-probe"

const FILES = ["github-schema.graphql", "kitchen-sink.graphql"]

if (!fs.existsSync(STAGE)) {
  console.error(
    `  corpus stage missing: ${STAGE}\n` +
      `  fetch it with:\n` +
      FILES.map(
        (f) =>
          `    curl -sfL "https://raw.githubusercontent.com/graphql/graphql-js/${REVISION}/benchmark/${f}" -o "${STAGE}/${f}"`,
      ).join("\n"),
  )
  process.exit(1)
}

const errorFileList: any[] = []
const namedGrammarLimits: any[] = []
const errorLineSignatures: Record<string, number> = {}
let errorNodes = 0
let symbols = 0
let relationships = 0
let crashes: any[] = []
let lines = 0

for (const name of FILES) {
  const abs = path.join(STAGE, name)
  if (!fs.existsSync(abs)) {
    console.error(`  missing staged file: ${abs}`)
    process.exit(1)
  }
  const src = fs.readFileSync(abs, "utf8")
  lines += src.split("\n").length
  let res: any
  try {
    res = await ASTEngine.parseFile(abs, src)
  } catch (e) {
    crashes.push({ file: name, error: e instanceof Error ? e.message : String(e) })
    continue
  }
  symbols += res.symbols?.length ?? 0
  relationships += res.relationships?.length ?? 0
  const errs = (res.errors ?? []) as any[]
  if (errs.length === 0) continue
  errorNodes += errs.length
  const first = errs.find((e: any) => typeof e?.range?.startLine === "number") ?? errs[0]
  const line = first?.range?.startLine ?? 0
  const text = line ? (src.split("\n")[line - 1] ?? "").trim().slice(0, 90) : ""
  errorLineSignatures[text] = (errorLineSignatures[text] ?? 0) + 1
  errorFileList.push({ file: name, errorEntries: errs.length, firstRow: line, firstLine: text })
}

const measuredFiles = FILES.length
const errorFiles = errorFileList.length

const out = {
  schemaVersion: 1,
  kind: "graphql_corpus_errors",
  analyzer: "graphql",
  corpus: CORPUS_ID,
  corpusRepo: CORPUS_ID,
  corpusUrl: CORPUS_URL,
  corpusPath: STAGE,
  revision: REVISION,
  extensions: ["*.graphql"],
  mode: "named-files",
  measuredFiles,
  lines,
  symbols,
  relationships,
  errorFiles,
  grammarErrorFiles: errorFiles,
  cleanFiles: measuredFiles - errorFiles,
  // Both of these are CONTRACT fields, not decoration: the lane's own doc-truth
  // probe reads `crashFiles` and matches `corpusSize` against /NOT a corpus/, and
  // a regenerated artifact that quietly omits them fails the very gate that
  // regenerated it. The first version of this file carried neither and the
  // m12-corpus-errors and m12-corpus-size-caveat claims both went false.
  crashFiles: crashes.length,
  corpusSize:
    `${measuredFiles} file(s) is NOT a corpus: it is the set of files the m12 manifest names, chosen because they are the ` +
    `GitHub public schema and the kitchen-sink torture test. It establishes that the analyzer reads real large-scale SDL and a ` +
    `deliberately hostile document; it says nothing about breadth across the ecosystem, and no cell in the matrix should be ` +
    `read as though it did.`,
  errorNodes,
  errorLineSignatures,
  errorFileList,
  namedGrammarLimits,
  crashes,
  passed: errorFiles === 0 && crashes.length === 0,
  policy:
    "Both files the m12 manifest names are audited through the PRODUCTION `ASTEngine.parseFile` pipeline, at the manifest's " +
    "pinned revision. `corpusRepo` is the id the m12 gate resolves candidates by, not a URL, because the gate matches the " +
    "artifact's corpus identity against the manifest candidate's repo token and the three must agree. The files are staged " +
    "individually rather than cloned: the corpus checkout was removed when the disk reached 96%, and two files totalling " +
    "368 KB do not justify undoing that.",
  caveat:
    "A 2-file corpus is not coverage, and the lane's own review says so. This artifact exists to give the manifest's claim an " +
    "artifact behind it, not to stand in for a breadth measurement it cannot provide.",
  note:
    "Replaces a 1,970-byte placeholder dated 2026-09-27 that carried `symbols: null`, `corpusRepo: null` and the revision of " +
    "the pre-patch grammar. That placeholder is what let a manifest claim of 1 error file sit unchallenged against a " +
    "measurement of 0.",
}

const ARTIFACT = path.join(ROOT, "validation/m12/results/graphql-corpus-errors.json")
fs.writeFileSync(ARTIFACT, JSON.stringify(out, null, 2) + "\n")

console.log(`\n  corpus: ${CORPUS_ID}@${REVISION.slice(0, 8)}  (${measuredFiles} files, ${lines} lines)`)
console.log(`  symbols ${symbols}  relationships ${relationships}`)
console.log(`  errorFiles ${errorFiles}  errorNodes ${errorNodes}  crashes ${crashes.length}`)
for (const f of errorFileList) console.log(`    ${f.file} entries=${f.errorEntries} firstRow=${f.firstRow}`)
console.log(`\n  wrote ${path.relative(ROOT, ARTIFACT)}`)
console.log(`  manifest must claim grammarErrorFiles = ${errorFiles} and corpusRelationships = ${relationships}`)
