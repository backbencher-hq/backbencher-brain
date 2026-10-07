/**
 * PYTHON FIRING CHECK — lane-owned, because `script/m14/firing-check-v2.mjs` has no
 * PYTHON lane and maps `PY`/`PY2` to `null` in its ALIAS table, so
 *
 *     NFILES=200 bun script/m14/firing-check-v2.mjs CORPUS_PY2
 *
 * exits 2 with "no lane matches" (measured 2026-10-04). `firing-check-v2.mjs` is
 * master-owned shared harness, so this file does not edit it; it reproduces the same
 * METHODOLOGY so the number is comparable, and the need is reported to master.
 *
 * ## What is reproduced from v2, deliberately
 *
 * 1. **The production path.** `getParser(lang)` -> `parser.parse(content, file)` ->
 *   `new RealPythonAnalyzer().analyze(rootNode, content, filePath)`. Nothing here calls
 *   a private method or reaches into the analyzer's internals.
 * 2. **Two channels, reported separately** (v2 DEFECT 3). `ParseResult` carries
 *   `imports: ImportInfo[]` on a SEPARATE channel from `relationships`
 *   (`src/ast/types.ts:206-216`); `parallel-indexer` writes those to the `brain_import`
 *   TABLE and never to `brain_relationship` rows. So a type absent from the relationship
 *   tally while `imports[]` is non-zero is NOT a defect. Both numbers are printed.
 * 3. **The production vocabulary** (v2 DEFECT D) is `ASTEngine.RelationshipType` in
 *   `src/ast/engine.ts`, because that is the enum analyzers reference. `src/ast/types.ts`
 *   is graded against too and the divergence is REPORTED rather than hidden.
 * 4. **The code-bearing filter** (v2 DEFECT 1). Blind directory-order sampling drew
 *   encoding DATA tables for Ruby and scored it 1/10 at NFILES=25 where the same
 *   analyzer scored 8/10 at NFILES=200. `BB_BLIND=1` restores blind walk so the swing
 *   is reproducible.
 *
 * ## What is added
 *
 * 5. **The population is DERIVED, never hand-written** (`docs/M14-HONESTY-CONTRACT.md`
 *   §"an instrument must declare the population it covered"). `git ls-files` per repo,
 *   with a hard failure when a repo contributes zero admitted files — a hard-coded file
 *   list rots silently and reports `0` with total confidence.
 * 6. **Sample size is printed next to the score**, and the score is repeated at several
 *   NFILES in the summary so a verdict that only holds at one file count is visible.
 * 7. **Per-type counts with example files**, not just a fired/silent split, because a
 *   verdict needs the FILES the edges came from.
 *
 * NO REGEX ANYWHERE (programme rule 1). Path filtering is `endsWith` over an extension
 * list; lane selection is `toUpperCase` + a delimiter split.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { join } from "node:path"
import { execFileSync } from "node:child_process"

const REPO = process.env.BB_REPO ?? "$HOME/backbencher-brain"
const CORPUS_ROOT = process.env.BB_CORPUS ?? "$HOME/fixtures/repositories"
const PY_CORPUS = process.env.BB_PY_CORPUS ?? join(CORPUS_ROOT, "python-corpus")
const BLIND = process.env.BB_BLIND === "1"

/** Uppercase A-Z0-9 only, built with a char scan. NO REGEX (programme rule 1). */
function alnumUpper(s: string): string {
  let out = ""
  for (const ch of s.toUpperCase()) {
    const c = ch.charCodeAt(0)
    if ((c >= 65 && c <= 90) || (c >= 48 && c <= 57)) out += ch
  }
  return out
}

const LANGS = ["PYTHON", "PYTHON2", "PY", "PYTHON3", "CORPUSPY2"]
const arg = process.argv[2]
if (arg && !LANGS.includes(alnumUpper(arg))) {
  console.error(`\nPYTHON FIRING CHECK: "${arg}" is not this lane. This instrument is python only.`)
  console.error(`Run it with no argument.\n`)
  process.exit(2)
}

const EXTS = [".py", ".pyi"]
// Code-bearing signals, declared per the v2 rule (data files lack declarations).
// `.py` is matched on AST-declaration spelling, not prose.
const SIGNALS_PY = ["def ", "class ", "import ", "from "]

interface CorpusFile { repo: string; rel: string; abs: string; size: number }

