import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { parseFile } from "../../src/ast/pool-worker"

const corpus = process.argv[2] || "$HOME/fixtures/repositories/grails-core"
const relative = execFileSync("git", ["-C", corpus, "ls-files", "*.xml", "*.xsd"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean).sort()
const errors: { file: string; count: number }[] = []
const crashes: { file: string; error: string }[] = []
for (const file of relative) {
  try {
    const parsed = await parseFile(`${corpus}/${file}`, process.cwd())
    const count = parsed.errors?.length ?? 0
    if (count) errors.push({ file, count })
  } catch (error: any) {
    crashes.push({ file, error: String(error?.message ?? error).slice(0, 300) })
  }
}
const result = {
  analyzer: "xml",
  corpus,
  revision: execFileSync("git", ["-C", corpus, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  extensions: ["*.xml", "*.xsd"],
  files: relative.length,
  errorFiles: errors.length,
  errorNodes: errors.reduce((sum, item) => sum + item.count, 0),
  crashFiles: crashes.length,
  errors,
  crashes,
  passed: errors.length === 0 && crashes.length === 0,
  policy: "tracked XML and XSD documents from a pinned clean Grails repository; standalone DTD files are excluded because the wired XML document grammar requires a document element, while external DTD references are tested in Doctype.xml",
}
writeFileSync("validation/m12/results/xml-corpus-errors.json", JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 1
