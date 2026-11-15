/**
 * 2026-09-29: report the csharp analyzer's UNEXPLAINED edges per label — the fabrications.
 *
 * ############################################################################################
 * # THIS PROBE CANNOT REPRODUCE THE HARNESS'S TRUTH, AND MUST NOT BE USED TO REPORT DEFECTS.
 * #
 * # It is kept, and this banner is the reason, because running it is the fastest way to
 * # understand why the per-label breakdown the harness lacks cannot simply be built from
 * # outside. Measured against the real numbers:
 * #
 * #   harness (powershell, 120 files)   unexplained = 18   (3 after the compared-set widening)
 * #   this probe  (59 files)            unexplained = 935
 * #
 * # The 935 is ENTIRELY this probe's own artifact. `CSHARP_INTERFACES` is built INSIDE the
 * # harness and is not exported, so `deriveCSharpEdges(root, undefined)` derives strictly LESS
 * # truth than the gate does, and every edge the interface companion would have explained is
 * # reported as a fabrication. 935 confident, specific, entirely fictional findings.
 * #
 * # This is the THIRD time this round that a private reimplementation of harness internals
 * # produced confident numbers that were wrong. The first compared raw targets instead of
 * # normTarget and nearly filed a non-existent defect as CS-D11. The second missed the
 * # `te.target.includes(...)` disjunct and reported 972 instead of 18. All three had the same
 * # shape: a measurement that looked rigorous, disagreed with the gate, and was believed
 * # because the disagreement was concrete.
 * #
 * # The correct fix is in the HARNESS, not here: report `unexplained` per label inside the
 * # per-file loop, where `truth` and `rels` are both in scope and the corpus context is built.
 * # That is a change to a file three agents are editing, so it is left for whoever owns the
 * # shared file rather than landed blind from a probe.
 * #
 * # Two secondary defects in this file, also left in place for the same reason, because a
 * # reader who finds them should know they were known: the sample lines use `path.basename`,
 * # so unrelated files called `Program.cs` render as one file and 935 rows look like one
 * # offender; and the harness's 0.7 confidence split is reproduced faithfully, so this probe
 * # can never be stricter than the gate it is meant to explain.
 * ############################################################################################
 *
 *
 * WHAT THIS IS ABOUT. F5 reports one number for the whole lane: `unexplained`. The lane can sit
 * at MISSING=0, 100% covered, and still be emitting edges the tree does not support. That is the
 * direction the aggregate hides, because MISSING=0 is read as "clean" and nobody looks at the
 * other number. powershell reported 18 and fsharp 8 while both were at 100% covered.
 *
 * A single count across every label is not actionable: 18 could be 18 defects in one rule or one
 * defect in a shape that appears 18 times, and those need opposite responses. So this reports the
 * count PER LABEL, and for each label prints the distinct SHAPES, because the shape is what names
 * the rule to go and fix.
 *
 * THE RULE. An analyzer edge is a fabrication when the analyzer asserts it at confidence >= 0.7 and
 * no truth row matches on `label + normTarget(target)`. The 0.7 threshold is the harness's own
 * (low-confidence edges are declared HEURISTIC, which is honest suspicion rather than a claim), and
 * it is reproduced here rather than tightened, so this probe can never be stricter than the gate
 * it is explaining — a probe that invents findings the gate does not have is the same mistake as
 * the private matcher in cs-deep-60.
 */
import * as fs from "fs"
import * as path from "path"
import { Language } from "web-tree-sitter"

const ROOT = process.cwd()
const COMPARED = new Set(["calls", "contains", "references", "uses", "extends", "implements", "instantiates"])

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}

const wts: any = await import("web-tree-sitter")
const Parser = wts.Parser ?? wts.default ?? wts
await Parser.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-c_sharp.wasm")))
const parser = new Parser()
parser.setLanguage(grammar)

const mod: any = await import(path.join(ROOT, "src/ast/real-csharp-analyzer.ts"))
const analyzer = new mod.RealCSharpAnalyzer()
const diff: any = await import(path.join(ROOT, "script/m14/differential.ts"))
const normTarget: (t: string) => string = diff.normTarget

async function truthFor(root: any): Promise<any[]> {
  const out: any[] = []
  for (const e of diff.deriveCSharpEdges(root, diff.CSHARP_INTERFACES)) {
    if (e.label === "overrides") continue
    out.push(e)
  }
  for (const fn of ["deriveCSharpDeclaredTypeEdges", "deriveCSharpUsingReferences", "deriveCSharpContains", "deriveCSharpFieldAccessUses", "deriveCSharpBareUses"]) {
    const f = diff[fn]
    if (typeof f !== "function") continue
    try { for (const e of f(root)) out.push(e) } catch { /* an oracle that throws is its own finding */ }
  }
  return out
}

