// validation/tools/bb_annotations/work/real-corpus-index.mts
//
// REAL-CORPUS leg, part 1: index real repositories into this lane's ISOLATED
// BB_DATA_DIR and record the facts the door leg needs (population, a code-level
// subject whose qualified name differs from its name, a shared plain name, and
// the file the subject is declared in).
//
// Indexing runs in this process and then EXITS; the MCP door runs in a separate,
// light process (real-corpus-door.mjs). Keeping them apart is deliberate: the
// indexer leaves heavy background work behind, and a door probe sharing that
// process measured the parent's GC instead of the door.
//
// Run: BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_annotations/work/real-corpus-index.mts
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..", "..", "..")
const require = createRequire(import.meta.url)
const DATA_DIR = join(HERE, "..", "bbdata-real")
mkdirSync(DATA_DIR, { recursive: true })
process.env.BB_DATA_DIR = DATA_DIR
process.env.BB_NO_AUTO_REFRESH = "1"

const CORPUS_ROOT = "/home/ishaq2321/bb_tests/repositories"
const CORPORA = ["graphql-js", "rake", "rebar3"]

const { getProjectId } = await import(join(ROOT, "src", "util", "project-id.ts"))
const { indexProjectParallel } = await import(join(ROOT, "src", "ast", "parallel-indexer.ts"))
const Database = require("better-sqlite3")

const facts: any = {
  schemaVersion: 1,
  tool: "bb_annotations",
  leg: "REAL CORPUS index facts (part 1 of 2)",
  measuredAt: new Date().toISOString(),
  currentCommit: (() => { try { return require("node:child_process").execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" } })(),
  dataDir: DATA_DIR,
  corpusRoot: CORPUS_ROOT,
  command: "BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_annotations/work/real-corpus-index.mts",
  corpora: {},
}

for (const name of CORPORA) {
  const workspace = realpathSync.native(join(CORPUS_ROOT, name))
  const projectId = getProjectId(workspace)
  const projectDir = join(DATA_DIR, "projects", projectId)
  if (existsSync(projectDir)) rmSync(projectDir, { recursive: true, force: true })
  const started = Date.now()
  await (indexProjectParallel as any)(projectId, workspace, {})
  const indexMs = Date.now() - started
  const dbFile = join(projectDir, "brain.db")
  const ro = new Database(dbFile, { readonly: true, fileMustExist: true })
  const population = {
    files: (ro.prepare("SELECT COUNT(*) n FROM brain_file WHERE project_id = ?").get(projectId) as any).n,
    symbols: (ro.prepare("SELECT COUNT(*) n FROM brain_symbol WHERE project_id = ?").get(projectId) as any).n,
    relationships: (ro.prepare("SELECT COUNT(*) n FROM brain_relationship WHERE project_id = ?").get(projectId) as any).n,
    annotations: (ro.prepare("SELECT COUNT(*) n FROM brain_annotation WHERE project_id = ?").get(projectId) as any).n,
    languages: ro.prepare("SELECT language l, COUNT(*) n FROM brain_file WHERE project_id = ? AND language IS NOT NULL GROUP BY language ORDER BY n DESC").all(projectId),
  }
  const codeLanguage = (ro.prepare(
    `SELECT language l, COUNT(*) n FROM brain_file
     WHERE project_id = ? AND language IS NOT NULL
       AND language NOT IN ('markdown','json','yaml','xml','graphql','text','bash','make','powershell','dockerfile','toml','ini')
     GROUP BY language ORDER BY n DESC LIMIT 1`,
  ).get(projectId) as any)?.l ?? null
  // A code-level symbol the editor accepts under a second name form: its
  // qualified name differs from its simple name, it is declared in a non-test
  // file of the corpus's dominant code language, and it is a callable.
  const subject = (ro.prepare(
    `SELECT s.name AS name, s.qualified_name AS qualified, s.symbol_type AS symbol_type,
            s.line_start AS line, f.relative_path AS relative_path, f.language AS language
     FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
     WHERE s.project_id = ? AND s.qualified_name IS NOT NULL AND s.qualified_name != s.name
       AND f.language = ? AND f.is_test_file = 0
     ORDER BY CASE s.symbol_type WHEN 'function' THEN 0 WHEN 'method' THEN 0 WHEN 'constructor' THEN 1 ELSE 2 END,
              LENGTH(s.qualified_name), s.name LIMIT 1`,
  ).get(projectId, codeLanguage) as any) ?? null
  // How many symbols publish a SECOND name form at all. A corpus whose indexer
  // stores qualified_name = name for every symbol (Erlang here) has no natural
  // qualified-name read-back to test; the leg is then declared not applicable
  // rather than fabricated.
  const secondNameFormRows = (ro.prepare(
    `SELECT COUNT(*) n FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
     WHERE s.project_id = ? AND f.language = ? AND s.qualified_name IS NOT NULL AND s.qualified_name != s.name`,
  ).get(projectId, codeLanguage) as any).n
  const plain = (ro.prepare(
    "SELECT name, COUNT(*) n FROM brain_symbol WHERE project_id = ? AND name IS NOT NULL GROUP BY name ORDER BY n DESC, name LIMIT 1",
  ).get(projectId) as any) ?? null
  ro.close()
  facts.corpora[name] = {
    workspace,
    projectId,
    database: { path: dbFile, bytes: statSync(dbFile).size, mtimeMs: statSync(dbFile).mtimeMs },
    indexCommand: `BB_NO_AUTO_REFRESH=1 BB_DATA_DIR=${DATA_DIR} npx tsx <real-corpus-index.mts> -> indexProjectParallel(${JSON.stringify(workspace)})`,
    indexMs,
    population,
    codeLanguage,
    secondNameFormRows,
    subject,
    plain,
  }
  console.log(JSON.stringify({ corpus: name, projectId, indexMs, codeLanguage, subject, plain, population: { files: population.files, symbols: population.symbols, relationships: population.relationships } }, null, 1))
}

writeFileSync(join(HERE, "..", "raw", "real-corpus-facts.json"), JSON.stringify(facts, null, 2) + "\n")
console.log("wrote raw/real-corpus-facts.json")
process.exit(0)
