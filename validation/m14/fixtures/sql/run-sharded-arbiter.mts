/**
 * RUN THE SUPERVISOR'S ARBITER OVER THE WHOLE SQL CORPUS, IN SHARDS.
 *
 * WHY THIS EXISTS. `run-ruling-table.mts` proves the arbiter's verdict logic over this
 * lane's ruling table, but it runs the arbiter in ONE process over all 1,955 admitted
 * files — and that run does not finish:
 *
 *   [BB-PARSE-ERR] sql | .../duckdb/benchmark/aoc24/queries/day03.sql | memory access out of bounds
 *   [BB-HANG] parser stuck 120s on .../duckdb/benchmark/aoc24/queries/day03.sql — exiting
 *   exit 1
 *
 * `engine.ts` answers a 120 s parser hang with `process.exit(1)`, so the arbiter prints its
 * header, its corpus size, and NOTHING ELSE. That is not a lane verdict and it is not a
 * lane failure; it is the arbiter's process budget, and pass 3 measured that the fault is
 * not a property of any one file:
 *
 *   - all 25 `duckdb/benchmark/aoc24/queries/day*.sql` parse solo in 0.7–7.6 s with no fault
 *   - across 4 rounds of 8-way CONTENDED parsing of exactly those files: 0 faults, 0 hangs
 *     (`measurements/pass3-fault-contended-r1.json`)
 *
 * so the fault emerges from SUSTAINED wasm state across a long walk. Excluding files by
 * name cannot fix it (pass 2's three-name list grew to seven purely by being killed again),
 * and bounding the PROCESS does. That is what the lane's own census already does
 * (`run-sharded-census.sh`, 4 contiguous shards + a serial repair pass).
 *
 * This script applies the SAME bound to the ARBITER so the supervisor's own verdict logic —
 * not a second implementation of it — produces a verdict over the whole corpus:
 *
 *   1. count admitted SQL files per repo with the arbiter's OWN admission rule
 *      (git-tracked, <= 512 KB, `detectLanguageFromPath === "sql"`), so the shard split
 *      cannot change which files are in scope;
 *   2. bin-pack whole REPOS into N shards — repos are atomic, so a repo is never split and
 *      the union of the shards is exactly the corpus the single-process run admitted;
 *   3. build each shard root as a directory of symlinks to repo directories, which is what
 *      the arbiter's corpus walk can read (`statSync` follows the link, `git -C` works
 *      through it), and hand it to the patched copy via `BB_CORPUS_ROOT`;
 *   4. merge the per-shard tables by the arbiter's OWN precedence: a type is FALSIFIED if
 *      ANY shard falsifies it, EMITTED if any shard emitted it, and only then RULED-SOUND /
 *      RULED-UNJUSTIFIED. Edge counts and file counts sum. A grammar inventory is a UNION of
 *      node-type vocabularies, not a maximum — a construct absent from every shard's
 *      vocabulary is absent from the corpus.
 *
 * The merge is arithmetic over the arbiter's printed rows; it decides no verdict of its own.
 * A shard that dies is reported as a shard that died, with its exit status, and is NOT
 * counted as zero: the merged table says how many shards answered.
 *
 * WHAT A PER-SHARD VERDICT DOES AND DOES NOT MEAN, because it is easy to over-read. In a shard
 * holding 19 files, `calls` reads 0 and the arbiter prints RULED-SOUND — but that shard's grammar
 * inventory covers only ITS files, so its RULED-SOUND is a weaker claim than a whole-corpus one,
 * and 5 of the 8 shards here print RULED-SOUND for a type that fires perfectly well elsewhere.
 * Two consequences, both handled by the merge rather than by the shards:
 *   - EMITTED wins over RULED-SOUND, so a type that fires in any shard is EMITTED. Correct: the
 *     question is whether the type fires on the corpus, and one firing shard answers it.
 *   - for a type NO shard emits, the basis is the UNION of all 8 shards' node-type vocabularies,
 *     which is the whole corpus. So a RULED verdict is not weakened by sharding, while an EMITTED
 *     verdict is only ever as strong as "some shard saw it".
 * The per-shard status of every type is in `rows[].perShard` so this can be checked rather than
 * taken on trust.
 *
 * The `files` column is NOT a census: the arbiter caps its own counter (`if (obs.files.size < 4)`),
 * so each shard's number is a floor of 4 and the column sums floors. It is labelled `sumOf4+`.
 *
 * USAGE:
 *   npx tsx validation/m14/fixtures/sql/run-sharded-arbiter.mts [--shards 8] [--json OUT]
 */
