/**
 * FSHARP LANE — how many corpus files the tree-sitter-fsharp parser cannot survive.
 *
 * ## Why this file exists
 *
 * `ontology-coverage-gate.ts fsharp` does not finish. It walks the whole admitted
 * fsharp population (11,799 files) and dies at file N of 11,799 with:
 *
 *     [BB-PARSE-ERR] fsharp | .../Fabulous/src/avalonia/Fabulous.Avalonia/Views/_DragDrop.Mvu.fs | memory access out of bounds
 *     [BB-HANG] parser stuck 120s on .../Views/_DragDrop.Mvu.fs — exiting
 *
 * exit 1, no verdict printed. Two things about that are findings, not noise:
 *
 *   1. The gate therefore prints NO adjudication for this lane right now, so any claim
 *      that fsharp is 10/10 APPLICABLE is currently resting on a committed baseline, not
 *      on a gate that runs. This file finds out whether ONE file is responsible or
 *      whether the gate would die again a dozen files later — which is the difference
 *      between "exclude one path" and "this population has N poison files".
 *   2. The defect is NOT in this lane's analyzer. `git diff 80836570d8..HEAD --
 *      src/ast/real-fsharp-analyzer.ts` is empty: this branch's analyzer is
 *      byte-identical to the published aggregate. The failure is in the grammar or the
 *      parse layer, which is shared machinery.
 *
 * So this is a measurement of the population, not of the analyzer, and it is reported
 * as such. It parses with `ASTEngine.getParser("fsharp")` and calls `parser.parse()`
 * DIRECTLY — no analyzer, no pool, no enhancements. That is deliberate: it is the
 * narrowest instrument that can answer the question, so a file that dies here died
 * before any fsharp code of this lane ran.
 *
 * ## How a hang is survived
 *
 * `parser.parse()` is synchronous WASM. A `setTimeout` cannot interrupt it — the event
 * loop is blocked — so the engine's own answer is `process.exit()`, which is exactly
 * what kills a corpus walk. (The engine's comment says "the indexer is incremental —
 * re-running resumes"; that is true of the indexer and false of a tool that walks a
 * corpus in ONE process, which is why the gate itself is resumable and this is too.)
 *
 * So: the file about to be parsed is written to a checkpoint BEFORE the call. If the
 * process dies, the next invocation reads the checkpoint, records that file as a HANG,
 * and resumes at the one after it. Convergence is the proof that the set is complete —
 * the walk only ends when a full pass completes with no death, and every file is then
 * accounted for exactly once.
 *
 * A hang is therefore attributed to the file the checkpoint names. That attribution is
 * sound because the checkpoint is written before the call and nothing else runs between
 * the write and the parse; but it is still an attribution by position, so the count is
 * printed with the number of process deaths that produced it, and a reader can see how
 * many inferences it rests on.
 *
 * ## What a THROW means here, precisely
 *
 * A file counted `threw` produced an exception from `parser.parse()` that was caught.
 * `memory access out of bounds` from a WASM module is that shape. This file does NOT
 * claim the tree is wrong — only that the parse did not return normally, which is the
 * same condition the gate records as `[BB-PARSE-ERR]`.
 *
 * ## No regex
 *
 * Admission is the gate's own: `git ls-files`, size <= 512 KiB, and
 * `detectLanguageFromPath(abs, text) === "fsharp"`. No pattern literal appears here.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/fsharp/parser-crash-census.mts            # full walk
 *   npx tsx validation/m14/fixtures/fsharp/parser-crash-census.mts --resume   # after a death
 *   npx tsx validation/m14/fixtures/fsharp/parser-crash-census.mts --out f.json
 *
 * State lives beside the artifacts: `.parser-crash-census/` (checkpoint + bad list).
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from "node:fs"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { ASTEngine } from "../../../../src/ast/engine"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const STATE = path.resolve(HERE, "../../measurements/fsharp/.parser-crash-census")
const LANG = "fsharp"
const MAX_BYTES = 512 * 1024

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const OUT = argValue("--out") ?? path.join(STATE, "census.json")
const RESUME = process.argv.includes("--resume")

mkdirSync(STATE, { recursive: true })
const CKPT = path.join(STATE, "checkpoint.txt")
const BAD = path.join(STATE, "bad.ndjson")

/** Admission, copied from the gate so the population is the gate's population. */
function admitted(): { repo: string; dir: string; rel: string; abs: string; text: string }[] {
  const files: { repo: string; dir: string; rel: string; abs: string; text: string }[] = []
  for (const e of readdirSync(CR)) {
    const dir = path.join(CR, e)
    try {
      if (!statSync(dir).isDirectory()) continue
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
        encoding: "utf8",
        maxBuffer: 512 * 1024 * 1024,
      })
        .split("\0")
        .filter(Boolean)
    } catch {
      continue
    }
    for (const rel of tracked) {
      const abs = path.join(dir, rel)
      let text: string
      try {
        if (statSync(abs).size > MAX_BYTES) continue
        text = readFileSync(abs, "utf8")
      } catch {
        continue
      }
      if (detectLanguageFromPath(abs, text) !== LANG) continue
      files.push({ repo: e, dir, rel, abs, text })
    }
  }
  return files
}

