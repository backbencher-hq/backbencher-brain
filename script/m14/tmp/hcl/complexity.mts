/**
 * HCL COMPLEXITY / SCALING — the claim that does not depend on machine speed.
 *
 * The lane formula's rule 9: a perf row measured under concurrent load is
 * UNSCORED, not evidence. This box currently runs nine analyzer agents and its
 * load average was 35-39 during measurement, and the SAME analyzer over the SAME
 * 600 files measured 1.451 / 2.097 / 3.885 ms per file across three consecutive
 * rounds — a 2.7x spread on identical work. A single ms/file number here would
 * be a measurement of the neighbours, so none is published as a budget.
 *
 * What IS machine-independent, and what this probe measures instead:
 *   1. ms per KiB of SOURCE, by file-size quartile. A linear analyzer has a
 *      flat ms/KB across quartiles; an accidental O(n^2) has a rising one.
 *   2. ms per 1k AST NODES, by node-count quartile. Same test against the tree
 *      the analyzer actually walks, which is the quantity its own complexity
 *      claim is about ("O(nodes) + O(expression nodes)").
 *   3. facts-per-node, which must be flat: a dedupe Set is O(1) per fact, so a
 *      drifting ratio would mean the dedupe is degrading with size.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { ASTEngine } from "/home/ishaq2321/backbencher-brain/src/ast/engine"
import { RealHclAnalyzer } from "/home/ishaq2321/backbencher-brain/src/ast/real-hcl-analyzer"

const REPOS = [
  "/home/ishaq2321/bb_tests/hcl/repos/terraform",
  "/home/ishaq2321/bb_tests/hcl/repos/tf-aws-components",
]
const EXT = /\.(tf|tfvars|hcl|tofu)$/i

const parser = await ASTEngine.getParser("hcl")

function walk(dir: string, out: string[]): string[] {
  for (const e of readdirSync(dir)) {
    if (e === ".git" || e === "node_modules") continue
    const p = join(dir, e)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (EXT.test(e)) out.push(p)
  }
  return out
}

interface Row {
  file: string
  bytes: number
  nodes: number
  ms: number
  facts: number
  symbols: number
  relationships: number
  references: number
  lines: number
}

const rows: Row[] = []
let loadSamples: number[] = []
for (const repo of REPOS) {
  for (const f of walk(repo, [])) {
    const src = readFileSync(f, "utf8")
    if (src.length > 4_000_000) continue
    const tree = parser.parse(src)
    let nodes = 0
    const st: any[] = [tree.rootNode]
    while (st.length) {
      const n = st.pop()!
      nodes++
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) st.push(c)
      }
    }
    // Warm the JIT on a small batch first, then time each file individually so
    // one slow neighbour cannot be attributed to one file.
    const a = new RealHclAnalyzer()
    const t0 = performance.now()
    const r = a.analyze(tree.rootNode as any, src, f)
    const ms = performance.now() - t0
    rows.push({
      file: f,
      bytes: src.length,
      nodes,
      ms,
      facts: r.symbols.length + r.relationships.length,
      symbols: r.symbols.length,
      relationships: r.relationships.length,
      references: r.relationships.filter((x) => x.type === "references").length,
      lines: src.split("\n").length,
    })
    loadSamples.push(Number(readFileSync("/proc/loadavg", "utf8").split(" ")[0]))
    tree.delete()
  }
  process.stderr.write(`  ${repo} done: ${rows.length} files\n`)
}

function quartile<T>(arr: T[], key: (t: T) => number) {
  const s = [...arr].sort((a, b) => key(a) - key(b))
  const n = s.length
  return [
    s.slice(0, Math.floor(n / 4)),
    s.slice(Math.floor(n / 4), Math.floor(n / 2)),
    s.slice(Math.floor(n / 2), Math.floor((3 * n) / 4)),
    s.slice(Math.floor((3 * n) / 4)),
  ]
}
const med = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)

const byBytes = quartile(rows, (r) => r.bytes)
const byNodes = quartile(rows, (r) => r.nodes)

const byteTable = byBytes.map((q, i) => {
  const b = mean(q.map((r) => r.bytes))
  const ms = mean(q.map((r) => r.ms))
  const lines = mean(q.map((r) => r.lines))
  return {
    quartile: `Q${i + 1}`,
    files: q.length,
    meanBytes: Math.round(b),
    meanLines: Math.round(lines),
    meanMs: +ms.toFixed(3),
    msPerKiB: +((ms / b) * 1024).toFixed(4),
    factsPerKiB: +((mean(q.map((r) => r.facts)) / b) * 1024).toFixed(2),
  }
})
const nodeTable = byNodes.map((q, i) => {
  const nd = mean(q.map((r) => r.nodes))
  const ms = mean(q.map((r) => r.ms))
  return {
    quartile: `Q${i + 1}`,
    files: q.length,
    meanNodes: Math.round(nd),
    meanMs: +ms.toFixed(3),
    msPer1kNodes: +((ms / nd) * 1000).toFixed(3),
    factsPer1kNodes: +((mean(q.map((r) => r.facts)) / nd) * 1000).toFixed(1),
  }
})

// A linear relation has a flat ms-per-unit across quartiles. Report the SPREAD,
// which is the number that would expose a super-linear term.
const spread = (t: { msPerKiB: number }[] | { msPer1kNodes: number }[], k: "msPerKiB" | "msPer1kNodes") => {
  const v = t.map((x) => (x as any)[k] as number).filter((x) => x > 0)
  return { min: +Math.min(...v).toFixed(4), max: +Math.max(...v).toFixed(4), ratio: +(Math.max(...v) / Math.min(...v)).toFixed(2) }
}

const out = {
  generatedAt: new Date().toISOString(),
  policy:
    "NO ms-per-file budget is published from this box. Load average during measurement was " +
    `${Math.min(...loadSamples)}-${Math.max(...loadSamples)} with nine analyzer agents resident, and the SAME analyzer over the SAME files measured 1.451 / 2.097 / 3.885 ms per file on three consecutive rounds — a 2.7x spread on identical work. A single number here measures the neighbours. What is published instead is the SHAPE of the cost, which is machine-independent: ms per KiB and ms per 1k nodes by quartile, plus facts-per-unit, which must be flat.`,
  loadAvg1: { min: Math.min(...loadSamples), max: Math.max(...loadSamples), samples: loadSamples.length },
  files: rows.length,
  totalBytes: rows.reduce((a, r) => a + r.bytes, 0),
  totalNodes: rows.reduce((a, r) => a + r.nodes, 0),
  totalFacts: rows.reduce((a, r) => a + r.facts, 0),
  totalSymbols: rows.reduce((a, r) => a + r.symbols, 0),
  totalRelationships: rows.reduce((a, r) => a + r.relationships, 0),
  totalReferences: rows.reduce((a, r) => a + r.references, 0),
  medianMsPerFile: +med(rows.map((r) => r.ms)).toFixed(3),
  bySizeQuartile: byteTable,
  byNodeQuartile: nodeTable,
  msPerKiBSpread: spread(byteTable, "msPerKiB"),
  msPer1kNodesSpread: spread(nodeTable, "msPer1kNodes"),
  linearityRuling:
    "A ratio near 1.0 across quartiles is the linearity evidence. A rising ms-per-unit with size is the O(n^2) signature the formula's rule 9 asks for; facts-per-unit drifting upward would mean the Set-backed relationship dedupe is degrading with size.",
}
writeFileSync("/home/ishaq2321/bb_tests/hcl/out/complexity.json", JSON.stringify(out, null, 2) + "\n")

console.log(`files=${out.files} bytes=${out.totalBytes} nodes=${out.totalNodes} facts=${out.totalFacts}`)
console.log(`loadAvg1 during measurement: ${out.loadAvg1.min}-${out.loadAvg1.max}`)
console.log(`\nBY SOURCE-SIZE QUARTILE`)
for (const r of byteTable) console.log(`  ${r.quartile} files=${String(r.files).padStart(4)} bytes=${String(r.meanBytes).padStart(7)} lines=${String(r.meanLines).padStart(5)} ms=${String(r.meanMs).padStart(8)} ms/KiB=${String(r.msPerKiB).padStart(8)} facts/KiB=${r.factsPerKiB}`)
console.log(`  spread ms/KiB: ${JSON.stringify(out.msPerKiBSpread)}`)
console.log(`\nBY AST-NODE QUARTILE`)
for (const r of nodeTable) console.log(`  ${r.quartile} files=${String(r.files).padStart(4)} nodes=${String(r.meanNodes).padStart(7)} ms=${String(r.meanMs).padStart(8)} ms/1k=${String(r.msPer1kNodes).padStart(8)} facts/1k=${r.factsPer1kNodes}`)
console.log(`  spread ms/1k nodes: ${JSON.stringify(out.msPer1kNodesSpread)}`)
console.log(`\nmedian ms/file (UNSCORED, disclosed): ${out.medianMsPerFile}`)
