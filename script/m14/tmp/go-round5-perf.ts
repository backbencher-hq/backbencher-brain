// go lane — ROUND 5 perf measurement (LANE-AUDIT-FORMULA §9).
//
// Four requirements, and why this script is shaped the way it is:
//
//   (a) THE ANALYZER and THE PRODUCT ENTRY measured SEPARATELY. `parseFile` is
//       what a real index runs; the analyzer alone is what a lane's own cost
//       looks like. They are reported as separate rows.
//   (b) NORMALIZED per 1k nodes AND inside a FIXED SIZE BAND — absolute ms on a
//       corpus of mixed file sizes cannot be compared between runs, so every
//       row is a band and a per-1k-nodes figure.
//   (c) A SCALING CHECK by band: "flat ms/KB means linear". The bands are
//       printed in ascending order precisely so a non-flat column is visible.
//   (d) A LOAD CONTEXT on every row, MEASURED — not a note. /proc/loadavg and
//       /proc/stat are read at the moment the run finishes and printed with
//       the rows, because a row measured under concurrent load is unscored, not
//       evidence (#871, and the C lane's 10x-inflated undisclosed row, #909).
//
// THE COMPARISON THIS SCRIPT EXISTS TO MAKE. §9 needs a before/after for the
// GO34 implements-pass fix, and a before/after on a shared machine is only
// meaningful if both sides see the SAME load. So this script materialises the
// PRE-FIX analyzer from `git show HEAD:src/ast/real-go-analyzer.ts` (only its
// import specifier rewritten, so the measured code is the committed code and
// not a paraphrase) and then runs the two ANALYZERS INTERLEAVED, file by file,
// in one process. Load perturbs both sides equally, so the RATIO survives a
// busy box even when neither absolute number is scorable — and the absolute
// numbers are printed with the load that produced them, unscored if it was busy.
//
// Run: bun script/m14/tmp/go-round5-perf.ts [--repos a,b] [--files N] [--min-kb N] [--max-kb N]
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { execSync } from "node:child_process"
import { ASTEngine } from "../../../src/ast/engine"
import { RealGoAnalyzer as PostFix } from "../../../src/ast/real-go-analyzer"

// ------------------------------------------------------------------ load context
const loadavg1 = (): number => {
  try {
    return Number(fs.readFileSync("/proc/loadavg", "utf8").split(" ")[0])
  } catch {
    return NaN
  }
}
const cpuBusyFraction = (): number => {
  try {
    const line = fs.readFileSync("/proc/stat", "utf8").split("\n")[0]
    const parts = line.trim().split(/\s+/).slice(1).map(Number)
    const total = parts.reduce((a, b) => a + b, 0)
    const idle = (parts[3] ?? 0) + (parts[4] ?? 0)
    return total > 0 ? 1 - idle / total : NaN
  } catch {
    return NaN
  }
}
const cpuCount = (): number => {
  // /proc's cpuN entries are not always visible inside a mount namespace, and
  // a `cpus: 0` in the verdict line reads as a broken measurement rather than
  // as a fallback. Prefer the directory, fall back to os.cpus().
  try {
    const n = fs.readdirSync("/proc").filter((x) => /^cpu\d+$/.test(x)).length
    if (n > 0) return n
  } catch {
    /* fall through */
  }
  return os.cpus().length
}
const arg = (name: string): string | undefined => {
  const eq = process.argv.find((a) => a.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

// ------------------------------------------------------------------ the pre-fix analyzer
// Materialised, never paraphrased. `git show HEAD:` is the committed bytes; the
// only edit is the relative import specifier, because the file lands outside
// `src/ast/` where `./engine` no longer resolves. The script REFUSES to run if
// the materialised source is not a Go analyzer, so a bad checkout cannot turn
// the "pre-fix" side into a no-op that would make the ratio meaningless.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "go-r5-perf-"))
const preFixPath = path.join(tmpDir, "go-analyzer-pre-round5.ts")
{
  const raw = execSync("git show HEAD:src/ast/real-go-analyzer.ts", {
    cwd: path.join(import.meta.dir, "../../.."),
    maxBuffer: 1 << 28,
  }).toString()
  if (!raw.includes("class RealGoAnalyzer")) {
    console.error("REFUSING TO RUN: HEAD's src/ast/real-go-analyzer.ts does not declare RealGoAnalyzer")
    process.exit(2)
  }
  const rewritten = raw.replace(/from "\.\/engine"/g, `from "${path.join(import.meta.dir, "../../../src/ast/engine")}"`)
  fs.writeFileSync(preFixPath, rewritten)
}
const PreFix = (await import(preFixPath)).RealGoAnalyzer as typeof PostFix
const headSha = execSync("git rev-parse HEAD", { cwd: path.join(import.meta.dir, "../../..") }).toString().trim()

// ------------------------------------------------------------------ the corpus
const REPOS = arg("--repos") ?? "/home/ishaq2321/bb_tests/repositories/go-tools"
const MIN_KB = Number(arg("--min-kb") ?? 8)
const MAX_KB = Number(arg("--max-kb") ?? 40)
const WANT = Number(arg("--files") ?? 300)

const files: { p: string; bytes: number }[] = []
for (const root of REPOS.split(",")) {
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (e.name === ".git" || e.name === "vendor" || e.name === "node_modules") continue
        stack.push(path.join(dir, e.name))
      } else if (e.isFile() && e.name.endsWith(".go")) {
        const p = path.join(dir, e.name)
        const bytes = fs.statSync(p).size
        if (bytes >= MIN_KB * 1024 && bytes <= MAX_KB * 1024) files.push({ p, bytes })
      }
    }
  }
}
files.sort((a, b) => (a.p < b.p ? -1 : a.p > b.p ? 1 : 0))
const band = files.slice(0, WANT)

