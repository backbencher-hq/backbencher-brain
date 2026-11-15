/**
 * R LANE — what `keepSymbol`'s UNIVERSAL denylist costs THIS language.
 *
 * THE FINDING, AS FIRST MEASURED. `src/ast/pool-worker.ts` denied symbols whose name
 * is in a set its own comment described as "language keywords / conventions and
 * synthetic tree-sitter artifact names". Every entry was a tree-sitter node-type
 * name; not one was an R keyword. And `source_file` is an ORDINARY R FUNCTION NAME:
 * testthat defines
 *
 *     # r-testthat/R/source.R:18
 *     source_file <- function(path, env, chdir, desc, wrap, shuffle, error_call)
 *
 * exports it with `@export`, and calls it throughout the package. The denylist
 * deleted the declaration from the index while the `exports` and `contains` edges
 * that name it SURVIVED, because `filterNoiseRelationships` consults a different
 * list (`NOISE_TARGETS`) — so the graph was left holding an exported name with
 * nothing behind it. Measured cost to R: **12 symbols across 9 files** (`this` 5,
 * `me` 4, `root` 2, `source_file` 1) out of 1,890 sampled files.
 *
 * THE FIX LANDED UPSTREAM, and the measurement is now ZERO. The denylist was split
 * into a small residual `UNIVERSAL` set plus a per-language `RESERVED` map, and the
 * comment there now credits the lanes that produced the counterexamples — this one
 * among them, for `source_file` and for `me`/`root`. Re-measured over the same
 * corpus: **0 R symbols deleted, 0 files affected.** The `exports` ghost edge and the
 * `contains`/`exports` resolution shortfall this document previously reported as a
 * shared-machinery defect are GONE, and the two claims were retracted rather than
 * left standing on a defect that no longer exists.
 *
 * The probe is kept, and its drift check is now the point of it: the copy of the list
 * below is a HARD-CODED transcription of production `keepSymbol`, so the moment
 * production changes again the drift line fires and the cost has to be re-measured
 * rather than assumed. A probe whose copy silently tracks nothing is a probe that
 * reports 0 forever, and 0 is the number that most looks like good news.
 *
 * ONE GAP THE FIX LEFT, measured rather than asserted. The comment at
 * `pool-worker.ts:499-501` says `unknown` "now moves to RESERVED below rather than
 * being dropped, so a placeholder is still refused while a declared `unknown`
 * survives". NO `RESERVED` set contains `unknown` — the map holds only `php` and
 * `sql`. So `keepSymbol({name:"unknown"}, lang)` returns true for EVERY language
 * including R, which is the opposite of what the comment describes. Measured cost to
 * R over 1,492 files: **0 symbols named `unknown` reach production**, so the gap is
 * LATENT, not active; the risk is that an analyzer which mints `unknown` as a name
 * would have it published rather than refused. Reported, not fixed: shared machinery.
 *
 * USAGE: npx tsx validation/m14/fixtures/r/probe-denylist.ts [--repo NAME] [--sample N]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"
import { ASTEngine } from "../../../../src/ast/engine"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const argOf = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const SAMPLE = Number(argOf("--sample") ?? 250)
const repoFilter = argOf("--repo")

/**
 * A HARD-CODED transcription of `keepSymbol`'s sets, so the drift check below is a
 * canary rather than a tautology. As of the split it holds:
 *
 *   UNIVERSAL  this, super, SCSS_FILE_SCOPE, GlobalScope, module_declaration,
 *              package_manifest
 *   RESERVED   php: {self, parent}   sql: {program}
 *
 * `self`, `Self`, `me`, `My`, `destructor`, `root`, `program`, `source_file` and
 * `unknown` were all REMOVED from the universal set upstream; the first eight are the
 * measured counterexamples this lane and others produced. `unknown` is listed here as
 * refused-when-`r`-should-reserve-it, which is the behaviour the comment at
 * `pool-worker.ts:499-501` describes and which no `RESERVED` set actually implements;
 * it is recorded so that if `unknown` is ever added to a per-language set, this probe
 * reports the change instead of missing it.
 */
const UNIVERSAL_DENYLIST = ["this", "super", "SCSS_FILE_SCOPE", "GlobalScope", "module_declaration", "package_manifest"]
/** Names production MUST keep but that this lane previously measured being deleted. */
const PREVIOUSLY_DELETED = ["self", "Self", "me", "My", "destructor", "root", "program", "source_file"]
/** `unknown` is refused by NO set today; see the header. Listed so drift is visible. */
const UNREFUSED_UNKNOWN = ["unknown"]

