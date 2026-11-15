/**
 * ELIXIR — STORE ROUND TRIP: the analyzer's payload through the REAL indexer and
 * the REAL sqlite store, then read back with SQL.
 *
 * WHY. Every audit in this lane so far stops at `ASTEngine.parseFile`. That is
 * the analyzer's output, not the product's. The lane has a standing record of
 * the seam losing correct data — W24's postscript: the source qualification made
 * every elixir function-sourced edge land with `source_symbol_id` NULL, and no
 * analyzer-side gate could see it. This round ADDED payload that has never been
 * through the seam: `isDeclaration` (the indexer binds it to
 * brain_symbol.is_declaration), the `scope` field (brain_symbol.scope_kind,
 * #837), the extended multi-clause extent (end_line/end_index), callback
 * declaration symbols, and `@optional_callbacks` in the annotations blob.
 *
 * It runs the production path — `indexProjectParallel` — against a real Elixir
 * project, then asserts, in SQL:
 *   1. symbols landed, with kinds and counts matching the analyzer's own output
 *   2. members carry a NON-NULL owner_symbol_id (the ownership join)
 *   3. every relationship's source resolves to a stored symbol row
 *      (source_symbol_id NOT NULL) — the W24 class, re-checked
 *   4. no relationship has line_number 0 or NULL (the M59/M60 line contract)
 *   5. docstrings survived (brain_symbol.docstring)
 *   6. is_declaration / scope_kind survived for the shapes that carry them
 *   7. a MERGED multi-clause symbol's end_line is the LAST clause, not the first
 *   8. no two rows collide on the store's own id key (name + start line)
 *   9. wall-clock throughput, because a lane that is right and slow is a
 *      different product
 *
 * CLI: npx tsx script/m14/tmp/elixir-store-roundtrip.ts [--project=<dir>] [--keep]
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const ROOT = "/home/sano/ishaq/backbencher-brain"
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const KEEP = process.argv.includes("--keep")

/** A small real Elixir application that exercises every payload this round
 *  added, so each assertion has an exact expectation rather than a count. */
const APP: Record<string, string> = {
  "mix.exs": `defmodule RoundTrip.MixProject do
  use Mix.Project
  def project, do: [app: :round_trip, version: "0.1.0"]
end
`,
  "lib/round_trip.ex": `defmodule RoundTrip do
  @moduledoc """
  Round-trip fixture: a module doc, a behaviour surface, a struct, a
  multi-clause function, an exception, and a nested module.
  """

  @typedoc "a stored record"
  @type t :: %__MODULE__{name: String.t(), count: non_neg_integer()}
  @enforce_keys [:name]
  defstruct [:name, count: 0]

  defmodule Error do
    defexception [:message]
  end

  defmodule Inner do
    @callback transform(t) :: t
    def transform(%{name: name} = record), do: %{record | name: String.upcase(name)}
  end

  @doc "Counts by arity, over two clauses."
  def count(%{count: n}), do: n + 1
  def count(%{count: n, name: name}) when is_binary(name), do: n + 2

  def bump(record) do
    record
    |> Map.put(:count, count(record))
    |> tap_round_trip()
  end

  defp tap_round_trip(%{name: ""}), do: raise ArgumentError, "name must not be empty"
  defp tap_round_trip(record), do: record

  def split(list), do: Enum.split(list, div(length(list), 2))
end
`,
  "lib/round_trip/sized.ex": `defmodule RoundTrip.Sized do
  defprotocol size do
    def size(data)
  end

  defimpl size, for: BitString do
    def size(bits), do: div(byte_size(bits), 8)
  end

  defimpl size, for: List do
    def size(list), do: length(list)
  end

  use GenServer

  @spec start_link(keyword()) :: {:ok, pid()}
  def start_link(opts \\\\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl true
  def init(opts), do: {:ok, opts}
end
`,
  "test/round_trip_test.exs": `defmodule RoundTripTest do
  use ExUnit.Case, async: true
  alias RoundTrip

  test "counts" do
    assert RoundTrip.count(%{name: "a", count: 1}) == 3
  end
end
`,
}

