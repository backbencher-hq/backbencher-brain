/**
 * HCL COMPLEXITY vs ITS SIBLING FAMILY — the lane formula's rule 9 comparison.
 *
 * Rule 9 asks for the analyzer's cost normalised per 1k AST nodes, in a fixed
 * size band, against a SIBLING language in the same family. HCL's family is
 * data/config, so the siblings are JSON, YAML and XML: all four are declarative
 * container formats with no call graph and no type hierarchy, which is exactly
 * the shape HCL sits in. The family members are compared on the SAME load and in
 * the SAME node band, and the load is recorded because a comparison taken while
 * nine agents saturate the box is only meaningful relatively.
 *
 * A FIXED SIZE BAND is the point: comparing a whole-corpus average against
 * another whole-corpus average compares the corpora, not the analyzers. Each
 * family member is therefore measured on files in its own corpus restricted to
 * the same node-count band, so the quartile being timed is the same shape.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { ASTEngine } from "<corpus-root>/backbencher-brain/src/ast/engine"
import { RealHclAnalyzer } from "<corpus-root>/backbencher-brain/src/ast/real-hcl-analyzer"
import { RealJsonAnalyzer } from "<corpus-root>/backbencher-brain/src/ast/real-json-analyzer"
import { RealYamlAnalyzer } from "<corpus-root>/backbencher-brain/src/ast/real-yaml-analyzer"

const OUT = "<corpus-root>/bb_tests/hcl/out"

/** The band: 40–200 AST nodes per file. Big enough to amortise fixed
 *  per-file overhead, small enough that a single pathological file cannot
 *  dominate a quartile. Every family member is timed inside this band. */
const BAND = [40, 200] as const
const PER_MEMBER = 240
const ROUNDS = 3

const SOURCES: Record<string, { roots: string[]; ext: RegExp; analyzer: any; label: string }> = {
  hcl: {
    label: "hcl",
    roots: ["<corpus-root>/bb_tests/hcl/repos/terraform", "<corpus-root>/bb_tests/hcl/repos/tf-aws-components"],
    ext: /\.(tf|tfvars|hcl|tofu)$/i,
    analyzer: new RealHclAnalyzer(),
  },
  json: {
    // terraform's own `.terraform.json` state files (417 tracked) plus kong's
    // fixtures: both are real declarative documents, neither is a package manifest
    // dressed up as a corpus.
    label: "json",
    roots: ["<corpus-root>/bb_tests/hcl/repos/terraform", "<corpus-root>/bb_tests/repositories/kong"],
    ext: /\.json$/i,
    analyzer: new RealJsonAnalyzer(),
  },
  yaml: {
    label: "yaml",
    roots: ["<corpus-root>/bb_tests/repos/tf-aws-components", "<corpus-root>/bb_tests/hcl/repos/tf-aws-components"],
    ext: /\.(ya?ml)$/i,
    analyzer: new RealYamlAnalyzer(),
  },
}

function* walkFiles(dir: string, ext: RegExp): Generator<string> {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const e of entries) {
    if (e === ".git" || e === "node_modules") continue
    const p = join(dir, e)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) yield* walkFiles(p, ext)
    else if (ext.test(e)) yield p
  }
}

const loadavg = () => Number(readFileSync("/proc/loadavg", "utf8").split(" ")[0])

interface Member {
  label: string
  files: number
  nodes: number
  meanNodes: number
  bestMsPer1kNodes: number
  rounds: number[]
  facts: number
}

const results: Member[] = []

for (const [key, cfg] of Object.entries(SOURCES)) {
  const parser = await ASTEngine.getParser(key === "yaml" ? "yaml" : key)
  const inBand: { src: string; tree: any; nodes: number }[] = []
  for (const root of cfg.roots) {
    if (inBand.length >= PER_MEMBER) break
    for (const f of walkFiles(root, cfg.ext)) {
      if (inBand.length >= PER_MEMBER) break
      let src: string
      try {
        src = readFileSync(f, "utf8")
      } catch {
        continue
      }
      if (src.length > 400_000 || src.length < 40) continue
      let tree: any
      try {
        tree = parser.parse(src)
      } catch {
        continue
      }
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
      if (nodes < BAND[0] || nodes > BAND[1]) {
        tree.delete?.()
        continue
      }
      inBand.push({ src, tree, nodes })
    }
  }
  if (inBand.length < 20) {
    process.stderr.write(`  ${cfg.label}: only ${inBand.length} files in the ${BAND[0]}-${BAND[1]} node band — skipped\n`)
    continue
  }
  const totalNodes = inBand.reduce((a, r) => a + r.nodes, 0)
  const rounds: number[] = []
  let facts = 0
  for (let round = 0; round < ROUNDS; round++) {
    const t0 = performance.now()
    facts = 0
    for (const r of inBand) {
      const res = cfg.analyzer.analyze(r.tree.rootNode, r.src, "x")
      facts += res.symbols.length + res.relationships.length
    }
    const ms = performance.now() - t0
    rounds.push(+((ms / totalNodes) * 1000).toFixed(3))
  }
  // The MINIMUM round, not the mean: with nine agents on the box every round is
  // inflated by contention and only the least-contended one approximates the
  // analyzer's own cost. Reporting the mean would report the neighbours.
  results.push({
    label: cfg.label,
    files: inBand.length,
    nodes: totalNodes,
    meanNodes: Math.round(totalNodes / inBand.length),
    bestMsPer1kNodes: Math.min(...rounds),
    rounds,
    facts,
  })
  for (const r of inBand) r.tree.delete?.()
  process.stderr.write(`  ${cfg.label}: ${inBand.length} files, ${totalNodes} nodes, ms/1k = ${rounds.join(" / ")} (best ${Math.min(...rounds)})\n`)
}

results.sort((a, b) => a.bestMsPer1kNodes - b.bestMsPer1kNodes)
const out = {
  generatedAt: new Date().toISOString(),
  policy: `Sibling-family comparison in a FIXED node band (${BAND[0]}-${BAND[1]} AST nodes per file, ${PER_MEMBER} files per member, ${ROUNDS} rounds). A whole-corpus average compared with another whole-corpus average compares the corpora, not the analyzers. The MINIMUM round is reported, not the mean: with nine analyzer agents resident every round is inflated by contention and only the least-contended one approximates the analyzer's own cost. This is a RELATIVE comparison; no absolute budget is claimed.`,
  family: "data/config — declarative container formats with no call graph and no type hierarchy",
  nodeBand: BAND,
  filesPerMember: PER_MEMBER,
  loadAvg1AtEnd: loadavg(),
  results,
  ranking: results.map((r) => `${r.label} ${r.bestMsPer1kNodes} ms/1k nodes`),
  hclVersusCheapestSibling: results.length >= 2 ? +(results[results.length - 1].bestMsPer1kNodes / results[0].bestMsPer1kNodes).toFixed(2) : null,
}
writeFileSync(`${OUT}/sibling-complexity.json`, JSON.stringify(out, null, 2) + "\n")

console.log(`\nnode band ${BAND[0]}-${BAND[1]}, ${PER_MEMBER} files/member, best of ${ROUNDS} rounds, loadavg1 ${out.loadAvg1AtEnd}`)
for (const r of results) console.log(`  ${r.label.padEnd(6)} files=${String(r.files).padStart(4)} meanNodes=${String(r.meanNodes).padStart(4)} ms/1k=${String(r.bestMsPer1kNodes).padStart(8)}  (rounds ${r.rounds.join(" / ")})  facts=${r.facts}`)
console.log(`\nhcl vs the most expensive sibling: ${out.hclVersusCheapestSibling}x`)
