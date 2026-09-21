// M12 per-analyzer complexity measurement.
//
// Measures the extraction complexity envelope of a single analyzer on its
// fixtures: wall time, symbols/s, relationships/s, peak RSS. Optionally runs
// a corpus subset too (pass the corpus dir as second arg).
//
// Usage: bun script/m12/measure-analyzer.ts <lang> [corpusDir] [--ext=.c,.h]
//                                       [--min-bytes=1024] [--limit=400]
//                                       [--max-bytes=1048576] [--quiet-load=4]
// Example: bun script/m12/measure-analyzer.ts c /home/…/zig --ext=.c,.h --min-bytes=1024 --limit=400
//
// #909 — ATTRIBUTION. Two committed facts forced this header:
//   * the c artifact recorded `corpus_subset:c` at 145.7ms/file with
//     `userCpuMs: 52,523`, from `corpusDir: "/tmp/c-corpus-copy"` — a temp path
//     that no longer exists, with no manifest, so nobody can say WHICH files were
//     measured, how big they were, or on what machine load;
//   * re-measuring the SAME analyzer on this shared box produced 25.8ms/file and
//     then 172.6ms/file for the same 400-file rule minutes apart, while three other
//     agent processes sat at 78/73/59% CPU and load1 hit 15.2 on 8 cores.
// A bare ms/file number is therefore uninterpretable: it cannot be told apart
// from a heavy file set, a loaded box, or both. So every run now records the file
// SET (digest + size distribution + extension filter) and the LOAD it ran under,
// and waits for a quiet box before timing — the #871 §1 convention ("a row without
// load context is NOT scored"), transplanted from the differential to M12.
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import os from "node:os"
import { measureOperation } from "../m11/differential-harness"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = process.cwd()
const argv = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}
const positional = argv.filter((a) => !a.startsWith("--"))
const lang = positional[0]
const corpusDir = positional[1]
if (!lang) {
  console.error("usage: bun script/m12/measure-analyzer.ts <lang> [corpusDir] [--ext=.c,.h] [--min-bytes=1024] [--limit=400]")
  process.exit(1)
}

const FIXTURE_DIR = join(ROOT, "validation/m12/fixtures", lang)
const OUT_FILE = join(ROOT, "validation/m12/results", `${lang}-complexity.json`)

// The extension filter is what keeps a "c" number from silently describing other
// languages: without it the walker measures EVERY file in the directory under the
// requested language's name.
const EXTS = (flag("ext") ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)
const MIN_BYTES = parseInt(flag("min-bytes") ?? "1")
const MAX_BYTES = parseInt(flag("max-bytes") ?? String(1 * 1024 * 1024))
const LIMIT = flag("limit") ? parseInt(flag("limit")!) : null
const QUIET_LOAD = parseFloat(flag("quiet-load") ?? "4")

function loadAvg1(): number {
  try {
    return parseFloat(readFileSync("/proc/loadavg", "utf8").split(" ")[0] ?? "0")
  } catch {
    return 0
  }
}

/**
 * `subject` walks carry the language's own extension/size rule; the FIXTURE walk
 * must not, or a `--ext=.c` run silently drops the fixture files that are headers
 * or small — measured: the c fixture row fell from 4 files to 2 when the flags
 * were applied to both walks, which would have quietly shrunk the milestone's own
 * fixture measurement while looking like a faster analyzer.
 */
function listFiles(dir: string, subject: boolean): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return []
  const out: string[] = []
  const walk = (d: string) => {
    for (const entry of readdirSync(d).sort()) {
      const full = join(d, entry)
      const st = statSync(full)
      if (st.isDirectory()) walk(full)
      else if (st.isFile() && st.size > 0 && st.size <= MAX_BYTES) {
        if (subject) {
          if (st.size < MIN_BYTES) continue
          if (EXTS.length > 0 && !EXTS.includes(full.slice(full.lastIndexOf(".")).toLowerCase())) continue
        }
        out.push(full)
      }
    }
  }
  walk(dir)
  // #909: GLOBAL path sort. A per-directory DFS order makes `--limit` depend on
  // the walker, not on the rule — measured: "first 400 .c >= 1KB" from this walker
  // drew an 18.8KB-average set while `find | sort | head -400` drew a 4.9KB-average
  // one, so two runs of "the same rule" differed by the file set while both looked
  // correct. Sorting the whole list makes the limit reproducible.
  return out.sort()
}

/** What a run measured — the thing the 09-19 artifact did not record. */
function manifestFor(dir: string, files: string[]): Record<string, unknown> {
  const sizes = files.map((f) => statSync(f).size)
  const total = sizes.reduce((a, b) => a + b, 0)
  const digest = new Bun.CryptoHasher("sha256")
    .update(files.map((f, i) => `${f}:${sizes[i]}`).join("\n"))
    .digest("hex")
    .slice(0, 16)
  return {
    corpusDir: dir,
    fileCount: files.length,
    extensions: EXTS.length ? EXTS : null,
    extensionFiltered: EXTS.length > 0,
    minBytes: MIN_BYTES,
    maxBytes: MAX_BYTES,
    limit: LIMIT,
    totalBytes: total,
    avgBytes: files.length ? Math.round(total / files.length) : 0,
    maxFileBytes: sizes.length ? Math.max(...sizes) : 0,
    setDigest: digest,
  }
}

