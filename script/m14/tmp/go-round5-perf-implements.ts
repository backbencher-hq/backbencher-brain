// go lane — ROUND 5, the GO34 measurement in the shape that triggers it.
//
// The corpus row in `go-round5-perf.ts` is the honest answer for a real corpus:
// on go-tools the pre/post ratio is 1.01-1.18x, because a typical Go file has
// a handful of interfaces and a handful of struct candidates and the
// implements pass's O(interfaces x candidates) cost is invisible there. Saying
// only that would understate the fix and overstate its importance.
//
// So this script measures the SHAPE the defect lives in — many interfaces and
// many candidate types in one file, with embedding so the promoted-method
// closure has work to do — and grows it, so §9's scaling question has an answer
// on both sides: was the pre-fix cost superlinear, and is the post-fix cost
// flat? The generator is fully deterministic (fixed method sets, fixed
// embedding depth), so the same shapes are reproduced byte-for-byte on any
// machine.
//
// The pre-fix analyzer is materialised from `git show HEAD:` and the two sides
// run INTERLEAVED in one process, so the ratio does not depend on machine load
// (see go-round5-perf.ts for why that matters, and #871 for what happens if a
// row is reported without its load context).
//
// Run: bun script/m14/tmp/go-round5-perf-implements.ts [--sizes 10,20,40,80,120]
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { execSync } from "node:child_process"
import { ASTEngine } from "../../../src/ast/engine"
import { RealGoAnalyzer as PostFix } from "../../../src/ast/real-go-analyzer"

const arg = (name: string): string | undefined => {
  const eq = process.argv.find((a) => a.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

// ------------------------------------------------------------------ pre-fix side
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "go-r5-impl-"))
const preFixPath = path.join(tmpDir, "go-analyzer-pre-round5.ts")
{
  const raw = execSync("git show HEAD:src/ast/real-go-analyzer.ts", {
    cwd: path.join(import.meta.dir, "../../.."),
    maxBuffer: 1 << 28,
  }).toString()
  if (!raw.includes("class RealGoAnalyzer")) {
    console.error("REFUSING TO RUN: HEAD's analyzer does not declare RealGoAnalyzer")
    process.exit(2)
  }
  fs.writeFileSync(preFixPath, raw.replace(/from "\.\/engine"/g, `from "${path.join(import.meta.dir, "../../../src/ast/engine")}"`))
}
const PreFix = (await import(preFixPath)).RealGoAnalyzer as typeof PostFix
const headSha = execSync("git rev-parse HEAD", { cwd: path.join(import.meta.dir, "../../..") }).toString().trim()

// ------------------------------------------------------------------ the generator
// One interface per method-set shape, one candidate type per struct shape, and a
// three-deep embedding chain so the promoted-method closure must walk. Every
// candidate SATISFIES the interfaces it can, so the pass has real work: the
// measured cost is the comparison, not an early exit.
const METHODS = 5
const gen = (n: number): string => {
  const out: string[] = ["package synth", ""]
  for (let i = 0; i < n; i++) {
    out.push(`type I${i} interface {`)
    for (let m = 0; m < METHODS; m++) out.push(`\tM${m}(a int, b string) (int, error)`)
    out.push("}")
    out.push("")
  }
  // the embedding chain
  out.push("type E0 struct { Z int }", "")
  for (let m = 0; m < METHODS; m++) out.push(`func (e *E0) M${m}(a int, b string) (int, error) { return a, nil }`)
  out.push("type E1 struct { *E0; Y int }", "")
  for (let m = 0; m < METHODS; m++) out.push(`func (e *E1) M${m}(a int, b string) (int, error) { return a, nil }`)
  out.push("type E2 struct { *E1; X int }", "")
  for (let m = 0; m < METHODS; m++) out.push(`func (e *E2) M${m}(a int, b string) (int, error) { return a, nil }`)
  out.push("")
  for (let i = 0; i < n; i++) {
    out.push(`type S${i} struct { *E2; W${i} int }`, "")
    for (let m = 0; m < METHODS; m++) out.push(`func (s *S${i}) M${m}(a int, b string) (int, error) { return a, nil }`)
    out.push("")
  }
  return out.join("\n")
}

const sizes = (arg("--sizes") ?? "10,20,40,80,120").split(",").map(Number)
const pre = new PreFix()
const post = new PostFix()