import { execFileSync } from "node:child_process"
import { mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync, rmSync, mkdirSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const intArg = (f: string, d: number) => { const i = argv.indexOf(f); return i >= 0 ? Number(argv[i + 1]) : d }
const SHARDS = intArg("--shards", 8)
const JSON_OUT = argv.includes("--json") ? argv[argv.indexOf("--json") + 1] : undefined

const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]
type Status = "EMITTED" | "RULED-SOUND" | "FALSIFIED" | "RULED-UNJUSTIFIED"

// ---------------------------------------------------------------- 1. the patched copy
const gatePath = path.join(ROOT, "script/m14/ontology-coverage-gate.ts")
const gateDir = mkdtempSync(path.join(ROOT, "node_modules", ".bb-sql-shard-gate-"))
const patched = path.join(gateDir, "ontology-coverage-gate-with-sql.mts")
{
  const src = readFileSync(gatePath, "utf8")
    .replace(/from "\.\.\/\.\.\/src\/ast\//g, `from "${ROOT}/src/ast/`)
    .replace(/from "\.\/([A-Za-z0-9_-]+)"/g, (_m, name) => `from "${ROOT}/script/m14/${name}"`)
    .replace(
      "const RULED_BY_LANG: Record<string, Ruled[]> = {",
      'import { SQL_RULED } from "' + ROOT + '/script/m14/sql-ruled"\nconst RULED_BY_LANG: Record<string, Ruled[]> = { sql: SQL_RULED,',
    )
  if (!/\bsql: SQL_RULED/.test(src)) {
    console.error("the patch did not apply: the arbiter's RULED_BY_LANG literal is not the shape this script expects.")
    console.error("That is a report-to-supervisor item, not something to work around silently.")
    process.exit(2)
  }
  writeFileSync(patched, src)
}

// ---------------------------------------------------------------- 2. admission, by the arbiter's rule
type Repo = { name: string; dir: string; sqlFiles: number }
const repos: Repo[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue; execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  let n = 0
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
    let text: string
    try { text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) === "sql") n++
  }
  if (n > 0) repos.push({ name: e, dir, sqlFiles: n })
}
repos.sort((a, b) => b.sqlFiles - a.sqlFiles || a.name.localeCompare(b.name))
const totalFiles = repos.reduce((s, r) => s + r.sqlFiles, 0)
console.log(`corpus root: ${CR}`)
console.log(`admitted: ${totalFiles} SQL files in ${repos.length} repositories (git-tracked, <= 512 KB, detectLanguageFromPath === "sql")`)
console.log(`shards: ${SHARDS}\n`)

// ---------------------------------------------------------------- 3. bin-pack whole repos
const bins: Repo[][] = Array.from({ length: SHARDS }, () => [])
const load = new Array(SHARDS).fill(0)
for (const r of repos) {
  let best = 0
  for (let i = 1; i < SHARDS; i++) if (load[i] < load[best]) best = i
  bins[best].push(r)
  load[best] += r.sqlFiles
}
const shardRoot = mkdtempSync(path.join(os.tmpdir(), "bb-sql-shards-"))
for (let i = 0; i < SHARDS; i++) {
  const d = path.join(shardRoot, `shard${i}`)
  mkdirSync(d)
  for (const r of bins[i]) symlinkSync(r.dir, path.join(d, r.name))
  console.log(`  shard${i}: ${load[i]} files in ${bins[i].length} repos`)
}
console.log()

// ---------------------------------------------------------------- 4. run
type Shard = { shard: number; admitted: number; status: Record<Type, Status>; detail: Record<Type, string>; exited: number | null; hang: boolean }
const shards: Shard[] = []
for (let i = 0; i < SHARDS; i++) {
  const d = path.join(shardRoot, `shard${i}`)
  process.stdout.write(`shard${i} (${load[i]} files) … `)
  let out = ""
  let exited: number | null = null
  try {
    out = execFileSync("npx", ["tsx", patched, "sql"], {
      cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, BB_CORPUS_ROOT: d },
      stdio: ["ignore", "pipe", "pipe"],
    })
    exited = 0
  } catch (e: any) {
    out = String(e.stdout ?? "")
    exited = typeof e.status === "number" ? e.status : null
  }
  const hang = /\[BB-HANG\]/.test(out) || exited === 1
  const admitted = Number(/corpus: (\d+) admitted files/.exec(out)?.[1] ?? 0)
  const status = {} as Record<Type, Status>
  const detail = {} as Record<Type, string>
  for (const line of out.split("\n")) {
    const m = /^(calls|uses|contains|imports|references|exports|extends|implements|overrides|instantiates)\s{2,}(EMITTED|RULED-SOUND|FALSIFIED|RULED-UNJUSTIFIED)\s+(.*)$/.exec(line)
    if (m) { status[m[1] as Type] = m[2] as Status; detail[m[1] as Type] = m[3].trim() }
  }
  shards.push({ shard: i, admitted, status, detail, exited, hang })
  const answered = ALL_TYPES.filter((t) => status[t]).length
  console.log(`${answered === 10 ? "ok" : `INCOMPLETE (${answered}/10 rows, exit ${exited ?? "signal"}, hang=${hang})`} — ${admitted} files`)
}

// ---------------------------------------------------------------- 5. merge, by the arbiter's own precedence
const RANK: Record<Status, number> = { FALSIFIED: 0, EMITTED: 1, "RULED-SOUND": 2, "RULED-UNJUSTIFIED": 3 }
const answeredShards = shards.filter((s) => ALL_TYPES.every((t) => s.status[t]))
const merged = ALL_TYPES.map((t) => {
  const seen = shards.filter((s) => s.status[t])
  // EMITTED edges sum; a shard that did not answer contributes nothing and says so.
  const nEdges = seen.reduce((sum, s) => sum + (Number(/^([\d,]+) edges in/.exec(s.detail[t] ?? "")?.[1]?.replace(/,/g, "") ?? 0)), 0)
  const nFiles = seen.reduce((sum, s) => sum + (Number(/edges in ([\d,]+)\+ files/.exec(s.detail[t] ?? "")?.[1]?.replace(/,/g, "") ?? 0)), 0)
  const worst = seen.slice().sort((a, b) => RANK[a.status[t]] - RANK[b.status[t]])[0]
  // PER-SHARD EDGES AND FILES, not only per-shard STATUS. Two runs of this script on the same
  // corpus at the same HEAD disagreed on `uses` (9,099 then 9,106) with an identical verdict
  // line, and with only per-shard STATUS recorded there was nothing in the artifact to
  // attribute it to. The per-shard totals make the disagreement localisable: whichever shard
  // moved is the shard whose files degraded. See `totalsAreLowerBounds` in the artifact.
  const perShard = seen.map((s) => ({
    shard: s.shard,
    status: s.status[t],
    admitted: s.admitted,
    detail: s.detail[t] ?? "",
    edges: Number(/^([\d,]+) edges in/.exec(s.detail[t] ?? "")?.[1]?.replace(/,/g, "") ?? 0),
    files: Number(/edges in ([\d,]+)\+ files/.exec(s.detail[t] ?? "")?.[1]?.replace(/,/g, "") ?? 0),
  }))
  // The node-type inventory a RULED row prints is the inventory of the WORST shard, because the
  // detail string is taken from `worst` — and the gate's wording for it is "across the
  // corpus", which it is not. A RULED verdict is still sound (the merge rests on the UNION of
  // all shards' vocabularies, and a type absent from every one is absent from the corpus), but
  // the printed count is a floor on the union, not the union. Recorded per shard below so the
  // union's size is auditable rather than asserted.
  const nodeTypes = (d: string) => { const m = /produced (\d+) distinct node types/.exec(d ?? ""); return m ? Number(m[1]) : null }
  return {
    type: t,
    status: worst?.status[t] ?? "RULED-UNJUSTIFIED",
    shardsReporting: seen.length,
    edges: nEdges,
    files: nFiles,
    perShard: seen.map((s) => `${s.shard}:${s.status[t]}`),
    perShardDetail: perShard,
    nodeTypesPerShard: perShard.map((s) => ({ shard: s.shard, nodeTypes: nodeTypes(s.detail) })),
    printedNodeTypes: nodeTypes(worst?.detail[t] ?? ""),
    printedNodeTypesIsWorstShardNotUnion: true,
    detail: worst?.detail[t] ?? "",
  }
})

const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
// The arbiter caps its own file counter (`if (obs.files.size < 4)`), so a per-shard file
// count is a floor of 4, not a count. Summing floors would print a number that looks like a
// census and is not one, so the column is labelled as the sum of floors it is.
console.log(`\n${w("type", 14)}${w("status", 20)}${w("edges", 10)}${w("sumOf4+", 8)}${w("shards", 8)}detail`)
console.log("-".repeat(140))
for (const r of merged) {
  const edges = r.status === "EMITTED" ? r.edges.toLocaleString() : ""
  const files = r.status === "EMITTED" ? String(r.files) : ""
  console.log(`${w(r.type, 14)}${w(r.status, 20)}${w(edges, 10)}${w(files, 8)}${w(`${r.shardsReporting}/${SHARDS}`, 8)}${r.detail}`)
}
console.log("-".repeat(140))
const cnt = (s: Status) => merged.filter((r) => r.status === s).length
console.log(`emitted ${cnt("EMITTED")}/10   ruled-sound ${cnt("RULED-SOUND")}   FALSIFIED ${cnt("FALSIFIED")}   ruled-without-justification ${cnt("RULED-UNJUSTIFIED")}`)
console.log(`shards that answered all ten rows: ${answeredShards.length}/${SHARDS}`)
// The per-shard STATUS column is what decides a verdict. Say out loud that it is not what a
// reader would otherwise assume the node-type count means, because the gate's own wording
// ("across the corpus") is wrong for a per-shard inventory and the wrong reading is the
// stronger-sounding one in the wrong direction: it UNDERSTATES the inventory the rulings
// actually rest on.
{
  const ruled = merged.filter((r) => r.status === "RULED-SOUND" || r.status === "RULED-UNJUSTIFIED")
  if (ruled.length) {
    const worstInv = ruled.map((r) => r.printedNodeTypes).filter((n): n is number => typeof n === "number")
    const unionFloor = Math.max(...worstInv, 0)
    console.log(`\nnode-type inventory: the ${ruled.length} ruled rows print ONE shard's vocabulary each (the worst-ranked shard),`)
    console.log(`not the corpus union — the gate's phrase "across the corpus" is inaccurate for it. Largest printed = ${unionFloor}.`)
    console.log(`The merge rests on the UNION of all ${SHARDS} shards' vocabularies, so each printed count is a floor on it.`)
    console.log(`Per-shard inventories are in the --json artifact; the corpus-wide union measured by an independent`)
    console.log(`walker over the same ${totalFiles} files is 480 (pass3-construct-probe.json).`)
  }
}
if (answeredShards.length < SHARDS) {
  console.log(`NOT every shard answered. A shard that did not answer is not a zero: the merged table is over ${answeredShards.length} shards.`)
  console.log(`shards: ${shards.map((s) => `${s.shard}=${s.exited ?? "signal"}${s.hang ? "(hang)" : ""}`).join(" ")}`)
}
if (cnt("FALSIFIED")) console.log(`\n>>> THIS GATE FAILS. ${merged.filter((r) => r.status === "FALSIFIED").map((r) => r.type).join(", ")} claimed inapplicable but demonstrably derivable from real code.`)

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({
    instrument: "validation/m14/fixtures/sql/run-sharded-arbiter.mts",
    arbiter: "script/m14/ontology-coverage-gate.ts (patched copy; on-disk arbiter untouched)",
    rulingTable: "script/m14/sql-ruled.ts",
    entryPoint: "parseFile (src/ast/pool-worker.ts)",
    corpusRoot: CR, shards: SHARDS, repos: repos.length, admittedFiles: totalFiles,
    shardsAnswering: answeredShards.length,
    /**
     * The EDGE TOTALS IN `rows` ARE LOWER BOUNDS, and the verdict is not.
     *
     * Measured at HEAD bb0ec1786 on an unchanged corpus: two runs of this script disagreed on
     * `uses` — 9,099 then 9,106 — with an identical verdict line and 8/8 shards answering all
     * ten rows both times. The lane's own census, which re-parses a degraded file serially
     * before counting it, reads 9,106 at 0 degraded files on both occasions.
     *
     * Cause: `engine.ts` answers an analyzer timeout with a SUCCESS-shaped basic parse result
     * (symbols: [], relationships: [], one error), so a file that degrades under load
     * contributes ZERO edges and nothing in the gate's output says so. This runner has no
     * serial-repair pass because the repair belongs to the census's instrument, not to the
     * arbiter's, and `script/m14/ontology-coverage-gate.ts` is shared machinery (§8).
     *
     * So: read `rows[].status` as the verdict — it is invariant across runs — and read
     * `rows[].edges` as "at least this many". For an exact per-type total, use the census.
     */
    totalsAreLowerBounds: true,
    totalsLowerBoundEvidence: "pass7-sharded-arbiter.json (uses 9,099) vs pass7-census.json (uses 9,106, 0 degraded)",
    perShard: shards.map((s) => ({ shard: s.shard, admitted: s.admitted, exited: s.exited, hang: s.hang, answered: ALL_TYPES.filter((t) => s.status[t]).length })),
    rows: merged,
  }, null, 2) + "\n")
  console.log(`\nartifact: ${JSON_OUT}`)
}

rmSync(shardRoot, { recursive: true, force: true })
rmSync(gateDir, { recursive: true, force: true })
process.exitCode = cnt("FALSIFIED") + cnt("RULED-UNJUSTIFIED") === 0 && answeredShards.length === SHARDS ? 0 : 1
