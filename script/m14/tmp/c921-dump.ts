// #921 A/B dump: through the PRODUCTION entry (ASTEngine.parseFile), over a
// deterministic c/cpp sample of the four pinned corpora, dump every symbol
// (name/kind/owner/range) and every relationship (source/target/type/line) so a
// pre-fix vs post-fix run can be diffed row by row. `git ls-files` order, so the
// file set does not depend on the walk.
//
//   bun script/m14/tmp/c921-dump.ts <out.json> [filesPerCorpus]
import { execSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"

const R = "<corpus-root>/bb_tests/repositories"
const CORPORA = ["jq", "sqlite", "fmt", "nlohmann-json"]
const EXT = /\.(c|h|cc|cpp|cxx|hpp|hh)$/
const out = process.argv[2] ?? "/tmp/c921-dump.json"
const cap = parseInt(process.argv[3] ?? "120")

const payload: any = { at: new Date().toISOString(), cap, corpora: {} }
for (const repo of CORPORA) {
  const dir = path.join(R, repo)
  let files: string[] = []
  try {
    files = execSync("git ls-files", { cwd: dir, maxBuffer: 64 * 1024 * 1024 })
      .toString()
      .split("\n")
      .filter((f) => EXT.test(f))
      .sort()
      .slice(0, cap)
  } catch {
    continue
  }
  const rows: any[] = []
  for (const f of files) {
    const abs = path.join(dir, f)
    let text: string
    try {
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    let res: any
    try {
      res = await ASTEngine.parseFile(abs, text)
    } catch (e: any) {
      rows.push({ file: f, error: String(e?.message ?? e).slice(0, 120) })
      continue
    }
    rows.push({
      file: f,
      language: res.language,
      symbols: (res.symbols ?? []).map((s: any) => ({
        name: s.name,
        kind: s.kind,
        owner: s.ownerName ?? null,
        start: s.range?.startLine ?? null,
        end: s.range?.endLine ?? null,
        vis: s.visibility ?? null,
      })),
      rels: (res.relationships ?? []).map((r: any) => ({
        s: r.source,
        t: r.target,
        type: r.type,
        line: r.line_number ?? null,
      })),
    })
  }
  payload.corpora[repo] = rows
  console.log(`[${repo}] ${rows.length} file(s) dumped`)
}
writeFileSync(out, JSON.stringify(payload))
console.log(`wrote ${out}`)
