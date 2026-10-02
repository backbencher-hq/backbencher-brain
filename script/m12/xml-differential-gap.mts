/**
 * M18/M22 — WHERE THE XML DIFFERENTIAL DISAGREES, BY CONSTRUCT CLASS.
 *
 * The lane's differential is pinned to `grails-core`, one corpus of six. The
 * review records the other five as "oracle coverage rather than analyzer
 * defects" — and that was a BELIEF supported by a shape (the oracle's xml branch
 * pushes four `contains` sites and none of them concern a DTD declaration), not a
 * measurement. A belief about where a defect is not the same as a measurement of
 * it, and the two pull in different directions: if any class is genuinely the
 * ANALYZER being wrong, then "widen the oracle" is the wrong next move and this
 * script would have been the thing that caught it.
 *
 * So it measures. For every file it runs the analyzer and the independent oracle,
 * takes the `contains` edges on BOTH sides, and buckets each unexplained
 * analyzer edge by the ROLE that produced it — the analyzer's own statement of
 * which rule emitted the edge. That is the classification that matters, because
 * a role is a rule and a rule can be right or wrong; the target's spelling is
 * not.
 *
 * Three outcomes per class, and they are distinguishable:
 *
 *   - the oracle derives the class at all → disagreement is a real signal and the
 *     two implementations disagree about a fact;
 *   - the oracle never derives it → a coverage hole in the ORACLE, and the fix
 *     is to teach the oracle, not to change the analyzer;
 *   - the oracle derives it and the analyzer's edge is malformed (no target, no
 *     owner) → an analyzer defect regardless of coverage.
 *
 * Usage:
 *   npx tsx script/m12/xml-differential-gap.mts [--repos DIR] [--json] [--sample N]
 *
 * Read-only. It writes nothing: the point is to decide what to build, and a
 * measurement that edits the thing it measures cannot be used to choose.
 */
import * as fs from "fs"
import * as path from "path"
import { fileURLToPath } from "url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "..", "..")
const DEFAULT_REPOS = process.env.XML_CORPUS_ROOT ?? "$HOME/fixtures/xml/repos"
const MAX_BYTES = Number(process.env.XML_MAX_BYTES ?? 2_000_000)
const EXTS = new Set([".xml", ".xsd", ".dtd", ".xsl", ".xslt", ".svg", ".rng"])

function collect(dir: string, out: string[]): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name === ".git") continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) collect(full, out)
    else if (EXTS.has(path.extname(e.name).toLowerCase())) out.push(full)
  }
}

interface Bucket {
  unexplained: number
  corroborated: number
  files: number
  examples: string[]
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const ri = argv.indexOf("--repos")
  const reposRoot = ri >= 0 ? argv[ri + 1] : DEFAULT_REPOS
  const si = argv.indexOf("--sample")
  const sampleLimit = si >= 0 ? Number(argv[si + 1]) : 6
  const asJson = argv.includes("--json")

  if (!fs.existsSync(reposRoot)) {
    console.error(`xml-differential-gap: corpus root absent: ${reposRoot}`)
    process.exit(1)
  }

  const wts: any = await import("web-tree-sitter")
  const Parser = wts.Parser ?? wts.default?.Parser ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await Parser.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-xml.wasm")))
  const { decodeSourceText } = await import(path.join(ROOT, "src/util/source-text"))
  const { RealXmlAnalyzer } = await import(path.join(ROOT, "src/ast/real-xml-analyzer"))
  const { deriveTreeEdges } = await import(path.join(ROOT, "script/m14/differential"))

