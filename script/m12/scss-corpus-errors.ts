// M12 corpus measurement for the SCSS analyzer, and the artifact the manifest's
// H1/H5 rules compare against.
//
//   bun script/m12/scss-corpus-errors.ts
//   bun script/m12/scss-corpus-errors.ts --write-sample
//
// WHY THIS EXISTS, and why it is a full-corpus pass rather than a sample. The M12
// manifest is a register of CLAIMS, and the rules that keep it honest (H1 the parse-error
// count, H5 the symbol and relationship volume) are only teeth if the numbers come from
// an artifact rather than from the manifest's own prose. That is the #859 SAMPLE DRIFT
// class the CSS entry already records: a sample file and a corpus-errors artifact that
// measured different file sets, with the manifest repeating the sample's numbers. So the
// file set here is the full tracked set, `mode: "full-corpus"`, and the sample file this
// writes names that same set — one file set, three numbers.
//
// The corpus is element-plus, the same repository the M14 differential draws, and for a
// reason that is not convenience: it is a real design-system stylesheet source, full of
// the constructs that make SCSS hard — `@use`/`@forward` with aliases, mixins and
// functions with parameters, `@extend` across partials, deeply nested rules, `@each` with
// map literals, and interpolation in selectors. A corpus chosen because it parses cleanly
// would measure the grammar's comfort and call it the lane's health.
//
// WHAT IS MEASURED. Per file: whether the grammar could read it (`errors`), and if so how
// many symbols and relationships the analyzer published. `errorFiles` is what H1 compares;
// `symbols`/`relationships` are what H5 compares. `crashFiles` is reported separately and
// is NEVER smoothed into the error count, because a file that throws is a different
// failure from a file that parses badly and averaging them hides the one that matters.
//
// The parse-error floor here is NOT zero and is not presented as one. 97 of 160 files
// carry at least one ERROR span, dominated by `common/var.scss` (1,716 lines, over 400
// disjoint error spans) where the grammar cannot lex `map.merge((…))` map literals. The
// lane's answer is to RECOVER through those regions rather than refuse the file — which is
// why the artifact also reports `filesRecoveredWithOutput`, the count of error files that
// still produced symbols. A parse-error rate on its own reads as a broken lane; a parse-error
// rate next to a recovery rate is a measurement.
import { ASTEngine } from "../../src/ast/engine"
import { readFileSync, writeFileSync, existsSync } from "fs"
import { execFileSync } from "child_process"
import { join } from "path"

const ROOT = process.cwd()
const CORPUS = "$HOME/fixtures/repositories/element-plus"
const EXT = ".scss"
const OUT = join(ROOT, "validation/m12/results/scss-corpus-errors.json")
const SAMPLE = join(ROOT, "validation/m12/results/scss-corpus-sample.txt")
const WRITE_SAMPLE = process.argv.includes("--write-sample")

function git(args: string[]): string {
  return execFileSync("git", ["-C", CORPUS, ...args], { encoding: "utf8" }).trim()
}

if (!existsSync(CORPUS)) {
  console.error(`no corpus at ${CORPUS} — the manifest pin would dangle without it`)
  process.exit(1)
}

const revision = git(["rev-parse", "HEAD"])
const dirty = git(["status", "--porcelain"]).length > 0

// The full TRACKED set, and the empty files named rather than silently dropped — an empty
// stylesheet parses trivially and would otherwise pad the clean-file count for free.
const tracked = git(["ls-files", `*${EXT}`]).split("\n").filter(Boolean)
const paths = tracked.filter((p) => existsSync(join(CORPUS, p)))
const nonEmpty = paths.filter((p) => {
  try {
    return readFileSync(join(CORPUS, p), "utf8").trim().length > 0
  } catch {
    return false
  }
})
const emptyFiles = paths.filter((p) => !nonEmpty.includes(p))

let symbols = 0
let relationships = 0
let errorFiles = 0
let cleanFiles = 0
let crashFiles = 0
let filesRecoveredWithOutput = 0
let missingNodeFiles = 0
let errorNodeFiles = 0
const errorFileList: Array<{ file: string; errors: number; symbols: number; relationships: number }> = []
const crashList: string[] = []
const errorLineSignatures = new Map<string, number>()
const started = Date.now()

