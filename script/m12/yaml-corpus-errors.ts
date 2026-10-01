import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { parseFile } from "../../src/ast/pool-worker"

const corpus = process.argv[2] || "$HOME/fixtures/repositories/grails-core"
const revision = execFileSync("git", ["-C", corpus, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
const relative = execFileSync("git", ["-C", corpus, "ls-files", "*.yaml", "*.yml"], { encoding: "utf8" })
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
const explicitlyExcluded = errors.filter((item) => item.file === "grails-profiles/base/skeleton/grails-app/conf/application.yml")
const unexpectedErrors = errors.filter((item) => !explicitlyExcluded.some((excluded) => excluded.file === item.file))
const result = {
  analyzer: "yaml",
  corpus,
  revision,
  extensions: ["*.yaml", "*.yml"],
  trackedFiles: relative.length,
  files: relative.length,
  errorFiles: errors.length,
  errorNodes: errors.reduce((sum, item) => sum + item.count, 0),
  crashFiles: crashes.length,
  errors,
  crashes,
  explicitlyExcluded,
  unexpectedErrors,
  acceptanceFiles: relative.length - explicitlyExcluded.length,
  passed: unexpectedErrors.length === 0 && crashes.length === 0,
  policy: "All tracked YAML/YML files from clean grails-core@a83f8748 are audited. One named Grails template contains unquoted @...@ placeholders, which are invalid YAML until template expansion; it remains recorded as an explicit exclusion from the strict acceptance subset, never silently treated as clean.",
}
writeFileSync("validation/m12/results/yaml-corpus-errors.json", JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 1
