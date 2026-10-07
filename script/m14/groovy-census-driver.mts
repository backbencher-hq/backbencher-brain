/**
 * GROOVY CENSUS DRIVER — drives `groovy-ontology-census.mts` in chunks, and
 * BISECTS a chunk that dies.
 *
 * ## Why this exists
 *
 * `parser.parse()` is synchronous WASM. On a pathological input the grammar
 * loops, the event loop is blocked, a timer cannot fire, and
 * `ASTEngine.parseWithTimeout` answers with `process.exit()`:
 *
 *     [BB-HANG] parser stuck 120s on <file> — exiting
 *
 * One such file destroys every remaining file in the process, and the file is
 * always in the corpus, so every re-run loses the same tail. Measured on
 * `$HOME/fixtures/repositories/groovy` (Apache Groovy itself):
 *
 *   src/test/groovy/bugs/Groovy3519.groovy      wasm memory access out of bounds
 *   src/test/groovy/bugs/Groovy3560.groovy      wasm memory access out of bounds
 *   src/test/groovy/groovy/ArrayAutoboxingTest.groovy   wasm memory access out of bounds
 *   src/test/groovy/groovy/ActorTest.groovy     wasm memory access out of bounds
 *   config/codenarc/codenarc.groovy              120 s analyzer guard
 *   config/codenarc/gate.groovy                 120 s analyzer guard
 *   gradle/build-scans.gradle                    120 s parser guard
 *   gradle/eclipse.gradle                        120 s parser guard
 *
 * Six of these are REAL DEFECTS in the pinned grammar, not corpus noise: a wasm
 * trap on ordinary Apache Groovy test sources is a grammar bug that costs a
 * consumer the whole file. They are reported to the master, not worked around
 * silently. What this driver does is make them cost ONE file each instead of the
 * measurement.
 *
 * ## The design
 *
 * Chunk the derived population (git ls-files -> detectLanguageFromPath === "groovy"),
 * run one census process per chunk, and on a non-zero exit BISECT the chunk:
 * the first half is retried, then the second, recursing until a single file is
 * isolated. That file is written to `quarantine.txt` and the rest is measured.
 * A finished chunk's JSON is on disk and is never recomputed, so a driver kill
 * costs at most one chunk.
 *
 * NO REGEXP anywhere in this file, per the workstream rule; the path split is
 * `split("\n")` and string comparison.
 *
 * USAGE
 *   npx tsx script/m14/groovy-census-driver.mts --chunk=40 --outdir=validation/m14/measurements/groovy-census
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"

const ROOT = path.resolve(new URL("../..", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPOS = (argOf("--repo", "groovy") ?? "groovy").split(",").map((s) => s.trim()).filter(Boolean)
const CHUNK = Number(argOf("--chunk", "40") ?? "40")
const OUTDIR = argOf("--outdir", "validation/m14/measurements/groovy-census")!
const CENSUS = path.join(ROOT, "script", "m14", "groovy-ontology-census.mts")
const TMP = path.join(OUTDIR, "tmp")
const QUARANTINE = path.join(OUTDIR, "quarantine.txt")

function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  if (i !== -1 && i + 1 < process.argv.length) return process.argv[i + 1]
  const j = process.argv.find((a) => a.startsWith(`${flag}=`))
  return j ? j.slice(flag.length + 1) : dflt
}

// ── population, derived ───────────────────────────────────────────────────────
const all: string[] = []
for (const e of REPOS) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    if (!abs.endsWith(".groovy") && !abs.endsWith(".gradle")) continue
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "groovy") continue
    all.push(abs)
  }
}
all.sort()
// Each quarantine line is `abs-path<TAB>reason`, and the reason is kept so the
// report can name WHY a file is out of the measurement. Reading the whole line
// into the set (the previous code) made every lookup miss, so the driver
// re-offered quarantined files to the census on every run while reporting a
// population that included them. The census's own BB_GROOVY_SKIP split on the
// tab and did skip them, which is why the counts still reconciled — but the
// driver's own two numbers disagreed, and a number that disagrees with its
// population is exactly what this lane is not allowed to publish.
const already = new Set(
  existsSync(QUARANTINE)
    ? readFileSync(QUARANTINE, "utf8").split("\n").map((s) => s.split("\t")[0].trim()).filter(Boolean)
    : [],
)
const population = all.filter((p) => !already.has(p))
mkdirSync(TMP, { recursive: true })
console.log(`groovy census driver — derived population ${all.length} tracked .groovy/.gradle files`)
console.log(`  quarantined by earlier runs: ${already.size}`)
console.log(`  to measure this run: ${population.length}  chunk=${CHUNK}`)

let chunks = 0
for (let start = 0; start < population.length; start += CHUNK) {
  chunks++
}
let chunk = 0
for (let start = 0; start < population.length; start += CHUNK) {
  chunk++
  const slice = population.slice(start, start + CHUNK)
  const out = path.join(OUTDIR, `chunk-${String(chunk).padStart(4, "0")}.json`)
  if (existsSync(out)) { console.log(`  [${chunk}/${chunks}] cached`); continue }
  run(slice, out, `${chunk}/${chunks}`)
}

function quarantine(abs: string, why: string): void {
  const line = `${abs}\t${why}`
  const cur = existsSync(QUARANTINE) ? readFileSync(QUARANTINE, "utf8") : ""
  writeFileSync(QUARANTINE, cur + line + "\n")
  console.log(`  QUARANTINED ${abs} (${why})`)
}

/** Run one chunk; on a non-zero exit, bisect until a single file is isolated. */
function run(paths: string[], out: string, label: string): void {
  if (paths.length === 0) return
  if (paths.length === 1) {
    quarantine(paths[0], "single file; engine guard killed the process")
    return
  }
  // NO REGEXP (hard rule 1): the shard name is flattened with a char-code
  // scan, not `/[^\w]/g`. A path separator and a dot both have to go or the
  // file name stops being writable.
  const flat: string[] = []
  for (let i = 0; i < out.length; i++) {
    const c = out.charCodeAt(i)
    const wordy =
      (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95
    flat.push(wordy ? out[i] : "_")
  }
  const listPath = path.join(TMP, `list-${flat.join("")}.txt`)
  writeFileSync(listPath, paths.join("\n") + "\n")
  // NO REGEXP (hard rule 1). This file had two — `out.replace(/\.json$/, ...)`
  // on the bisect line below — which is the rule the whole instrument exists to
  // honour. Replaced with a suffix test on the last five characters.
  const shardSuffix = (suffix: string): string => (out.endsWith(".json") ? out.slice(0, out.length - 5) + suffix : out + suffix)
  const skip = (() => {
    try { return readFileSync(QUARANTINE, "utf8").split("\n").map((s) => s.split("\t")[0].trim()).filter(Boolean).join(",") } catch { return "" }
  })()
  try {
    execFileSync("npx", ["tsx", CENSUS, `--list=${listPath}`, `--out=${out}`, `--repo=${REPOS.join(",")}`], {
      cwd: ROOT,
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, BB_GROOVY_SKIP: skip },
      maxBuffer: 64 * 1024 * 1024,
    })
    console.log(`  [${label}] ok ${paths.length} files -> ${path.basename(out)}`)
  } catch (e: any) {
    const stderr = String(e?.stderr ?? "")
    const why = stderr.includes("memory access out of bounds")
      ? "wasm memory access out of bounds"
      : stderr.includes("BB-HANG") || stderr.includes("stuck")
        ? "120s engine guard"
        : stderr.includes("Parser timeout") || stderr.includes("parser timeout")
          ? "parser timeout"
          : "process exited non-zero"
    const mid = Math.ceil(paths.length / 2)
    console.log(`  [${label}] died (${why}); bisecting ${paths.length} files`)
    run(paths.slice(0, mid), shardSuffix(".a.json"), `${label}a`)
    run(paths.slice(mid), shardSuffix(".b.json"), `${label}b`)
  }
}

const parts: string[] = []
for (const e of readdirSafe(OUTDIR)) if (e.endsWith(".json") && e !== "census.json") parts.push(path.join(OUTDIR, e))
console.log(`\nmerging ${parts.length} chunk artifacts`)
const skipEnv = existsSync(QUARANTINE)
  ? readFileSync(QUARANTINE, "utf8").split("\n").map((s) => s.split("\t")[0].trim()).filter(Boolean).join(",")
  : ""
execFileSync("npx", ["tsx", CENSUS, "--merge", ...parts, `--out=${OUTDIR}/census.json`, `--repo=${REPOS.join(",")}`], {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, BB_GROOVY_SKIP: skipEnv },
  maxBuffer: 64 * 1024 * 1024,
})

function readdirSafe(d: string): string[] {
  try { return readdirSync(d) } catch { return [] }
}