const files = admitted()
/** Fingerprint, so "a count moved" is separable from "the population moved". */
const popFp = (() => {
  const h = createHash("sha256")
  for (const f of files) h.update(`${f.repo}/${f.rel}:${statSync(f.abs).size}\n`)
  return h.digest("hex").slice(0, 16)
})()

let start = 0
let deaths = 0
if (RESUME && existsSync(CKPT)) {
  const at = Number(readFileSync(CKPT, "utf8").trim())
  const victim = files[at]
  if (Number.isFinite(at) && victim) {
    // The checkpoint names the file that was in flight when the process died. Nothing
    // runs between writing it and the parse, so this is the file that hung.
    writeFileSync(
      BAD,
      (existsSync(BAD) ? readFileSync(BAD, "utf8") : "") +
        JSON.stringify({ file: victim.abs, repo: victim.repo, rel: victim.rel, kind: "hang", ms: null }) +
        "\n",
    )
    start = at + 1
    deaths = 1
    console.error(`resume: attributed a hang to ${victim.rel} (index ${at}); resuming at ${start}`)
  }
}

const parser = await ASTEngine.getParser(LANG as never)

const ok: number[] = []
const threw: { abs: string; repo: string; rel: string; error: string }[] = []
for (let i = start; i < files.length; i++) {
  const f = files[i]
  // Written BEFORE the call. If this process dies mid-parse, the next --resume reads it.
  writeFileSync(CKPT, String(i))
  const t0 = Date.now()
  try {
    const tree = parser.parse(f.text)
    if (!tree) throw new Error("parse() returned null")
    tree.delete()
    ok.push(i)
  } catch (e: any) {
    threw.push({ abs: f.abs, repo: f.repo, rel: f.rel, error: String(e?.message ?? e).slice(0, 200) })
    writeFileSync(
      BAD,
      (existsSync(BAD) ? readFileSync(BAD, "utf8") : "") +
        JSON.stringify({ file: f.abs, repo: f.repo, rel: f.rel, kind: "threw", error: String(e?.message ?? e).slice(0, 200) }) +
        "\n",
    )
    process.stderr.write(`[BB-PARSE-ERR] ${LANG} | ${f.abs} | ${String(e?.message ?? e).slice(0, 120)}\n`)
  }
  if (i % 500 === 0) process.stderr.write(`  ${i}/${files.length}\n`)
}
writeFileSync(CKPT, "")

const hangs = existsSync(BAD)
  ? readFileSync(BAD, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((r) => r.kind === "hang")
  : []

/** Every admitted file is accounted for exactly once, or this run is not a census. */
const accounted = ok.length + threw.length + hangs.length
const summary = {
  lane: LANG,
  population: files.length,
  populationFingerprint: popFp,
  parseReturned: ok.length,
  threwCount: threw.length,
  hangCount: hangs.length,
  deathsThisRun: deaths,
  accounted,
  reconciles: accounted === files.length,
  parseReturnRate: files.length ? ok.length / files.length : 0,
  throws: threw,
  hangs,
  corpusRoot: CR,
  instrument: "ASTEngine.getParser('fsharp').parse() direct — no analyzer, no pool",
  reproduce:
    "npx tsx validation/m14/fixtures/fsharp/parser-crash-census.mts --resume   # repeat until it prints a full pass",
}

writeFileSync(OUT, JSON.stringify(summary, null, 2) + "\n")
console.log(`fsharp parser census — population ${files.length} files (fingerprint ${popFp})`)
console.log(`  parse returned   ${ok.length}  ${(summary.parseReturnRate * 100).toFixed(2)}%`)
console.log(`  threw            ${threw.length}`)
console.log(`  hung             ${hangs.length}   (each cost one process death)`)
console.log(`  accounted        ${accounted} / ${files.length}  ${summary.reconciles ? "RECONCILES" : "DOES NOT RECONCILE"}`)
if (threw.length) {
  console.log(`\nTHREW:`)
  for (const t of threw) console.log(`  ${t.error}\n    ${t.abs}`)
}
if (hangs.length) {
  console.log(`\nHUNG:`)
  for (const h of hangs) console.log(`  ${h.file}`)
}
console.log(`\nout ${OUT}`)
if (!summary.reconciles) process.exit(5)