const BANDS: [string, number, number][] = [
  ["8-12", 8, 12],
  ["12-20", 12, 20],
  ["20-40", 20, 40],
]
const bandOf = (kb: number) => BANDS.find(([, lo, hi]) => kb >= lo && kb < hi)?.[0] ?? "40+"

const countNodes = (n: any): number => {
  let c = 1
  for (let i = 0; i < n.namedChildCount; i++) {
    const k = n.namedChild(i)
    if (k) c += countNodes(k)
  }
  return c
}

type Acc = { files: number; nodes: number; preMs: number; postMs: number; productMs: number }
const acc: Record<string, Acc> = {}
const get = (b: string): Acc => (acc[b] ??= { files: 0, nodes: 0, preMs: 0, postMs: 0, productMs: 0 })

const pre = new PreFix()
const post = new PostFix()

// WARM-UP: the first parse pays wasm/parser initialisation, and charging that
// to whichever side happened to run first would invent a difference out of
// start-up order. Both sides parse the same throwaway file first.
{
  const warm = "package warmup\n\nfunc f(a int) int { if a > 0 { return a }\nreturn 0 }\n"
  for (const A of [PreFix, PostFix]) {
    const p = await ASTEngine.getParser("go" as any)
    await new A().analyze(p.parse(warm).rootNode, warm, "warmup.go")
  }
}

let readFail = 0
for (const f of band) {
  const src = fs.readFileSync(f.p, "utf8")
  const b = bandOf(Math.round(f.bytes / 1024))
  const a = get(b)
  let nodes = 0

  // ---- interleaved: pre, post, pre, post, so any load drift hits both sides
  for (let rep = 0; rep < 2; rep++) {
    for (const which of ["pre", "post"] as const) {
      const t0 = process.hrtime.bigint()
      try {
        const parser = await ASTEngine.getParser("go" as any)
        const tree = parser.parse(src)
        if (rep === 0 && which === "pre") nodes = countNodes(tree.rootNode)
        const A = which === "pre" ? PreFix : PostFix
        await new A().analyze(tree.rootNode, src, f.p)
      } catch {
        readFail++
        continue
      }
      const ms = Number(process.hrtime.bigint() - t0) / 1e6
      if (which === "pre") a.preMs += ms
      else a.postMs += ms
    }
  }

  // ---- the PRODUCT ENTRY, once per file
  const t2 = process.hrtime.bigint()
  try {
    await ASTEngine.parseFile(f.p, src, { language: "go" } as any)
    a.productMs += Number(process.hrtime.bigint() - t2) / 1e6
  } catch {
    readFail++
  }
  a.files++
  a.nodes += nodes
}

const load1 = loadavg1()
const busy = cpuBusyFraction()
const ncpu = cpuCount()
const round = (n: number | null, d = 2) => (n === null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d)

const rows = BANDS.map(([name]) => {
  const a = acc[name]
  if (!a || !a.files) return { bandKB: name, files: 0 }
  const per1k = (ms: number) => (a.nodes > 0 ? round((ms / a.nodes) * 1000) : null)
  return {
    bandKB: name,
    files: a.files,
    nodes: a.nodes,
    preFixMs: round(a.preMs),
    postFixMs: round(a.postMs),
    preFixMsPer1kNodes: per1k(a.preMs),
    postFixMsPer1kNodes: per1k(a.postMs),
    ratioPreOverPost: a.postMs > 0 ? round(a.preMs / a.postMs, 3) : null,
    productEntryMs: round(a.productMs),
    productEntryMsPer1kNodes: per1k(a.productMs),
  }
}).filter((r) => r.files > 0)

const out = {
  probe: "go-round5-perf",
  preFixSource: `git show ${headSha.slice(0, 7)}:src/ast/real-go-analyzer.ts (import specifier rewritten only)`,
  corpus: { repos: REPOS, sizeBandKB: [MIN_KB, MAX_KB], filesRead: band.length, candidatesInBand: files.length, readFailures: readFail },
  method:
    "BOTH analyzers run INTERLEAVED, 2 repetitions each, file by file, in one process, after a shared warm-up. Load therefore perturbs both sides equally and the ratio is meaningful even when neither absolute number is scorable. `parseFile` (the product entry) is timed once per file, separately.",
  loadContext: {
    loadavg1: round(load1),
    cpuBusyFraction: round(busy),
    cpus: ncpu,
    scored: Number.isFinite(load1) && Number.isFinite(busy) && load1 <= ncpu,
    verdict: !Number.isFinite(load1) || !Number.isFinite(busy)
      ? "UNSCORED — /proc gave no reading; every absolute row here is unscored (#871)"
      : load1 <= ncpu
        ? "SCORED — loadavg1 at or below the CPU count, so nothing else was competing"
        : `UNSCORED for absolute values — loadavg1 ${round(load1)} on ${ncpu} CPUs means other work was running (#871/#909). The PRE/POST RATIO is still reported, because both sides ran interleaved in this process and saw the same load.`,
  },
  scalingCheck:
    "§9 asks whether ms/KB is FLAT across bands. Read the `preFixMsPer1kNodes` / `postFixMsPer1kNodes` columns top to bottom: a rising column is superlinear.",
  rows,
}
fs.rmSync(tmpDir, { recursive: true, force: true })
console.log(JSON.stringify(out, null, 2))
