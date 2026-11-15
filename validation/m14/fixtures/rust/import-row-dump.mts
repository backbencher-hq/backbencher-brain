/**
 * IMPORT-ROW DUMP — what the analyzer emits for ONE file's `imports` rows, with the claim and the
 * candidate arithmetic, so a row can be read without the 400-file census.
 *
 * Run: bun run validation/m14/fixtures/rust/import-row-dump.mts <absolute .rs path> [projectRoot]
 * Project root defaults to the corpus repo (the path's first segment under BB_CORPUS_ROOT).
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const file = process.argv[2]
if (!file) {
  console.error("usage: bun run import-row-dump.mts <absolute .rs path> [projectRoot]")
  process.exit(2)
}
const rel = file.startsWith(CR) ? file.slice(CR.length + 1) : file
const projectRoot = process.argv[3] ?? path.join(CR, rel.split(path.sep)[0])
const source = readFileSync(file, "utf8")
const result: any = await parseFile(file, projectRoot, { projectRoot } as any)
console.log(`file: ${rel}`)
console.log(`projectRoot: ${projectRoot}`)
for (const relRow of Array.isArray(result?.relationships) ? result.relationships : []) {
  if (String(relRow?.type ?? "") !== "imports") continue
  const md = relRow?.metadata ?? {}
  const claim = typeof md?.importProjectFile === "string" ? `  CLAIM ${md.importProjectFile}` : "  (no claim)"
  console.log(`${String(relRow?.line_number ?? "?").padStart(5)}  target=${JSON.stringify(relRow.target)}  kind=${md?.moduleKind ?? "?"}  items=${JSON.stringify(md?.items ?? [])}${claim}`)
}
// The `use` lines, so a reader can pair an emitted target with the source text.
console.log("--- use lines")
source.split("\n").forEach((line, i) => {
  if (/^\s*(pub\s+)?use\s/.test(line)) console.log(`${String(i + 1).padStart(5)}  ${line.trim()}`)
})
