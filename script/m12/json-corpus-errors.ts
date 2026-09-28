import { execFileSync } from "node:child_process"
import { writeFileSync, readFileSync } from "node:fs"
import { parseFile } from "../../src/ast/pool-worker"

const corpus = process.argv[2] || "$HOME/roslyn"
const relative = execFileSync("git", ["-C", corpus, "ls-files", "*.json"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean).sort()

function strictJson(file: string): boolean {
  try {
    const text = readFileSync(`${corpus}/${file}`, "utf8")
    JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
    return true
  } catch {
    return false
  }
}

const unsupportedFiles = relative.filter((file) => !strictJson(file))
const cleanFiles = relative.filter((file) => strictJson(file))
const errors: { file: string; count: number; reason: string }[] = []
const crashes: { file: string; error: string }[] = []
for (const file of relative) {
  try {
    const parsed = await parseFile(`${corpus}/${file}`, process.cwd())
    const count = parsed.errors?.length ?? 0
    if (count) errors.push({ file, count, reason: strictJson(file) ? "grammar_gap" : "non_strict_json_or_encoding" })
  } catch (error: any) {
    crashes.push({ file, error: String(error?.message ?? error).slice(0, 300) })
  }
}
const grammarGapFiles = errors.filter((item) => item.reason === "grammar_gap").map((item) => item.file)
const result = {
  analyzer: "json",
  corpus,
  revision: execFileSync("git", ["-C", corpus, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  extension: "*.json",
  files: relative.length,
  cleanFiles: cleanFiles.length,
  unsupportedFiles,
  unsupportedFileCount: unsupportedFiles.length,
  errorFiles: errors.length,
  errorNodes: errors.reduce((sum, item) => sum + item.count, 0),
  grammarGapFiles,
  crashFiles: crashes.length,
  errors,
  crashes,
  passed: grammarGapFiles.length === 0 && crashes.length === 0,
  policy: "strict JSON acceptance subset; every tracked non-strict JSONC/encoding path is listed as an explicit exclusion, even when the grammar recovers it",
}
writeFileSync("validation/m12/results/json-corpus-errors.json", JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 1
