/**
 * The C++ lane's PER-FIX A/B, INTERLEAVED.
 *
 * The first version of this probe ran each arm in its own process and reported
 * 14.6 ms/file pre-fix against 18.6 ms/file post-fix — a 27% regression that a
 * 27% swing in run-to-run variance could not distinguish from noise (best 1753ms
 * vs median 3491ms on a box other agents are sweeping). A single A/B on a shared
 * machine measures contention, not code.
 *
 * So both arms live in ONE process and alternate, rep by rep, on the SAME parsed
 * trees. Contention then lands on both arms equally and cancels, and the ratio is
 * the only number that survives. This is the shape the claim in the doc rests on.
 *
 * The PRE-fix arm is materialised from git at run time
 * (`git show <base>:src/ast/real-cpp-analyzer.ts`) rather than committed as a
 * second copy of the analyzer: a committed duplicate is 2,700 lines that go stale
 * the moment the analyzer is edited again, and a stale measurement harness is
 * worse than none. BASE defaults to the commit before the D1–D5 work.
 *
 *   bun run script/cpp-review/perf-interleaved.ts [reps]      # BASE=auto
 *   BASE=<sha> bun run script/cpp-review/perf-interleaved.ts 7
 */
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { RealCppAnalyzer as Post } from "../../src/ast/real-cpp-analyzer"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/ishaq/fixtures/repositories"
const REPOS = (process.env.CPP_REPOS ?? "fmt,nlohmann-json,catch2").split(",").filter(Boolean)
const EXTS = [".cpp", ".cc", ".cxx", ".c++", ".hpp", ".hxx", ".hh", ".h++"]
const SKIP = new Set([".git", "build", "node_modules", ".github"])
const REPS = Number(process.argv[2] ?? 7)
const LIMIT = Number(process.env.CPP_PERF_FILES ?? 120)
const OUT = process.env.CPP_OUT ?? "/tmp/opencode/cpp-review"
const PREFIX_MODULE = path.join(import.meta.dirname, "analyzer-prefix.ts")
// The commit the D1–D5 work landed on top of.
const DEFAULT_BASE = "2d32f088b9"

// Materialise the pre-fix analyzer from git, fixing its one relative import.
const base = process.env.BASE ?? DEFAULT_BASE
writeFileSync(
  PREFIX_MODULE,
  execFileSync("git", ["show", `${base}:src/ast/real-cpp-analyzer.ts`], { cwd: process.cwd(), maxBuffer: 1 << 28 }).toString()
    .replace('from "./engine"', 'from "../../src/ast/engine"'),
)
const { RealCppAnalyzer: Pre } = await import(PREFIX_MODULE)

const walk = (d: string, out: string[] = [], depth = 0): string[] => {
  if (depth > 8) return out
  let es: string[]
  try { es = readdirSync(d) } catch { return out }
  for (const e of es) {
    if (SKIP.has(e)) continue
    const p = path.join(d, e)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out, depth + 1)
    else if (EXTS.some((x) => p.endsWith(x)) && st.size > 0) out.push(p)
  }
  return out
}

const files: string[] = []
for (const r of REPOS) {
  for (const f of walk(path.join(CORPUS, r))) {
    files.push(f)
    if (files.length >= LIMIT) break
  }
  if (files.length >= LIMIT) break
}

const samples: { root: any; content: string; file: string }[] = []
for (const f of files) {
  try {
    const content = readFileSync(f, "utf8")
    const { tree } = await ASTEngine.parseTree(f, content)
    samples.push({ root: tree.rootNode, content, file: f })
  } catch { /* not parseable */ }
}

const pass = (A: any): { ms: number; symbols: number; rels: number } => {
  const t0 = performance.now()
  let symbols = 0, rels = 0
  for (const s of samples) {
    try {
      const res = new A().analyze(s.root, s.content, s.file)
      symbols += res.symbols.length
      rels += res.relationships.length
    } catch { /* ignore */ }
  }
  return { ms: performance.now() - t0, symbols, rels }
}

// warm both
for (let i = 0; i < 2; i++) { pass(Pre); pass(Post) }

const pre: number[] = [], post: number[] = []
let preS = 0, preR = 0, postS = 0, postR = 0
for (let r = 0; r < REPS; r++) {
  // alternate the order each rep so neither arm is systematically first
  const order = r % 2 === 0 ? [["pre", Pre], ["post", Post]] : [["post", Post], ["pre", Pre]]
  for (const [label, A] of order as [string, any][]) {
    const m = pass(A)
    if (label === "pre") { pre.push(m.ms); preS = m.symbols; preR = m.rels }
    else { post.push(m.ms); postS = m.symbols; postR = m.rels }
  }
}
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
const best = (a: number[]) => Math.min(...a)

const out = {
  generatedAt: new Date().toISOString(), files: samples.length, reps: REPS, base,
  perPass: { pre: { symbols: preS, relationships: preR }, post: { symbols: postS, relationships: postR } },
  removedPerPass: { symbols: preS - postS, relationships: preR - postR },
  pre: { bestMs: +best(pre).toFixed(1), medianMs: +med(pre).toFixed(1), all: pre.map((x) => +x.toFixed(1)) },
  post: { bestMs: +best(post).toFixed(1), medianMs: +med(post).toFixed(1), all: post.map((x) => +x.toFixed(1)) },
  ratioBest: +(best(post) / best(pre)).toFixed(3),
  ratioMedian: +(med(post) / med(pre)).toFixed(3),
  msPerFilePre: +(med(pre) / samples.length).toFixed(2),
  msPerFilePost: +(med(post) / samples.length).toFixed(2),
  note: "parse EXCLUDED (trees built once and shared); both arms in one process, order alternated per rep. The TIME ratio is not a claim on its own — measure the spread below: on a contended box the two distributions overlap, and the machine-independent win is `removedPerPass`.",
}
mkdirSync(OUT, { recursive: true })
writeFileSync(path.join(OUT, "perf-interleaved.json"), JSON.stringify(out, null, 2))
console.log(JSON.stringify(out, null, 2))
// The materialised copy is a build product of this probe, not a source file.
try { rmSync(PREFIX_MODULE) } catch { /* best effort */ }
