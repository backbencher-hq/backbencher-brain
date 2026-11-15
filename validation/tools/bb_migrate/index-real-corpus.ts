// Index the real cross-language corpora used by REAL-CORPUS.json into an isolated BB_DATA_DIR.
// The corpus trees are READ; only the isolated index is written.
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { getProjectId } from "../../../src/cli/index"
import { indexProjectParallel } from "../../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../../src/brain/database"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const OUT = path.join(ROOT, "validation/tools/bb_migrate/raw/real-corpus-index.json")
const repos: Array<{ id: string; dir: string; note: string }> = [
  { id: "elixir", dir: path.join(CORPUS, "elixir"), note: "Elixir source with an Erlang-in-Elixir tree — the cross-language pair" },
  { id: "rebar3", dir: path.join(CORPUS, "rebar3"), note: "Erlang (rebar3) — erlang -> elixir is a registered route" },
  { id: "clojure", dir: path.join(CORPUS, "clojure"), note: "Clojure — clojure -> typescript is a registered route" },
  { id: "graphql-js", dir: path.join(CORPUS, "graphql-js"), note: "JavaScript — javascript -> python/ts are registered routes" },
]
const results: any[] = []
for (const repo of repos) {
  if (!existsSync(repo.dir)) { results.push({ ...repo, skipped: "corpus absent" }); continue }
  const projectId = getProjectId(repo.dir)
  const started = Date.now()
  await indexProjectParallel(projectId, repo.dir, {})
  const indexMs = Date.now() - started
  const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
  const counts = raw.prepare(
    `SELECT (SELECT COUNT(*) FROM brain_file WHERE project_id=?) files,
            (SELECT COUNT(*) FROM brain_symbol WHERE project_id=?) symbols,
            (SELECT COUNT(*) FROM brain_relationship WHERE project_id=?) relationships,
            (SELECT COUNT(*) FROM brain_import WHERE file_id IN (SELECT id FROM brain_file WHERE project_id=?)) imports`,
  ).get(projectId, projectId, projectId, projectId) as any
  const byLanguage = raw.prepare(
    `SELECT COALESCE(f.language,'unknown') language, COUNT(*) symbols FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? GROUP BY f.language ORDER BY symbols DESC`,
  ).all(projectId) as any[]
  const crossLanguage = raw.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE project_id=? AND is_cross_language=1").get(projectId) as any
  results.push({ id: repo.id, dir: repo.dir, note: repo.note, projectId, indexMs, counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Number(v)])), crossLanguageRelationships: Number(crossLanguage.c), byLanguage: byLanguage.map((r: any) => ({ language: r.language, symbols: Number(r.symbols) })) })
  console.log(JSON.stringify(results[results.length - 1]))
}
mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify({ indexedAt: new Date().toISOString(), dataDir: process.env.BB_DATA_DIR, repos: results }, null, 1))
