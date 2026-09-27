// M12.32: measure Lua extraction on the tracked LuaRocks corpus only.
import { parseFile } from "../../src/ast/pool-worker"
import { measureOperation } from "../m11/differential-harness"
import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"

const ROOT = process.cwd()
const corpus = process.argv[2] || "$HOME/fixtures/repositories/luarocks"
const relative = execFileSync("git", ["-C", corpus, "ls-files", "*.lua", "*.luau"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean)
const files = relative.map((file) => `${corpus}/${file}`)
const revision = execFileSync("git", ["-C", corpus, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
const { value, measurement } = await measureOperation(
  "lua-corpus-tracked",
  async () => {
    let symbols = 0
    let relationships = 0
    let errors = 0
    for (const file of files) {
      try {
        const parsed = await parseFile(file, ROOT)
        symbols += parsed.symbols?.length ?? 0
        relationships += parsed.relationships?.length ?? 0
        errors += parsed.errors?.length ?? 0
      } catch {
        errors++
      }
    }
    return { symbols, relationships, errors }
  },
  { files: files.length },
)
measurement.symbols = value.symbols
measurement.relationships = value.relationships
measurement.parseErrors = value.errors
measurement.symbolsPerSecond = measurement.wallTimeMs > 0 ? value.symbols / (measurement.wallTimeMs / 1000) : null
measurement.relationshipsPerSecond = measurement.wallTimeMs > 0 ? value.relationships / (measurement.wallTimeMs / 1000) : null
// The corpus name was HARDCODED to "luarocks" while `revision` was read from
// whichever repo the caller passed. Running it against luvit therefore produced an
// artifact that claimed corpus "luarocks" carrying luvit's revision a63febc — an
// evidence record that lies about what it measured, and the committed
// lua-corpus-complexity.json carried exactly that pairing. The name is now
// DERIVED from the path, and the path itself is recorded so the claim is
// checkable rather than asserted.
//
// `currentCommit` is the repository's own HEAD, which is what the M60 `fresh` cell
// asks for: an artifact pinned to the tree that produced it. Without it the cell
// can only report "unpinned, disclosed", which is what this lane was reporting
// while holding a corpus claim nobody could reproduce — the same defect #18658d99
// recorded for the sql lane.
const currentCommit = execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
const document = {
  schemaVersion: 1,
  kind: "lua_corpus_tracked_complexity",
  corpus: corpus.split("/").filter(Boolean).pop() ?? corpus,
  corpusPath: corpus,
  revision,
  currentCommit,
  trackedLuaFiles: files.length,
  measurement,
  note: "Tracked .lua/.luau files only; production pool-worker parseFile path with the isolated Lua parser lifecycle; no generated or untracked files included. `corpus` is derived from the measured path, not hardcoded: it previously read \"luarocks\" while `revision` came from whichever repo was passed, so running this against luvit produced an artifact claiming one corpus and carrying another's revision.",
}
writeFileSync("validation/m12/results/lua-corpus-complexity.json", JSON.stringify(document, null, 2) + "\n")
console.log(`files=${files.length} symbols=${value.symbols} relationships=${value.relationships} parseErrors=${value.errors} wall=${measurement.wallTimeMs.toFixed(1)}ms peakRSS=${(measurement.peakRssBytes / 1048576).toFixed(1)}MB`)
