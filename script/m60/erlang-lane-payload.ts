/**
 * ERLANG LANE PAYLOAD / LATENCY CHECK — run after every change that adds edges.
 *
 * The workstream's rule: `bb_graph`'s UN-NARROWED `relationshipTypes` default is
 * 2.5–4.8x a filtered answer (lodash 487 KiB vs 101 KiB, ripgrep 795 vs 321), so adding
 * edges is not free downstream and the lane's own check has to be re-run — and if a budget
 * regresses, REPORT it rather than re-baseline quietly.
 *
 * WHAT IS MEASURED, on a fixed, purely order-dependent sample (the first N admitted corpus
 * files, no RNG — the shared differential's cold pool draws a different 60 per run, which is
 * why this lane keeps its own instrument):
 *
 *   payload.all        serialized bytes of every relationship the analyzer emits (what
 *                      bb_graph returns with no relationshipTypes filter)
 *   payload.filtered   the same, filtered to ONE label — the narrowed answer. `calls` is the
 *                      lane's largest class, so it is the filtered baseline, and the ratio is
 *                      therefore the pessimistic one for this lane.
 *   ratio              payload.all / payload.filtered: the multiplier a consumer pays for
 *                      NOT narrowing
 *   ms/file            wall clock per file, median and p95, so an O(n^2) term introduced by a
 *                      new pass shows up as a tail
 *
 * Usage: bun script/m60/erlang-lane-payload.ts [--sample 200] [--label AFTER] [--out path]
 *        [--analyzer path] to point at a restored pre-change analyzer for the BEFORE row.
 *
 * BEFORE/AFTER IS A SEPARATE PROCESS ON PURPOSE. Both analyzers cannot be loaded into one
 * process without one module registry winning, and the erlang lane's own performance record
 * says what that costs: an in-process A/B once inverted the ratio because host interference
 * did not scale the two equally. So the BEFORE row is produced by running this same script
 * against a restored copy of the analyzer in a worktree of its own, and the two rows are
 * compared by a human reading two artifacts.
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const argv = process.argv.slice(2)
const argOf = (n: string, d?: string): string | undefined => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d)
const SAMPLE = Number(argOf("sample", "200"))

const LABEL = argOf("label", "run")
const OUT = argOf("out")
const REPOS = (argOf("repos", "otp,elixir")).split(",").map((s) => s.trim()).filter(Boolean)
const ROOT = resolve((import.meta as any).dirname ?? dirname(process.argv[1] ?? "."), "..", "..")

/** `--analyzer <path>`: measure the BEFORE row by restoring that source over
 *  `src/ast/real-erlang-analyzer.ts` for the duration of THIS process, then putting the
 *  committed bytes back. The flag was documented in this file's header and never
 *  implemented, so the BEFORE row was a manual file swap — and a manual swap that gets
 *  killed mid-run leaves the worktree holding the wrong analyzer with no marker, which is
 *  exactly how a stale artifact gets committed.
 *
 *  Two properties make this safe enough to automate:
 *    1. the original bytes are read BEFORE the swap and restored in a `finally`, so a
 *       thrown error cannot leave the tree modified;
 *    2. a sibling backup file is written before the swap and its path is printed, so a
 *       SIGKILL is recoverable by hand rather than silent.
 *  It is still in-place mutation of a tracked file, which is why this script stays
 *  lane-owned and why the header says BEFORE/AFTER is a separate process. */
const ALT_ANALYZER = argOf("analyzer")
const ANALYZER_PATH = join(ROOT, "src", "ast", "real-erlang-analyzer.ts")
let restoreAnalyzer: (() => void) | undefined
if (ALT_ANALYZER) {
  const original = readFileSync(ANALYZER_PATH)
  const backup = `${ANALYZER_PATH}.payloadbak-${process.pid}`
  writeFileSync(backup, original)
  writeFileSync(ANALYZER_PATH, readFileSync(resolve(ALT_ANALYZER)))
  restoreAnalyzer = () => { writeFileSync(ANALYZER_PATH, original); rmSync(backup, { force: true }) }
  console.log(`BEFORE row: swapped in ${ALT_ANALYZER}`)
  console.log(`            original bytes backed up at ${backup} (removed on clean exit)`)
}
process.on("exit", () => { try { restoreAnalyzer?.() } catch { /* the backup path above is the recovery */ } })