  // Per corpus directory, so the pinned/measured split stays visible.
  const corpora = fs
    .readdirSync(reposRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()

  const parser = new Parser()
  parser.setLanguage(grammar)
  const analyzer: any = new RealXmlAnalyzer()

  const report: Record<string, Record<string, Bucket>> = {}
  const perCorpus: Record<string, { files: number; truth: number; covered: number; unexplained: number; oracleEdges: number }> = {}

  for (const corpus of corpora) {
    const files: string[] = []
    collect(path.join(reposRoot, corpus), files)
    files.sort()
    const buckets: Record<string, Bucket> = {}
    const tally = { files: 0, truth: 0, covered: 0, unexplained: 0, oracleEdges: 0 }

    for (const file of files) {
      let content: string, root: any
      try {
        if (fs.statSync(file).size > MAX_BYTES) continue
        content = decodeSourceText(fs.readFileSync(file)).text
        root = parser.parse(content)?.rootNode
      } catch {
        continue
      }
      if (!root) continue

      let result: any, truth: any[]
      try {
        result = await analyzer.analyze(root, content, path.relative(reposRoot, file))
        truth = deriveTreeEdges(root, "xml") as any[]
      } catch {
        continue
      }
      tally.files++

      const oracle = new Set(truth.filter((t) => t.label === "contains").map((t) => `${t.from}\u0000${t.target}`))
      tally.oracleEdges += oracle.size
      tally.truth += oracle.size

      for (const e of result.relationships ?? []) {
        if (e.type !== "contains") continue
        const key = `${e.source}\u0000${e.target}`
        const role = String((e.metadata as any)?.role ?? "(no role)")
        if (!buckets[role]) buckets[role] = { unexplained: 0, corroborated: 0, files: 0, examples: [] }
        const b = buckets[role]
        if (oracle.has(key)) {
          tally.covered++
          b.corroborated++
        } else {
          tally.unexplained++
          b.unexplained++
          if (b.examples.length < sampleLimit) {
            b.examples.push(`${path.relative(reposRoot, file)}  contains ${e.source} -> ${e.target}`)
          }
        }
      }
    }

    for (const b of Object.values(buckets)) b.files = b.unexplained > 0 ? b.files + 1 : b.files
    report[corpus] = buckets
    perCorpus[corpus] = tally
  }

  if (asJson) {
    console.log(JSON.stringify({ reposRoot, perCorpus, byClass: report }, null, 2))
    return
  }

  console.log(`xml differential gap — ${reposRoot}`)
  console.log(`  ${"corpus".padEnd(12)} ${"files".padStart(6)} ${"oracle".padStart(8)} ${"corrob.".padStart(8)} ${"unexpl.".padStart(8)}  share unexplained`)
  for (const [corpus, t] of Object.entries(perCorpus)) {
    const share = t.oracleEdges > 0 ? (100 * t.unexplained) / (t.covered + t.unexplained) : 0
    console.log(
      `  ${corpus.padEnd(12)} ${String(t.files).padStart(6)} ${String(t.oracleEdges).padStart(8)} ${String(t.covered).padStart(8)} ${String(t.unexplained).padStart(8)}  ${share.toFixed(1)}%`,
    )
  }

  // Aggregate the classes across every corpus, worst first — this is the table
  // that decides where the work goes.
  const agg: Record<string, Bucket> = {}
  for (const buckets of Object.values(report)) {
    for (const [role, b] of Object.entries(buckets)) {
      if (!agg[role]) agg[role] = { unexplained: 0, corroborated: 0, files: 0, examples: [] }
      agg[role].unexplained += b.unexplained
      agg[role].corroborated += b.corroborated
      if (b.unexplained > 0 && agg[role].examples.length < sampleLimit) {
        agg[role].examples.push(...b.examples.slice(0, sampleLimit - agg[role].examples.length))
      }
    }
  }
  const totalUn = Object.values(agg).reduce((a, b) => a + b.unexplained, 0)
  const totalCo = Object.values(agg).reduce((a, b) => a + b.corroborated, 0)
  console.log(`\n  every "contains" edge, bucketed by the RULE that emitted it — ${totalCo} corroborated, ${totalUn} unexplained\n`)
  const rows = Object.entries(agg).sort((a, b) => b[1].unexplained - a[1].unexplained)
  for (const [role, b] of rows) {
    if (b.unexplained === 0) continue
    const pct = totalUn > 0 ? ((100 * b.unexplained) / totalUn).toFixed(1) : "0"
    console.log(`  ${String(b.unexplained).padStart(7)}  ${pct.padStart(5)}%  ${role}   (${b.corroborated} corroborated)`)
    for (const ex of b.examples.slice(0, 2)) console.log(`            ${ex}`)
  }
  const clean = rows.filter(([, b]) => b.unexplained === 0).map(([r]) => r)
  if (clean.length) console.log(`\n  classes the ORACLE corroborates fully (oracle coverage exists, no disagreement): ${clean.join(", ")}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})