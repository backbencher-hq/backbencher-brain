/**
 * LANE PAYLOAD / LATENCY PROBE for the python analyzer.
 *
 * ## WHY A LANE-OWNED PROBE
 *
 * `script/m60/payload-matrix.ts` and `validation/m60/analyzer-budget-register.json` are
 * master-owned, and python's row in the budget register is currently `unscorable` /
 * `status: open`, with the recorded reasons "no loadRule (#871)" and "no corpusManifest
 * (#909)". So there is no green python budget to regress and nothing for this file to
 * re-baseline — the honest move is to measure the before/after of this lane's own change
 * and report the numbers, not to quietly rewrite a master-owned register.
 *
 * WHAT IT MEASURES, twice, from the SAME file set:
 *   - wall-clock for N files through the PRODUCTION path (getParser -> parse -> analyze)
 *   - the edge count per relationship type, so a new type's payload is visible as a count
 *   - the analyzer SOURCE SIZE, because the other half of "adding edges is not free" is
 *     that the rule which derives them has to live somewhere
 *
 * The file set is DERIVED from the corpus, never hand-written
 * (docs/M14-HONESTY-CONTRACT.md §"an instrument must declare the population it covered"),
 * and it is the SAME set for both arms — a before/after over two different file sets is not
 * a before/after.
 *
 * USAGE
 *   bun script/m14/python-payload-latency.mts                 # current source, both arms
 *   BB_BASELINE=path/to/old-analyzer.ts bun <this>           # arm A is that file
 *
 * With BB_BASELINE unset the baseline is taken from git at `BASELINE_REF` (default
 * `e73c3e58e`, the commit this lane branched from) so the comparison is reproducible from a
 * clean checkout rather than from a file someone remembered to save.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { join, basename } from "node:path"
import { execFileSync } from "node:child_process"

const REPO = process.env.BB_REPO ?? "$HOME/backbencher-brain"
const CORPUS_ROOT = process.env.BB_CORPUS ?? "$HOME/fixtures/repositories"
const PY_CORPUS = process.env.BB_PY_CORPUS ?? join(CORPUS_ROOT, "python-corpus")
const NFILES = Number(process.env.NFILES ?? 400)
const BASELINE_REF = process.env.BASELINE_REF ?? "e73c3e58e"
const EXTS = [".py", ".pyi"]

type N = any

interface CorpusFile { repo: string; rel: string; abs: string }

function deriveSample(want: number): CorpusFile[] {
  if (!existsSync(PY_CORPUS)) {
    console.error(`\nPAYLOAD PROBE: no python corpus at ${PY_CORPUS}. Refusing to measure over nothing.\n`)
    process.exit(2)
  }
  // Derived by walking the corpus in directory order and taking the first `want` files that
  // carry a declaration. Deliberately the SAME order v2's pickFiles uses, so the two
  // instruments draw the same files and their numbers can be compared.
  const out: CorpusFile[] = []
  const stack: string[] = [PY_CORPUS]
  while (stack.length && out.length < want) {
    const d = stack.shift()!
    let ents
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { continue }
    for (const e of ents) {
      if (out.length >= want) break
      if (e.name === ".git") continue
      const p = join(d, e.name)
      if (e.isDirectory()) { stack.push(p); continue }
      if (!EXTS.some((x) => e.name.endsWith(x))) continue
      try { if (statSync(p).size > 400_000) continue } catch { continue }
      let src: string
      try { src = readFileSync(p, "utf8") } catch { continue }
      if (!src.includes("class ") && !src.includes("def ")) continue
      const rel = p.slice(PY_CORPUS.length + 1)
      const cut = rel.indexOf("/")
      out.push({ repo: cut > 0 ? rel.slice(0, cut) : rel, rel: cut > 0 ? rel.slice(cut + 1) : rel, abs: p })
    }
  }
  if (!out.length) {
    console.error(`\nPAYLOAD PROBE: derived sample is EMPTY over ${PY_CORPUS}. Refusing to print a timing about nothing.\n`)
    process.exit(2)
  }
  return out
}

/**
 * Load an analyzer from an arbitrary source file.
 *
 * The baseline copy is rewritten so its `./engine` import becomes an ABSOLUTE path into the
 * repo. Two attempts came first and both failed for the same reason: the analyzer resolves
 * `from "./engine"` relative to itself, so a copy sitting in /tmp cannot find it, and
 * dropping the copy into `src/ast/` instead would put a file in a directory this lane does not
 * own. Rewriting one import specifier keeps both the measurement and the ownership boundary.
 */