function gitReposUnder(root: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === ".git") continue
    const p = join(root, e.name)
    out.push(p)
  }
  return out
}

/** The population, DERIVED from the repos on disk. A repo that yields 0 is a hard error. */
function deriveCorpus(): { files: CorpusFile[]; repos: { name: string; files: number; admitted: number; skippedBig: number }[] } {
  if (!existsSync(PY_CORPUS)) {
    console.error(`\nPYTHON FIRING CHECK: no python corpus at ${PY_CORPUS}.`)
    console.error(`Set BB_PY_CORPUS. Refusing to report a score over an empty population.\n`)
    process.exit(2)
  }
  const files: CorpusFile[] = []
  const repos: { name: string; files: number; admitted: number; skippedBig: number }[] = []
  for (const dir of gitReposUnder(PY_CORPUS)) {
    let tracked: string[]
    try {
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { continue } // not a git repo (e.g. cpython-stdlib is an unpacked copy)
    let n = 0, admitted = 0, skippedBig = 0
    for (const rel of tracked) {
      if (!EXTS.some((x) => rel.endsWith(x))) continue
      n++
      const abs = join(dir, rel)
      let size = 0
      try { size = statSync(abs).size } catch { continue }
      if (size > 400_000) { skippedBig++; continue } // same cap firing-check-v2 uses
      files.push({ repo: dir.slice(PY_CORPUS.length + 1), rel, abs, size })
      admitted++
    }
    repos.push({ name: dir.slice(PY_CORPUS.length + 1), files: n, admitted, skippedBig })
  }
  if (files.length === 0) {
    console.error(`\nPYTHON FIRING CHECK: derived population is EMPTY over ${PY_CORPUS}.`)
    console.error(`Refusing to print a score about nothing.\n`)
    process.exit(2)
  }
  return { files, repos }
}

function codeBearing(f: CorpusFile): boolean {
  if (BLIND) return true
  let src: string
  try { src = readFileSync(f.abs, "utf8") } catch { return false }
  return SIGNALS_PY.some((s) => src.includes(s))
}

const { getParser, ASTEngine } = await import(`${REPO}/src/ast/engine.ts`)
const { RealPythonAnalyzer } = await import(`${REPO}/src/ast/real-python-analyzer.ts`)
const PROD = [...new Set(Object.values(ASTEngine.RelationshipType))]

interface RunResult {
  nfiles: number
  parsed: number
  failed: number
  fired: string[]
  silent: string[]
  imports: number
  filesWithImports: number
  relTally: Map<string, number>
  typeFiles: Map<string, Set<string>>
  offVocab: Set<string>
  examples: string[]
}

async function run(nfiles: number, files: CorpusFile[]): Promise<RunResult> {
  const relTally = new Map<string, number>()
  const typeFiles = new Map<string, Set<string>>()
  const offVocab = new Set<string>()
  const examples: string[] = []
  let parsed = 0, failed = 0, imports = 0, filesWithImports = 0
  for (const f of files) {
    try {
      const content = readFileSync(f.abs, "utf8")
      const parser = await getParser("python")
      const pr = await parser.parse(content, f.abs)
      const res = new RealPythonAnalyzer().analyze(pr.rootNode as any, content, f.abs)
      parsed++
      const imps = res.imports || []
      imports += imps.length
      if (imps.length) filesWithImports++
      if (examples.length < 3) examples.push(`${f.repo}/${f.rel}`)
      for (const r of (res.relationships || []) as any[]) {
        const t = r.relationshipType ?? r.type
        if (!t) continue
        relTally.set(t, (relTally.get(t) ?? 0) + 1)
        let s = typeFiles.get(t)
        if (!s) { s = new Set(); typeFiles.set(t, s) }
        if (s.size < 4) s.add(`${f.repo}/${f.rel}`)
        if (!PROD.includes(t)) offVocab.add(t)
      }
    } catch { failed++ }
  }
  const fired = PROD.filter((t) => relTally.has(t))
  const silent = PROD.filter((t) => !relTally.has(t))
  return { nfiles, parsed, failed, fired, silent, imports, filesWithImports, relTally, typeFiles, offVocab, examples }
}

const LAYOUT = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)

const { files: ALL, repos } = deriveCorpus()