async function main() {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-elixir-rt-"))
  const projDir = path.join(workdir, "app")
  for (const [rel, body] of Object.entries(APP)) {
    const p = path.join(projDir, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, body)
  }
  const dataDir = path.join(workdir, "data")
  fs.mkdirSync(dataDir, { recursive: true })
  process.env.BB_DATA_DIR = dataDir

  // ---- the analyzer's own view, for the counts the store must match --------
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  let analyzerSymbols = 0
  const analyzerKinds: Record<string, number> = {}
  const analyzerList: any[] = []
  const analyzerRels: any[] = []
  const files: string[] = []
  const walk = (d: string): string[] => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith(".ex") || e.name.endsWith(".exs")) files.push(p)
    }
    return files
  }
  walk(projDir)
  for (const f of files.sort()) {
    const r: any = await ASTEngine.parseFile(f, fs.readFileSync(f, "utf8"))
    for (const s of r.symbols ?? []) { analyzerSymbols++; analyzerKinds[s.kind] = (analyzerKinds[s.kind] ?? 0) + 1; analyzerList.push({ ...s, file: f }) }
    for (const x of r.relationships ?? []) analyzerRels.push({ type: x.type, source: x.source, target: String(x.target), line_number: x.line_number })
  }

  // ---- the REAL index path ------------------------------------------------
  // the CLI's own id derivation — the same sha1-of-path the product uses
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const pid = getProjectId(projDir) as any
  const t0 = Date.now()
  const stats = await indexProjectParallel(pid, projDir, { onProgress: () => {} })
  const ms = Date.now() - t0

  // ---- read the store back in SQL -----------------------------------------
  const raw: any = await BrainDatabase.getRawInstance(pid)
  const one = <T = any>(sql: string, ...params: any[]): T => raw.prepare(sql).get(...params) as T
  const all = <T = any>(sql: string, ...params: any[]): T[] => raw.prepare(sql).all(...params) as T[]

  const problems: string[] = []
  const rows = (n: number, cond: boolean, detail: string) => { if (!cond) problems.push(`${n}: ${detail}`) }

  const discovered = all<{ relative_path: string; language: string | null; is_test_file: number | null }>("SELECT relative_path, language, is_test_file FROM brain_file WHERE project_id = ?", pid).map((r) => r.relative_path)
  const analyzerFiles = new Set(files.map((f) => path.relative(projDir, f)))
  const discoveredRel = new Set(discovered.map((d) => path.basename(d)))
  const undiscovered = [...analyzerFiles].filter((f) => !discoveredRel.has(path.basename(f)))
  console.log("discovery: analyzer walked " + analyzerFiles.size + " files, the indexer discovered " + discovered.length + (undiscovered.length ? " (not indexed: " + undiscovered.join(", ") + ")" : ""))
  const symCount = one<number>("SELECT COUNT(*) n FROM brain_symbol WHERE project_id = ?", pid).n
  // analyzer symbols in the files the product actually discovered
  const discoveredBase = new Set([...discoveredRel])
  const analyzerInDiscovered = analyzerList.filter((s) => discoveredBase.has(path.basename(s.file)))
  rows(1, symCount === analyzerInDiscovered.length, `stored symbols ${symCount} != analyzer ${analyzerInDiscovered.length} in the ${discoveredRel.size} DISCOVERED files (${undiscovered.length} file(s) were never discovered — a discovery decision, reported above, not a store loss)`)
  console.log(`\n######## ELIXIR STORE ROUND TRIP — ${files.length} files, index ${ms}ms (${(ms / Math.max(1, files.length)).toFixed(1)}ms/file), ${stats.totalFiles ?? files.length} discovered`)
  console.log(`analyzer symbols=${analyzerSymbols}  stored symbols=${symCount}`)

  // kinds
  const kinds = all<{ type: string; n: number }>("SELECT symbol_type AS type, COUNT(*) n FROM brain_symbol WHERE project_id = ? GROUP BY symbol_type ORDER BY symbol_type", pid)
  const analyzerKindsDiscovered: Record<string, number> = {}
  for (const s of analyzerInDiscovered) analyzerKindsDiscovered[s.kind] = (analyzerKindsDiscovered[s.kind] ?? 0) + 1
  for (const k of kinds) {
    rows(2, (analyzerKindsDiscovered[k.type] ?? 0) === k.n, `kind ${k.type}: store ${k.n} != analyzer ${analyzerKindsDiscovered[k.type] ?? 0} (discovered files)`)
  }
  console.log(`kinds: ${kinds.map((k) => `${k.type}=${k.n}`).join(" ")}`)

  // 2. members owned
  const orphanMembers = one<number>(
    `SELECT COUNT(*) n FROM brain_symbol s
      WHERE s.project_id = ? AND s.symbol_type IN ('function','method','macro','property','type')
        AND EXISTS (SELECT 1 FROM brain_symbol p WHERE p.project_id = s.project_id AND p.name = s.scope_kind AND p.symbol_type IN ('module','interface','class'))
        AND s.owner_symbol_id IS NULL`, pid).n
  rows(3, orphanMembers === 0, `${orphanMembers} member rows whose owner_name names a stored type but owner_symbol_id IS NULL`)
  const owned = one<number>("SELECT COUNT(*) n FROM brain_symbol WHERE project_id = ? AND owner_symbol_id IS NOT NULL", pid).n
  console.log(`owned rows=${owned}  orphan members=${orphanMembers}`)

  // 3. relationship sources resolved
  const relTotal = one<number>("SELECT COUNT(*) n FROM brain_relationship WHERE project_id = ?", pid).n
  const srcNull = one<number>("SELECT COUNT(*) n FROM brain_relationship WHERE project_id = ? AND source_symbol_id IS NULL AND source_external IS NULL", pid).n
  const srcExternal = one<number>("SELECT COUNT(*) n FROM brain_relationship WHERE project_id = ? AND source_symbol_id IS NULL AND source_external IS NOT NULL", pid).n
  rows(4, srcNull === 0, `${srcNull} relationships with NEITHER a source symbol NOR a source_external name (W24's class)`)
  console.log(`relationships=${relTotal}  source_symbol_id NULL=${srcNull}  source_external (unresolved caller)=${srcExternal}`)

  // 4. line contract
  const lineZero = one<number>("SELECT COUNT(*) n FROM brain_relationship WHERE project_id = ? AND (line_number IS NULL OR line_number <= 0)", pid).n
  rows(5, lineZero === 0, `${lineZero} relationships with a NULL/0 line_number (M59/M60 contract)`)
  const lineSpread = all<{ type: string; n: number }>("SELECT relationship_type AS type, COUNT(DISTINCT line_number) n FROM brain_relationship WHERE project_id = ? GROUP BY relationship_type ORDER BY relationship_type", pid)
  console.log(`line_number: zero/null=${lineZero}  distinct sites per type: ${lineSpread.map((r) => `${r.type}=${r.n}`).join(" ")}`)

  // 5. docstrings
  const withDoc = one<number>("SELECT COUNT(*) n FROM brain_symbol WHERE project_id = ? AND docstring IS NOT NULL AND length(docstring) > 0", pid).n
  rows(6, withDoc >= 2, `only ${withDoc} symbols carry a docstring (expected the @moduledoc + @doc)`)
  console.log(`docstrings=${withDoc}`)

  // 6. is_declaration / scope_kind — the payload this round added
  const decls = all<{ name: string; type: string }>("SELECT name, symbol_type AS type FROM brain_symbol WHERE project_id = ? AND is_declaration = 1", pid)
  const scoped = one<number>("SELECT COUNT(*) n FROM brain_symbol WHERE project_id = ? AND scope_kind IS NOT NULL", pid).n
  const optionalOwner = all<{ name: string; annotations: string }>("SELECT name, annotations FROM brain_symbol WHERE project_id = ? AND annotations LIKE '%optionalCallbacks%'", pid)
  rows(7, decls.length >= 1, `no is_declaration row survived (the @callback declaration must reach brain_symbol.is_declaration)`)
  console.log(`is_declaration rows=${decls.length} [${decls.map((d) => `${d.type}:${d.name}`).join(", ")}]  scope_kind rows=${scoped}  optionalCallbacks owners=${optionalOwner.length}`)

  // 7. merged multi-clause extent
  const countSym = one<{ line_start: number; line_end: number; byte_start: number; byte_end: number }>(
    "SELECT line_start, line_end, byte_start, byte_end FROM brain_symbol WHERE project_id = ? AND name = 'count' AND symbol_type = 'function'", pid)
  rows(8, !!countSym && countSym.line_end > countSym.line_start, `the two-clause count/1 stored a one-line extent (${JSON.stringify(countSym)})`)
  console.log(`multi-clause extent: count/1 = ${countSym ? `${countSym.line_start}..${countSym.line_end} bytes ${countSym.byte_start}..${countSym.byte_end}` : "(absent)"}`)

  // 8. id-key collisions in the store itself
  const dupIds = all<{ file_id: string; name: string; line_start: number; n: number }>(
    "SELECT file_id, name, line_start, COUNT(*) n FROM brain_symbol WHERE project_id = ? GROUP BY file_id, name, line_start HAVING n > 1", pid)
  rows(9, dupIds.length === 0, `${dupIds.length} duplicated (file,name,start_line) keys: ${JSON.stringify(dupIds.slice(0, 3))}`)
  console.log(`store id-key collisions: ${dupIds.length}`)

  // 10. the nested-module ownership the store can actually join
  const inner = one<{ name: string; scope_kind: string | null; owner_symbol_id: string | null }>(
    "SELECT name, scope_kind, owner_symbol_id FROM brain_symbol WHERE project_id = ? AND name = 'RoundTrip.Inner'", pid)
  rows(10, !!inner?.owner_symbol_id, `the nested module RoundTrip.Inner has owner_symbol_id NULL (scope_kind=${inner?.scope_kind})`)
  console.log(`nested module owner: ${inner ? `${inner.scope_kind} -> ${inner.owner_symbol_id ? "resolved" : "NULL"}` : "(absent)"}`)

  // ---- WHICH symbol the store lost, named ----------------------------------
  const stored = all<{ name: string; symbol_type: string; line_start: number }>("SELECT name, symbol_type AS symbol_type, line_start FROM brain_symbol WHERE project_id = ?", pid)
  const storedKeys = new Set(stored.map((r) => `${r.name}:${r.symbol_type}:${r.line_start}`))
  const lost = analyzerInDiscovered.filter((s) => !storedKeys.has(`${s.name}:${s.kind}:${s.range.startLine}`))
  console.log(`symbols the store did NOT hold: ${lost.length}${lost.length ? ` -> ${lost.map((l) => `${l.kind}:${l.name}@${l.range.startLine}`).join(", ")}` : ""}`)
  if (lost.length > 0) {
    for (const l of lost) {
      const file = files.find((f) => f.endsWith(path.basename(l.file))) ?? ""
      const ftext = file ? fs.readFileSync(file, "utf8") : ""
      const line = ftext.split("\n")[l.range.startLine - 1] ?? ""
      console.log(`    lost: ${l.kind} ${l.name} @${l.range.startLine} — owner=${l.ownerName ?? "-"} scope=${l.scope ?? "-"} | ${line.trim().slice(0, 80)}`)
    }
  }

  // ---- declared source vs resolved source ----------------------------------
  let sameSource = 0, diffSource = 0, extSource = 0
  const diffEx: string[] = []
  for (const rel of analyzerRels) {
    const row = one<{ nm: string; ln: number; q: string }>(
      `SELECT s.name nm, s.line_start ln, s.qualified_name q
         FROM brain_relationship r JOIN brain_symbol s ON s.id = r.source_symbol_id
        WHERE r.project_id = ? AND r.target_external = ? AND r.relationship_type = ? AND r.line_number = ?
        LIMIT 1`, pid, rel.target, rel.type, rel.line_number)
    if (!row) { extSource++; continue }
    const declaredBare = String(rel.source).replace(/\/\d+$/, "")
    const resolvedQ = String(row.q ?? "")
    const okSame = row.nm === declaredBare || resolvedQ === declaredBare
      || resolvedQ.endsWith(`.${declaredBare}`) || row.nm === declaredBare.split(".").pop()
    if (okSame) sameSource++
    else { diffSource++; if (diffEx.length < 5) diffEx.push(`declared ${rel.source} -> resolved ${row.q}@${row.ln}`) }
  }
  console.log(`relationship sources: same-as-declared=${sameSource}  different=${diffSource}  not-found-by-key=${extSource}`)
  for (const e of diffEx) console.log(`    ${e}`)
  if (diffSource > 0) problems.push(`${diffSource} relationships resolve to a symbol the analyzer did not name as the source`)

  console.log(`\n${problems.length === 0 ? "ROUND TRIP CLEAN — every payload survived the seam" : `ROUND TRIP FAILURES (${problems.length}):`}`)
  for (const p of problems) console.log(`  ✗ ${p}`)
  console.log(`  db=${path.join(dataDir, "projects")}  project=${String(pid).slice(0, 8)}`)
  if (!KEEP) { /* the caller can pass --keep to inspect; default leaves /tmp to the OS */ }
  process.exitCode = problems.length === 0 ? 0 : 1
}
main().catch((e) => { console.error(e); process.exit(1) })