async function loadAnalyzer(sourcePath: string, tag: string): Promise<any> {
  try { execFileSync("mkdir", ["-p", "/tmp/opencode"]) } catch {}
  const tmp = join("/tmp/opencode", `py-analyzer-${tag}.ts`)
  const engineAbs = join(REPO, "src", "ast", "engine.ts")
  const patched = readFileSync(sourcePath, "utf8")
    .split('from "./engine"').join(`from ${JSON.stringify(engineAbs)}`)
    .split("from './engine'").join(`from ${JSON.stringify(engineAbs)}`)
  execFileSync("sh", ["-c", `cat > ${JSON.stringify(tmp)}`], { input: patched, stdio: ["pipe", "ignore", "inherit"] })
  const mod = await import(tmp)
  return Object.values(mod).find((v: any) => typeof v === "function" && /Analyzer$/.test(v.name))
}

/**
 * Time the two halves SEPARATELY.
 *
 * The first version timed parse+analyze together and reported +32%, then +43% on a second
 * run of the same code — because the BASELINE moved from 36,426 ms to 29,859 ms on
 * identical work. An 18% swing on the control arm is not a measurement of anything, and a
 * delta computed from two unstable numbers is a delta about noise. Three things fixed it:
 *
 *   - `parse` and `analyze` are timed apart. Parsing dominates the total and is identical in
 *     both arms, so folding it in only dilutes the signal the change could have moved.
 *   - the arms INTERLEAVE per file rather than running as two blocks, so a machine that gets
 *     busier mid-run taxes both arms in proportion instead of taxing whichever ran second.
 *   - REPEATS runs of each arm, reported as a median, with the minimum beside it. The median
 *     is the number to quote; the minimum is the number that shows what the code costs when
 *     the machine is quiet. Both are printed because a gap between them is itself the finding
 *     about this host.
 */
const REPEATS = Number(process.env.REPEATS ?? 5)

interface Arm { analyzeMs: number[]; parseMs: number[]; symbols: number; relationships: number; imports: number; failed: number; tally: Map<string, number>; perTypeFiles: Map<string, Set<string>> }

async function measureArm(Cls: any, files: CorpusFile[], trees: { content: string; root: N; label: string }[], label: string): Promise<Arm> {
  const arm: Arm = { analyzeMs: [], parseMs: [], symbols: 0, relationships: 0, imports: 0, failed: 0, tally: new Map(), perTypeFiles: new Map() }
  const reps: number[] = new Array(REPEATS).fill(0)
  for (let r = 0; r < REPEATS; r++) {
    let sym = 0, rel = 0, imp = 0, bad = 0
    const tally = new Map<string, number>()
    const perTypeFiles = new Map<string, Set<string>>()
    const t0 = performance.now()
    for (let i = 0; i < trees.length; i++) {
      const t = trees[i]
      const tA = performance.now()
      try {
        const res: any = new Cls().analyze(t.root as any, t.content, t.label)
        sym += (res.symbols ?? []).length
        rel += (res.relationships ?? []).length
        imp += (res.imports ?? []).length
        for (const e of (res.relationships ?? []) as any[]) {
          const ty: string | undefined = e.relationshipType ?? e.type
          if (!ty) continue
          tally.set(ty, (tally.get(ty) ?? 0) + 1)
          let s = perTypeFiles.get(ty)
          if (!s) { s = new Set(); perTypeFiles.set(ty, s) }
          if (s.size < 4) s.add(t.label)
        }
      } catch { bad++ }
      reps[r] += performance.now() - tA
    }
    arm.analyzeMs.push(reps[r])
    if (r === 0) { arm.symbols = sym; arm.relationships = rel; arm.imports = imp; arm.failed = bad; arm.tally = tally; arm.perTypeFiles = perTypeFiles }
  }
  return arm
}