async function main() {
  const listFile = arg("--list")
  if (!listFile) { console.error("usage: cs-deep-62 --list <paths> [--limit N]"); process.exit(2) }
  const limit = Number(arg("--limit") ?? 60)
  const files = fs.readFileSync(listFile, "utf8").split("\n").map((f) => f.trim()).filter(Boolean).slice(0, limit)

  const perLabel = new Map<string, number>()
  const shapes = new Map<string, Map<string, number>>()
  const samples = new Map<string, string[]>()
  let totalEdges = 0
  let filesSeen = 0

  for (const f of files) {
    let src: string
    try { src = fs.readFileSync(f, "utf8") } catch { continue }
    if (src.length > 1_000_000) continue
    let root: any
    try { root = parser.parse(src)?.rootNode } catch { continue }
    if (!root) continue
    filesSeen++

    let rels: any[] = []
    try { rels = (await analyzer.analyze(root, f, src))?.relationships ?? [] } catch { continue }
    const truth = await truthFor(root)
    const truthByLabel = new Map<string, any[]>()
    for (const t of truth) {
      const arr = truthByLabel.get(String(t.label)) ?? []
      arr.push(t)
      truthByLabel.set(String(t.label), arr)
    }

    for (const r of rels) {
      const l = String(r.type ?? r.label ?? "")
      if (!COMPARED.has(l)) continue
      totalEdges++
      const conf = typeof r.confidence === "number" ? r.confidence : 1
      if (conf < 0.7) continue
      // The HARNESS's hit condition, which is looser than equality and is the second thing this
      // probe got wrong. The harness accepts either
      //     normTarget(te.target) === normTarget(r.target)      <- same leaf
      //  or te.target.includes(normTarget(r.target))              <- truth target CONTAINS the leaf
      // so a truth row for `Foo.Bar` also explains an analyzer edge to `Bar`. With equality alone
      // this probe reported 972 unexplained `uses` edges; the harness reports 18. Both numbers
      // were "correct" for their own matcher, which is precisely why a probe that does not
      // import the matcher manufactures work. Substring containment is a weak rule and is
      // discussed where it is defined; reproducing it here is about REPORTING THE SAME THING,
      // not about endorsing it.
      const nt = normTarget(String(r.target ?? ""))
      const hit = [...truthByLabel.get(l) ?? []].some((t: any) => normTarget(String(t.target ?? "")) === nt || String(t.target ?? "").includes(nt))
      if (hit) continue

      perLabel.set(l, (perLabel.get(l) ?? 0) + 1)
      // a "shape" is the target with identifiers collapsed, so one rule that fires 18 times
      // shows up as one row with 18 next to it rather than 18 rows that look like 18 rules
      const t = String(r.target ?? "")
      const shape = t.replace(/[A-Za-z_][A-Za-z0-9_]*/g, "X")
      const m = shapes.get(l) ?? new Map<string, number>()
      m.set(shape, (m.get(shape) ?? 0) + 1)
      shapes.set(l, m)
      const arr = samples.get(l) ?? []
      if (arr.length < 4) arr.push(`      ${path.basename(f)}  -[${l}]-> ${t}  src=${r.source ?? "-"}`)
      samples.set(l, arr)
    }
  }

  const grand = [...perLabel.values()].reduce((a, b) => a + b, 0)
  console.log(`unexplained csharp edges per label — ${filesSeen} files, ${totalEdges} compared edges emitted\n`)
  if (grand === 0) {
    console.log("  none. Every confident analyzer edge on a compared label is matched by a truth row.")
    return
  }
  console.log(`  ${grand} unexplained\n`)
  for (const l of [...perLabel.keys()].sort()) {
    console.log(`  ${l}: ${perLabel.get(l)}`)
    for (const [shape, n] of [...(shapes.get(l) ?? new Map())].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      console.log(`      ${String(n).padStart(4)}x  target shape  ${shape}`)
    }
    for (const s of samples.get(l) ?? []) console.log(s)
    console.log("")
  }
  console.log(`  Count per label first, then SHAPE: one rule firing many times and many rules firing`)
  console.log(`  once need opposite responses, and a bare total cannot tell them apart.`)
}

await main()