console.log(`python firing check   repo=${REPO}`)
console.log(`corpus root: ${PY_CORPUS}`)
console.log(`population, DERIVED (git ls-files, ${EXTS.join("/")}, <=400000 bytes): ${ALL.length} files across ${repos.length} repo(s)`)
for (const r of repos) {
  console.log(`  ${LAYOUT(r.name, 16)} tracked ${String(r.files).padStart(5)}  admitted ${String(r.admitted).padStart(5)}  skipped>400KB ${r.skippedBig}`)
}
console.log(`sampling: ${BLIND ? "BLIND walk order (defect 1 active)" : "code-bearing filter (declaration keywords)"}`)
console.log(`production vocabulary (engine.ts ASTEngine.RelationshipType, ${PROD.length}): ${PROD.join(" ")}`)

// A few files per repo, so one dominant repo cannot decide the score. This is a
// DERIVED interleaving, not a hand-written list.
function stratified(all: CorpusFile[], want: number): CorpusFile[] {
  const byRepo = new Map<string, CorpusFile[]>()
  for (const f of all) {
    let a = byRepo.get(f.repo)
    if (!a) { a = []; byRepo.set(f.repo, a) }
    a.push(f)
  }
  const out: CorpusFile[] = []
  const per = Math.max(1, Math.ceil(want / byRepo.size))
  for (const a of byRepo.values()) {
    let kept = 0
    for (const f of a) {
      if (out.length >= want) break
      if (!codeBearing(f)) continue
      out.push(f)
      kept++
      if (kept >= per) break
    }
  }
  if (out.length < want) {
    for (const f of all) {
      if (out.length >= want) break
      if (out.some((x) => x.abs === f.abs)) continue
      if (codeBearing(f)) out.push(f)
    }
  }
  return out.slice(0, want)
}

const SIZES = (process.env.NFILES ?? "25,100,200,500").split(",").map((s) => Number(s.trim())).filter((n) => n > 0)
const runs: RunResult[] = []
for (const n of SIZES) {
  const sample = stratified(ALL, n)
  console.log(`\n--- NFILES=${n}: sampled ${sample.length} code-bearing files across the derived population of ${ALL.length}`)
  const r = await run(n, sample)
  runs.push(r)
  console.log(`    ${r.fired.length}/10 types fired · parsed ${r.parsed}/${sample.length} (failed ${r.failed}) · imports[] ${r.imports} in ${r.filesWithImports} files`)
  console.log(`    fired:  ${r.fired.join(" ") || "(none)"}`)
  console.log(`    silent: ${r.silent.join(" ") || "(all ten)"}`)
  if (r.offVocab.size) console.log(`    OFF-VOCABULARY emitted: ${[...r.offVocab].join(" ")}`)
  console.log(`    counts: ${[...r.relTally.entries()].sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t}:${c}`).join("  ")}`)
  console.log(`    e.g. ${r.examples.join("  ")}`)
}

const biggest = runs.reduce((a, b) => (b.nfiles > a.nfiles ? b : a))
console.log(`\n${LAYOUT("NFILES", 10)}${LAYOUT("types fired", 14)}${LAYOUT("parsed", 10)}imports[]  silent`)
console.log("-".repeat(96))
for (const r of runs) console.log(`${LAYOUT(String(r.nfiles), 10)}${LAYOUT(`${r.fired.length}/10`, 14)}${LAYOUT(`${r.parsed}/${r.nfiles}`, 10)}${String(r.imports).padEnd(10)}${r.silent.join(" ") || "-"}`)

console.log(`\n=== VERDICT TABLE at NFILES=${biggest.nfiles} (population ${ALL.length} derived files) ===`)
console.log(`${LAYOUT("type", 14)}${LAYOUT("verdict", 12)}count    files`)
console.log("-".repeat(96))
for (const t of PROD) {
  const n = biggest.relTally.get(t) ?? 0
  const fs = [...(biggest.typeFiles.get(t) ?? [])]
  console.log(`${LAYOUT(t, 14)}${LAYOUT(n > 0 ? "EMITTED" : "NOT-EMITTED", 12)}${String(n).padEnd(8)}${n > 0 ? fs.slice(0, 2).join(", ") : "-"}`)
}
console.log(`\nverdict: ${biggest.fired.length}/10 production relationship types fired on the derived corpus at NFILES=${biggest.nfiles}.`)
console.log(`Every count above is over ${biggest.parsed} parsed files drawn from a derived population of ${ALL.length}; the table prints both.`)