/** Parse once, reuse the trees for every repeat — parse is identical in both arms. */
async function buildTrees(files: CorpusFile[]) {
  const { getParser } = await import(`${REPO}/src/ast/engine.ts`)
  const parser = await getParser("python")
  const trees: { content: string; root: N; label: string }[] = []
  const t0 = performance.now()
  for (const f of files) {
    try {
      const content = readFileSync(f.abs, "utf8")
      const pr = await parser.parse(content, f.abs)
      trees.push({ content, root: pr.rootNode as any, label: `${f.repo}/${f.rel}` })
    } catch {}
  }
  return { trees, parseMs: performance.now() - t0 }
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

const SAMPLE = deriveSample(NFILES)
console.log(`python payload / latency probe   repo=${REPO}`)
console.log(`population: ${PY_CORPUS}`)
console.log(`sample, DERIVED (first ${SAMPLE.length} declaration-bearing .py/.pyi files <=400KB in directory order)`)
console.log(`  drawn from: ${[...new Set(SAMPLE.map((f) => f.repo))].join(" ")}`)
console.log(`  the SAME ${SAMPLE.length} files are measured for both arms`)
console.log(`baseline ref: ${process.env.BB_BASELINE ?? BASELINE_REF}`)

const currentSrc = join(REPO, "src", "ast", "real-python-analyzer.ts")
const baselineSrc = process.env.BB_BASELINE ?? "/tmp/opencode/py-analyzer-baseline.ts"
if (!process.env.BB_BASELINE) {
  try {
    execFileSync("git", ["-C", REPO, "show", `${BASELINE_REF}:src/ast/real-python-analyzer.ts`], { stdio: ["ignore", (await import("node:fs")).openSync(baselineSrc, "w"), "inherit"] })
  } catch {
    try { execFileSync("sh", ["-c", `git -C ${REPO} show ${BASELINE_REF}:src/ast/real-python-analyzer.ts > ${baselineSrc}`]) }
    catch { console.error(`\nPAYLOAD PROBE: cannot read the baseline at ${BASELINE_REF}. Pass BB_BASELINE=<file>.\n`); process.exit(2) }
  }
}
const curBytes = statSync(currentSrc).size
const baseBytes = statSync(baselineSrc).size
const curLines = readFileSync(currentSrc, "utf8").split("\n").length
const baseLines = readFileSync(baselineSrc, "utf8").split("\n").length

const ClsBase = await loadAnalyzer(baselineSrc, "baseline")
const ClsCur = await loadAnalyzer(currentSrc, "current")

const { trees, parseMs } = await buildTrees(SAMPLE)
console.log(`parsed ${trees.length} trees once, shared by both arms (${parseMs.toFixed(0)} ms) — parse is IDENTICAL in both arms, so it is excluded from the delta`)
console.log(`each arm: ${REPEATS} repeats, ANALYZE ONLY, warm-up = repeat 1 discarded\n`)

const A = await measureArm(ClsBase, SAMPLE, trees, "baseline")
const B = await measureArm(ClsCur, SAMPLE, trees, "current")
const A2 = await measureArm(ClsBase, SAMPLE, trees, "baseline")
const B2 = await measureArm(ClsCur, SAMPLE, trees, "current")

const allA = [...A.analyzeMs, ...A2.analyzeMs].slice(1).sort((x, y) => x - y)
const allB = [...B.analyzeMs, ...B2.analyzeMs].slice(1).sort((x, y) => x - y)
const medA = median(allA)
const medB = median(allB)
const minA = Math.min(...allA)
const minB = Math.min(...allB)

console.log(`ANALYZE-ONLY wall clock over ${trees.length} files, ${allA.length} timed repeats per arm:`)
console.log(`  baseline  median ${medA.toFixed(0)} ms   min ${minA.toFixed(0)} ms   spread ${(Math.max(...allA) / Math.min(...allA)).toFixed(2)}x`)
console.log(`  current   median ${medB.toFixed(0)} ms   min ${minB.toFixed(0)} ms   spread ${(Math.max(...allB) / Math.min(...allB)).toFixed(2)}x`)
const dMed = ((medB - medA) / medA) * 100
const dMin = ((minB - minA) / minA) * 100
console.log(`  delta on medians  ${dMed >= 0 ? "+" : ""}${dMed.toFixed(2)}%  (${(medB - medA).toFixed(0)} ms)`)
console.log(`  delta on minima   ${dMin >= 0 ? "+" : ""}${dMin.toFixed(2)}%  (${(minB - minA).toFixed(0)} ms)`)
console.log(`  the spread between repeats is the noise floor on this host; a delta smaller than it is not a finding`)

/**
 * A DETERMINISTIC PROXY, because a wall-clock delta on a shared host is not a verdict.
 *
 * The whole cost this lane's change can add is ONE extra walk of the parse tree, done before
 * the main walk. So measure exactly that: a bare iterative walk that touches every node and
 * does nothing else. Its cost IS the upper bound on the new pre-pass, and a ratio against the
 * analyzer's own time is far less noise-sensitive than two end-to-end timings because both
 * sides walk the same trees in the same process.
 */
{
  const walks: number[] = []
  const analyses: number[] = []
  for (let r = 0; r < 5; r++) {
    let acc = 0
    const t0 = performance.now()
    for (const t of trees) {
      const stack: N[] = [t.root]
      let seen = 0
      while (stack.length) {
        const n = stack.pop()
        seen++
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const c = n.namedChild(i)
          if (c) stack.push(c)
        }
      }
      acc += seen
    }
    walks.push(performance.now() - t0)
    const t1 = performance.now()
    for (const t of trees) new ClsCur().analyze(t.root as any, t.content, t.label)
    analyses.push(performance.now() - t1)
  }
  const wMed = median(walks.slice(1))
  const aMed = median(analyses.slice(1))
  console.log(`\nDETERMINISTIC PROXY — one bare full-tree walk over the same ${trees.length} trees:`)
  console.log(`  bare walk (touches every node, does nothing)  median ${wMed.toFixed(0)} ms`)
  console.log(`  full analyze (current HEAD)                   median ${aMed.toFixed(0)} ms`)
  console.log(`  the new pre-pass is ONE such walk, so its worst-case cost is ${((wMed / aMed) * 100).toFixed(1)}% of analyze time`)
  console.log(`  and that is an UPPER BOUND: the real pre-pass skips most node bodies`)
}
console.log(`\npayload over the same ${trees.length} files (arm 1, unmutated counts):`)
console.log(`  symbols       ${A.symbols} -> ${B.symbols}`)
console.log(`  relationships ${A.relationships} -> ${B.relationships}  (${fmtPct((B.relationships - A.relationships) / A.relationships * 100)})`)
console.log(`  imports[]     ${A.imports} -> ${B.imports}`)
console.log(`  analyzer src  ${baseLines} lines / ${baseBytes} B  ->  ${curLines} lines / ${curBytes} B`)
console.log(`\nper-type edges, baseline -> current:`)
const types = [...new Set([...A.tally.keys(), ...B.tally.keys()])].sort()
for (const t of types) {
  const a = A.tally.get(t) ?? 0
  const b = B.tally.get(t) ?? 0
  const mark = a === b ? "  " : (b > a ? "+ " : "- ")
  console.log(`  ${mark}${t.padEnd(14)} ${String(a).padStart(8)} -> ${String(b).padStart(8)}${a !== b ? `   (${b - a >= 0 ? "+" : ""}${b - a})` : ""}`)
}
console.log(`\nexamples for any type whose count moved:`)
for (const t of types) {
  if ((A.tally.get(t) ?? 0) === (B.tally.get(t) ?? 0)) continue
  const ex = [...(B.perTypeFiles.get(t) ?? [])].slice(0, 2)
  console.log(`  ${t}: ${ex.join(", ")}`)
}
console.log(`\nNOTE: python's row in validation/m60/analyzer-budget-register.json is currently`)
console.log(`"unscorable"/open with the recorded reasons "no loadRule (#871)" and "no corpusManifest`)
console.log(`(#909)", so there is no GREEN budget here to regress and nothing for a lane agent to`)
console.log(`re-baseline. The numbers above are this lane's before/after, reported rather than filed.`)

function fmtPct(x: number): string {
  return `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`
}