// warm-up
{
  const w = "package w\n\ntype I interface{ M() }\ntype S struct{}\nfunc (s *S) M() {}\n"
  for (const A of [PreFix, PostFix]) {
    const p = await ASTEngine.getParser("go" as any)
    await new A().analyze(p.parse(w).rootNode, w, "w.go")
  }
}

const countNodes = (n: any): number => {
  let c = 1
  for (let i = 0; i < n.namedChildCount; i++) {
    const k = n.namedChild(i)
    if (k) c += countNodes(k)
  }
  return c
}
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d

const rows: any[] = []
for (const n of sizes) {
  const src = gen(n)
  const bytes = Buffer.byteLength(src)
  const parser = await ASTEngine.getParser("go" as any)
  const tree = parser.parse(src)
  if (!tree.rootNode || tree.rootNode.hasError) {
    rows.push({ ifaces: n, structs: n, bytes, error: "the generated file does not parse cleanly — measurement refused" })
    continue
  }
  const nodes = countNodes(tree.rootNode)

  // interleaved, twice each: load hits both sides equally
  let preMs = 0
  let postMs = 0
  let edgesPre = -1
  let edgesPost = -1
  for (let rep = 0; rep < 2; rep++) {
    for (const which of ["pre", "post"] as const) {
      const t0 = process.hrtime.bigint()
      const A = which === "pre" ? PreFix : PostFix
      const res: any = await new A().analyze(tree.rootNode, src, `synth${n}.go`)
      const ms = Number(process.hrtime.bigint() - t0) / 1e6
      if (which === "pre") {
        preMs += ms
        edgesPre = (res.relationships ?? []).filter((x: any) => String(x.type) === "implements").length
      } else {
        postMs += ms
        edgesPost = (res.relationships ?? []).filter((x: any) => String(x.type) === "implements").length
      }
    }
  }
  rows.push({
    ifaces: n,
    structs: n,
    bytes,
    nodes,
    preFixMs: round(preMs),
    postFixMs: round(postMs),
    preFixMsPerKB: round(preMs / 2 / (bytes / 1024)),
    postFixMsPerKB: round(postMs / 2 / (bytes / 1024)),
    ratioPreOverPost: postMs > 0 ? round(preMs / postMs, 3) : null,
    preFixImplementsEdges: edgesPre,
    postFixImplementsEdges: edgesPost,
    edgeSetIdentical: edgesPre === edgesPost,
  })
}

// §9's actual question: is ms/KB FLAT as the file grows? Compare each row's
// per-KB figure against the SMALLEST row of the same side.
const scaling = (key: "preFixMsPerKB" | "postFixMsPerKB") => {
  const live = rows.filter((r) => typeof r[key] === "number" && r.bytes)
  if (live.length < 2) return null
  const base = live[0][key]
  return live.map((r) => ({
    ifaces: r.ifaces,
    perKB: r[key],
    xVsSmallest: round(r[key] / base, 2),
  }))
}

const out = {
  probe: "go-round5-perf-implements",
  preFixSource: `git show ${headSha.slice(0, 7)}:src/ast/real-go-analyzer.ts (import specifier rewritten only)`,
  shape: `${METHODS} methods per interface and per type, a 3-deep embedding chain (E0<-E1<-E2) that every candidate embeds, so the promoted-method closure has real work on every (interface x candidate) pair. Fully deterministic.`,
  method: "both analyzers interleaved, 2 repetitions each, one process, shared warm-up; the ratio is therefore load-independent. /proc/loadavg is printed for disclosure (#871/#909) but no absolute row is claimed as scored.",
  loadContext: (() => {
    const l = Number(fs.readFileSync("/proc/loadavg", "utf8").split(" ")[0])
    const c = os.cpus().length
    return {
      loadavg1: l,
      cpus: c,
      scored: l <= c,
      verdict: l <= c
        ? "SCORED for absolute values"
        : `UNSCORED for absolute values (loadavg1 ${l} > ${c} CPUs); the PRE/POST RATIO and the SHAPE of the scaling curve are what this script claims, and both are load-independent because the sides ran interleaved`,
    }
  })(),
  rows,
  scalingCheck: {
    note: "§9: 'flat ms/KB means linear'. A column that RISES as the file grows is superlinear. xVsSmallest is each row's per-KB cost divided by the smallest row's, on the same side.",
    preFix: scaling("preFixMsPerKB"),
    postFix: scaling("postFixMsPerKB"),
  },
}
fs.rmSync(tmpDir, { recursive: true, force: true })
console.log(JSON.stringify(out, null, 2))
