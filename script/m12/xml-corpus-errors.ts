import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { parseFile } from "../../src/ast/pool-worker"

/**
 * A corpus may DECLARE its negative controls, and a declared control is excluded
 * from the failure count while still being reported. Excluding a file by a glob
 * nobody reads hides the gap; naming it, measuring it, and writing down WHY it is
 * negative keeps the gap visible and the claim honest. The manifest is
 * `fixtures/xml/repositories/MANIFEST.json` (the same shape the lua lane
 * established), and an entry whose `verdict` is not a string is a hard error
 * rather than a silent pass.
 */
const corpusPath = process.argv[2] || process.env.XML_CORPUS || "$HOME/fixtures/xml/repos/grails-core"
const corpus = corpusPath

/** Every tracked file of a corpus matching a glob, so a declared control can be a PATTERN. */
function listOfCorpusFiles(dir: string, pattern: string): string[] {
  try {
    return execFileSync("git", ["-C", dir, "ls-files", pattern], { encoding: "utf8", maxBuffer: 1 << 28 })
      .split("\n").filter(Boolean)
  } catch { return [] }
}
const MANIFEST = process.env.XML_MANIFEST || "$HOME/fixtures/xml/repositories/MANIFEST.json"
let negativeControls = new Map<string, { file: string; measured: string; verdict: string; why: string }>()
if (existsSync(MANIFEST)) {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"))
  for (const corpus of manifest.corpora ?? []) {
    if (corpus.path !== corpusPath) continue
    for (const fixture of corpus.knownNegativeFixtures ?? []) {
      if (typeof fixture.verdict !== "string" || !fixture.verdict.trim()) {
        throw new Error(`manifest entry for ${fixture.path} has no verdict; a negative control must say why it is negative`)
      }
      negativeControls.set(fixture.path, fixture)
    }
  }
}

const relative = execFileSync("git", ["-C", corpus, "ls-files", ...(process.env.XML_CORPUS_EXTS?.split(",") ?? ["*.xml", "*.xsd", "*.dtd", "*.xsl", "*.xslt", "*.svg", "*.rng"])], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean).sort()
const errors: { file: string; count: number }[] = []
const crashes: { file: string; error: string }[] = []
const declaredNegatives: { file: string; measured: string; verdict: string }[] = []
for (const file of relative) {
  try {
    const parsed = await parseFile(`${corpus}/${file}`, process.cwd())
    const count = parsed.errors?.length ?? 0
    if (count) {
      const control = negativeControls.get(file)
      if (control) declaredNegatives.push({ file, measured: `re-measured: ${count} error nodes`, verdict: control.verdict })
      else errors.push({ file, count })
    }
  } catch (error: any) {
    crashes.push({ file, error: String(error?.message ?? error).slice(0, 300) })
  }
}
const result = {
  analyzer: "xml",
  corpus,
  revision: execFileSync("git", ["-C", corpus, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  extensions: [...(process.env.XML_CORPUS_EXTS?.split(",") ?? ["*.xml", "*.xsd", "*.dtd", "*.xsl", "*.xslt", "*.svg", "*.rng"])],
  files: relative.length,
  errorFiles: errors.length,
  errorNodes: errors.reduce((sum, item) => sum + item.count, 0),
  crashFiles: crashes.length,
  errors,
  crashes,
  declaredNegativeControls: declaredNegatives,
  manifest: MANIFEST,
  manifestPresent: existsSync(MANIFEST),
  passed: errors.length === 0 && crashes.length === 0,
  policy: "Tracked XML-family documents (every file type the wired grammar's tree-sitter.json declares, plus the routed `dtd`) from a revision-pinned repository. A file whose errors are EXPECTED is declared in the manifest with a verdict and a measurement, and is reported here rather than excluded by a glob; `script/m12/xml-node-types-compare.ts` is what proves the declared vocabulary, and `fixtures/xml/out/grammar-corpus-ab.json` is what measures the grammar.",
}
writeFileSync("validation/m12/results/xml-corpus-errors.json", JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 1