/** Wait for a quiet box before timing (bounded, and disclosed either way). */
async function waitForQuiet(): Promise<{ loadAvg1: number; loadAvgRetried: boolean; waitedMs: number }> {
  const t0 = Date.now()
  let retried = false
  for (let i = 0; i < 12; i++) {
    const load = loadAvg1()
    if (load <= QUIET_LOAD) break
    retried = true
    await new Promise((r) => setTimeout(r, 10_000))
  }
  return { loadAvg1: loadAvg1(), loadAvgRetried: retried, waitedMs: Date.now() - t0 }
}

async function runSet(label: string, files: string[]): Promise<{ name: string; measurement: any; symbols: number; relationships: number }> {
  const started = Date.now()
  const result = await measureOperation(
    `${label}:${lang}`,
    async () => {
      let symbols = 0
      let relationships = 0
      for (const f of files) {
        try {
          const p = await parseFile(f, ROOT)
          symbols += p.symbols?.length ?? 0
          relationships += p.relationships?.length ?? 0
        } catch {}
      }
      return { symbols, relationships }
    },
    { files: files.length },
  )
  const wallMs = result.measurement.wallTimeMs || (Date.now() - started)
  const { measurement, value } = result
  const quiet = await waitForQuiet()
  measurement.loadAvg1 = quiet.loadAvg1
  measurement.loadAvgRetried = quiet.loadAvgRetried
  measurement.loadWaitedMs = quiet.waitedMs
  measurement.quietLoadTarget = QUIET_LOAD
  measurement.loadQuiet = quiet.loadAvg1 <= QUIET_LOAD
  // measureOperation only wires counts it was told about; patch throughput
  // from the actual symbol/relationship totals so the envelope is complete.
  measurement.symbols = value.symbols
  measurement.relationships = value.relationships
  measurement.symbolsPerSecond = wallMs > 0 ? (value.symbols / (wallMs / 1000)) : null
  measurement.relationshipsPerSecond = wallMs > 0 ? (value.relationships / (wallMs / 1000)) : null
  // #909: on a shared box WALL time is the unstable half of the pair (the same
  // 400-file rule measured 25.8 and 172.6 ms/file minutes apart while load1 went
  // 0.x -> 15.2). The process's own user CPU per file survives that much better,
  // so it is reported explicitly and is the number to compare across runs.
  measurement.userCpuMsPerFile = files.length > 0 ? measurement.userCpuMs / files.length : null
  return { name: label, measurement, ...value }
}

async function main() {
  const fixtureFiles = listFiles(FIXTURE_DIR, false)
  if (fixtureFiles.length === 0) {
    console.error(`no fixtures in ${FIXTURE_DIR}`)
    process.exit(1)
  }
  const runs: any[] = []

  runs.push(await runSet("fixtures", fixtureFiles))

  let corpusStats: { files: number; symbols: number; relationships: number; measurement: any } | null = null
  let corpusFiles: string[] = []
  if (corpusDir) {
    corpusFiles = listFiles(corpusDir, true)
    if (LIMIT !== null) corpusFiles = corpusFiles.slice(0, LIMIT)
    if (corpusFiles.length > 0) {
      corpusStats = await runSet("corpus_subset", corpusFiles)
      runs.push(corpusStats)
    } else {
      console.error(
        `no corpus files matched in ${corpusDir} (ext=${EXTS.join(",") || "ANY"} min-bytes=${MIN_BYTES} max-bytes=${MAX_BYTES}) — no run recorded`,
      )
    }
  }
  if (EXTS.length === 0 && corpusDir) {
    console.error(
      `WARNING: no --ext filter, so EVERY file under ${corpusDir} is measured under the "${lang}" name — the number may describe other languages.`,
    )
  }

  const document = {
    schemaVersion: 1,
    kind: `per_analyzer_complexity:${lang}`,
    fixtureDir: `validation/m12/fixtures/${lang}`,
    corpusDir: corpusDir ?? null,
    corpusManifest: corpusDir && corpusFiles.length > 0 ? manifestFor(corpusDir, corpusFiles) : null,
    nproc: os.cpus().length,
    loadRule:
      "#909: a complexity row is only scorable with its load context and its file set. Each run records loadAvg1 after a bounded wait for load <= quietLoadTarget; loadQuiet=false means the box was busy and the throughput numbers are advisory. corpusManifest records the set digest, size distribution and extension filter, so a number can be re-derived instead of trusted. A row whose manifest.extensionFiltered is false measures EVERY file in the directory under this language's name.",
    runs,
    note: "Complexity envelope per analyzer: wall time, symbols/s, relationships/s, peak RSS. Budgets are declared per analyzer in docs/analyzers/.",
  }
  writeFileSync(OUT_FILE, JSON.stringify(document, null, 2) + "\n")

  for (const run of runs) {
    const m = run.measurement
    console.log(
      `[${run.name}] files=${m.files} symbols=${run.symbols} rels=${run.relationships} wall=${m.wallTimeMs.toFixed(1)}ms ` +
        `userCpu=${(m.userCpuMs / 1000).toFixed(1)}s (${m.userCpuMsPerFile?.toFixed(1) ?? "n/a"}ms/file) ` +
        `load1=${m.loadAvg1} quiet=${m.loadQuiet} peakRSS=${(m.peakRssBytes / 1048576).toFixed(1)}MB`,
    )
  }
  const busy = runs.filter((r) => r.measurement.loadQuiet === false)
  if (busy.length) {
    console.error(
      `NOTE: ${busy.length} run(s) measured on a busy box (load1 > ${QUIET_LOAD} after waiting) — the wall/throughput numbers are advisory; compare userCpuMsPerFile instead.`,
    )
  }
  console.log(`wrote ${OUT_FILE}`)
  process.exit(0)
}

main().catch((e) => {
  console.error(`measure-analyzer ${lang} failed:`, e)
  process.exit(1)
})