const files: string[] = []
for (const repo of REPOS) {
  const dir = join(CR, repo)
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked.sort()) {
    if (!rel.endsWith(".erl") && !rel.endsWith(".hrl")) continue
    const abs = join(dir, rel)
    try {
      if (statSync(abs).size > 512 * 1024) continue
      if (detectLanguageFromPath(abs, readFileSync(abs, "utf8")) !== "erlang") continue
    } catch { continue }
    files.push(abs)
  }
}
files.sort()
// A stride rather than a prefix: the first N admitted files of a sorted corpus are all from
// one directory (`lib/asn1/...`), so a prefix sample measures one corner of the language and
// the p95 tail of a different one. The stride keeps the sample deterministic AND spread.
const stride = Math.max(1, Math.floor(files.length / SAMPLE))
const sample = files.filter((_, i) => i % stride === 0).slice(0, SAMPLE)

const allBytes: number[] = []
const filteredBytes: number[] = []
const ms: number[] = []
const perLabel: Record<string, number> = {}
let relCount = 0
let symCount = 0
let errs = 0

for (const abs of sample) {
  const t0 = performance.now()
  let r: any
  try {
    r = await parseFile(abs, CR)
  } catch (e) {
    errs++
    console.log(`  PARSE ERROR ${abs}: ${(e as Error)?.message}`)
    continue
  }
  ms.push(performance.now() - t0)
  const rels = r.relationships ?? []
  symCount += (r.symbols ?? []).length
  relCount += rels.length
  allBytes.push(Buffer.byteLength(JSON.stringify(rels)))
  const one = rels.filter((x: any) => String(x.type) === "calls")
  filteredBytes.push(Buffer.byteLength(JSON.stringify(one)))
  for (const x of rels) {
    const l = String(x.type ?? x.relationshipType ?? "")
    perLabel[l] = (perLabel[l] ?? 0) + 1
  }
}

const med = (a: number[]): number => { if (a.length === 0) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]! }
const p95 = (a: number[]): number => { if (a.length === 0) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]! }
const kib = (n: number): string => (n / 1024).toFixed(1)

const out = {
  at: new Date().toISOString(),
  label: LABEL,
  sample: sample.length,
  stride,
  admitted: files.length,
  parseErrors: errs,
  relationships: relCount,
  symbols: symCount,
  relationshipsPerFile: +(relCount / Math.max(1, sample.length)).toFixed(1),
  payloadAllBytesMedian: med(allBytes),
  payloadAllKiBMedian: +(med(allBytes) / 1024).toFixed(2),
  payloadCallsOnlyKiBMedian: +(med(filteredBytes) / 1024).toFixed(2),
  unNarrowedToFilteredRatio: +(med(allBytes) / Math.max(1, med(filteredBytes))).toFixed(2),
  msPerFileMedian: +med(ms).toFixed(2),
  msPerFileP95: +p95(ms).toFixed(2),
  perLabel,
}

console.log(`erlang lane payload/latency — ${LABEL}`)
console.log(`  sample                 : ${sample.length} files (every ${stride}th of ${files.length} admitted), ${errs} parse errors`)
console.log(`  symbols                : ${symCount.toLocaleString()}`)
console.log(`  relationships          : ${relCount.toLocaleString()}  (${out.relationshipsPerFile}/file)`)
console.log(`  payload, all labels    : ${kib(med(allBytes))} KiB median per file`)
console.log(`  payload, calls only    : ${kib(med(filteredBytes))} KiB median per file`)
console.log(`  un-narrowed / filtered : ${out.unNarrowedToFilteredRatio}x`)
console.log(`  latency                : ${out.msPerFileMedian} ms/file median, ${out.msPerFileP95} ms/file p95`)
console.log(`  per label              : ${Object.entries(perLabel).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  ")}`)
const outPath = OUT ?? join(ROOT, "validation", "m14", "tmp", `erlang-lane-payload${LABEL === "run" ? "" : `-${LABEL}`}.json`)
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, `${JSON.stringify(out, null, 1)}\n`)
console.log(`\nartifact: ${outPath}`)