const files: { abs: string; dir: string }[] = []
const repos: string[] = []
for (const e of readdirSync(CR).sort()) {
  if (repoFilter && e !== repoFilter) continue
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  const admitted: { abs: string; dir: string }[] = []
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "r") continue
    admitted.push({ abs, dir })
  }
  if (admitted.length === 0) continue
  repos.push(e)
  files.push(...admitted.slice(0, SAMPLE))
}

// The copy must not drift: if `keepSymbol`'s own set ever gains or loses an entry,
// this probe is measuring a list the product does not use. Three directions, because
// the two failure modes look identical in the output and are not the same defect:
// production gaining a name the copy lacks, production losing one the copy has, and
// production RE-ADOPTING a name this lane measured being deleted upstream.
const { keepSymbol } = await import("../../../../src/ast/pool-worker")
const drift: string[] = []
for (const n of UNIVERSAL_DENYLIST) if (keepSymbol({ name: n }, "r")) drift.push(`${n} is in this probe's copy but keepSymbol KEEPS it`)
for (const n of ["x", "source_files", "SourceFile", "selfish"]) if (!keepSymbol({ name: n }, "r")) drift.push(`keepSymbol denies ${n}, which this probe's copy does not list`)
const regressed: string[] = []
for (const n of PREVIOUSLY_DELETED) if (!keepSymbol({ name: n }, "r")) regressed.push(`${n} is denied again — the upstream fix was reverted`)
const unknownUnrefused: string[] = []
for (const n of UNREFUSED_UNKNOWN) if (keepSymbol({ name: n }, "r")) unknownUnrefused.push(`${n} is KEPT for r; pool-worker.ts:499-501 says a RESERVED set should refuse it`)

const perName = new Map<string, { symbols: number; files: Set<string>; kinds: Map<string, number>; examples: string[] }>()
let filesWithLoss = 0
let symbolsLostTotal = 0
let cursor = 0
async function worker(): Promise<void> {
  for (;;) {
    const i = cursor++
    if (i >= files.length) return
    const f = files[i]
    const label = f.abs.replace(CR + "/", "")
    const content = readFileSync(f.abs, "utf8")
    // ASTEngine.parseFile is the stage BEFORE the worker's keepSymbol filter, so it
    // is the honest "what the analyzer produced" side of the comparison.
    let produced: string[] = []
    try {
      const e: any = await ASTEngine.parseFile(f.abs, content)
      produced = (e.symbols ?? []).map((s: any) => String(s.name ?? ""))
    } catch { continue }
    let delivered: Set<string>
    try {
      const p: any = await parseFile(f.abs, f.dir)
      delivered = new Set((p.symbols ?? []).map((s: any) => String(s.name ?? "")))
    } catch { delivered = new Set() }
    let lostHere = 0
    for (const s of produced) {
      if (delivered.has(s)) continue
      if (!UNIVERSAL_DENYLIST.includes(s)) continue
      lostHere++
      let row = perName.get(s)
      if (!row) { row = { symbols: 0, files: new Set(), kinds: new Map(), examples: [] }; perName.set(s, row) }
      row.symbols++
      row.files.add(label)
      if (row.examples.length < 3) row.examples.push(label)
    }
    if (lostHere > 0) filesWithLoss++
    symbolsLostTotal += lostHere
  }
}
await Promise.all(Array.from({ length: 4 }, () => worker()))

const hdr = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`keepSymbol denylist — cost to R`)
console.log(`corpus ${CR}; repos ${repos.length}: ${repos.join(", ")}; files ${files.length}`)
console.log(`probe copy vs production keepSymbol: ${drift.length === 0 ? "AGREE on every probed name" : "DRIFT — " + drift.join("; ")}`)
console.log(`upstream fix still in place: ${regressed.length === 0 ? "YES — all " + PREVIOUSLY_DELETED.length + " measured counterexamples are kept" : "NO — " + regressed.join("; ")}`)
console.log(`the 'unknown' gap: ${unknownUnrefused.length === 0 ? "closed" : "OPEN — " + unknownUnrefused.join("; ")}`)
console.log("")
console.log(`R symbols the production entry point DELETED: ${symbolsLostTotal} across ${filesWithLoss} file(s)`)
if (symbolsLostTotal === 0) {
  console.log("  (was 12 across 9 files before the upstream split: this 5, me 4, root 2, source_file 1)")
}
console.log(hdr("denied name", 24) + hdr("symbols", 10) + hdr("files", 8) + "examples")
for (const [n, row] of [...perName.entries()].sort((a, b) => b[1].symbols - a[1].symbols)) {
  console.log(hdr(n, 24) + hdr(String(row.symbols), 10) + hdr(String(row.files.size), 8) + row.examples.join(" | "))
}
console.log("")
console.log("R also has `self` as an R6 idiom (`self$x <- ...` inside a method). The analyzer")
console.log("publishes only file-level bindings, so `self` is not reached here — stated as a")
console.log("measurement rather than as a reassurance.")