for (const p of nonEmpty) {
  const abs = join(CORPUS, p)
  let result: any
  try {
    result = await ASTEngine.parseFile(abs, readFileSync(abs, "utf8"))
  } catch (e: any) {
    crashFiles++
    crashList.push(p)
    continue
  }
  const errs = (result.errors ?? []).length
  const sym = (result.symbols ?? []).length
  const rel = (result.relationships ?? []).length
  symbols += sym
  relationships += rel
  const reported = (result.errors ?? []).map((e: any) => Number(e?.startLine ?? e?.line ?? 0))
  if (reported.some((l: number) => l === 0)) missingNodeFiles++
  if (reported.length > 0) {
    errorNodeFiles++
    errorFiles++
    errorFileList.push({ file: p, errors: errs, symbols: sym, relationships: rel })
    if (sym > 0) filesRecoveredWithOutput++
    for (const e of result.errors ?? []) {
      const key = String(e?.message ?? e?.kind ?? "error").slice(0, 80)
      errorLineSignatures.set(key, (errorLineSignatures.get(key) ?? 0) + 1)
    }
  } else {
    cleanFiles++
  }
}

const artifact = {
  analyzer: "scss",
  // `corpus` is the PATH and `corpusRepo` is the repository ID, which is the split every
  // other lane's artifact uses and the one M12's H7 depends on: it matches the manifest's
  // `repo@sha` candidate against `corpusRepo`, so an absolute path here convicts the lane
  // of an undeclared pin no matter how correct the revision is. Getting these two the wrong
  // way round is a loud, cheap mistake, which is the only good property of it.
  corpus: CORPUS,
  corpusRepo: "element-plus",
  revision,
  dirty,
  extensions: [`*${EXT}`],
  // The whole tracked set, and the reason the manifest's numbers can be checked against
  // this artifact at all: a sampled draw makes `errorFiles` a function of the draw, and a
  // claim that moves when the sample moves is not a pin.
  mode: "full-corpus",
  trackedFilesInCorpus: tracked.length,
  measuredFiles: nonEmpty.length,
  emptyFilesExcluded: emptyFiles,
  emptyFilesNote:
    "Named rather than silently dropped: an empty stylesheet parses trivially and would " +
    "otherwise pad the clean-file count for free.",
  errorFiles,
  cleanFiles,
  filesRecoveredWithOutput,
  missingNodeFiles,
  errorNodeFiles,
  errorRates: {
    errorFilesOfMeasured: nonEmpty.length ? Number((errorFiles / nonEmpty.length).toFixed(4)) : null,
    cleanFilesOfMeasured: nonEmpty.length ? Number((cleanFiles / nonEmpty.length).toFixed(4)) : null,
    recoveredOfErrorFiles: errorFiles ? Number((filesRecoveredWithOutput / errorFiles).toFixed(4)) : null,
  },
  grammarErrorFiles: errorFiles,
  symbols,
  relationships,
  crashFiles,
  crashes: crashList,
  wallMs: Date.now() - started,
  errorLineSignatures: [...errorLineSignatures.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([signature, count]) => ({ signature, count })),
  firstErrorLineSignatures: errorFileList.slice(0, 10).map((e) => ({ file: e.file, errors: e.errors })),
  errorFileList: errorFileList.sort((a, b) => b.errors - a.errors),
  policy:
    "errorFiles counts files with at least one ERROR span and is what M12 H1 compares " +
    "against the manifest's grammarErrorFiles claim. crashFiles is reported separately and " +
    "never folded into it. The floor is a MEASUREMENT, not a target: it is high because the " +
    "stock tree-sitter-scss grammar cannot lex map literals and several interpolation forms, " +
    "and filesRecoveredWithOutput is reported beside it because a lane that refuses a broken " +
    "file and a lane that recovers a broken file have the same errorFiles number and are not " +
    "the same lane.",
  passed: crashFiles === 0,
}

writeFileSync(OUT, JSON.stringify(artifact, null, 2))
if (WRITE_SAMPLE) {
  writeFileSync(SAMPLE, nonEmpty.join("\n") + "\n")
}

console.log(
  `scss corpus (full, ${nonEmpty.length} of ${tracked.length} tracked @ ${revision.slice(0, 12)}): ` +
    `errorFiles=${errorFiles} cleanFiles=${cleanFiles} recovered=${filesRecoveredWithOutput} ` +
    `symbols=${symbols} relationships=${relationships} crashes=${crashFiles} ` +
    `in ${artifact.wallMs}ms`,
)
console.log(`wrote ${OUT}${WRITE_SAMPLE ? ` and ${SAMPLE}` : ""}`)
