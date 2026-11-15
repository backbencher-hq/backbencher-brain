// Post-index mutations + DB census for the bb_search behaviour fixture.
import { writeFileSync, mkdirSync, rmSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { getProjectId } from "../../../../src/cli/index"
import { BrainDatabase } from "../../../../src/brain/database"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const projectDir = path.join(repoRoot, "validation/tools/bb_search/work/project")
const pid = getProjectId(projectDir)

// 1. a file that exists on disk but was never indexed
mkdirSync(path.join(projectDir, "src"), { recursive: true })
writeFileSync(path.join(projectDir, "src/notindexed.ts"), "export const lateValue = true\n")
// 2. a modified file (stale: hash differs from the index)
writeFileSync(path.join(projectDir, "src/stale.ts"), "export function staleHost(): number { return 1 }\n// modified after indexing\nexport function staleHostTwo(): number { return 2 }\n")
// 3. a deleted file (missing)
rmSync(path.join(projectDir, "src/deleted.ts"), { force: true })

const raw = await BrainDatabase.getRawInstance(pid as any)
const files = raw.prepare("SELECT id, relative_path, language, file_hash FROM brain_file ORDER BY relative_path").all(pid) as any[]
const symbols = raw.prepare("SELECT name, symbol_type, file_id, COALESCE(line_start,0) AS line, docstring, source_text FROM brain_symbol ORDER BY name").all(pid) as any[]
const out = {
  projectDir,
  projectId: pid,
  dbPath: BrainDatabase.getDbPath(pid as any),
  files,
  symbols: symbols.map((s: any) => ({
    ...s,
    source_text_len: s.source_text ? String(s.source_text).length : null,
    source_text: undefined,
    docstring_len: s.docstring ? String(s.docstring).length : null,
    docstring: s.docstring ? undefined : undefined,
  })),
  withBody: symbols.filter((s: any) => s.source_text).length,
  withDocstring: symbols.filter((s: any) => s.docstring).length,
}
writeFileSync(path.join(repoRoot, "validation/tools/bb_search/audit/fixture-state.json"), JSON.stringify(out, null, 2) + "\n")
console.log(JSON.stringify({ projectId: pid, files: files.length, symbols: symbols.length, withBody: out.withBody, withDocstring: out.withDocstring }))
console.log(files.map((f: any) => `${f.relative_path} [${f.language}]`).join("\n"))
