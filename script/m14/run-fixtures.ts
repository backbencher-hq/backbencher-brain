/**
 * M14.0.F3 — Adversarial Fixture Runner
 *
 * Runs validation/m14/fixtures/<lang>/*.{src} through the REAL analyzer
 * (same lazy imports as engine.ts, same wasm grammars) and compares output
 * against expectation files authored BEFORE observing analyzer behavior.
 *
 * Expectation matching semantics:
 *   expectSymbols / expectRelationships : each entry must match >=1 actual item.
 *       An entry matches when EVERY specified constraint field matches
 *       (unspecified fields are wildcards). Extra actual items are fine.
 *   forbidSymbols / forbidRelationships : NO actual item may match the entry.
 *   Relationship constraints: type, from, target, confidenceMin, confidenceMax,
 *       meta.<key> (e.g. "meta.relationshipType": "implements").
 *   Symbol constraints: name, kind.
 *
 * CLI: bun run script/m14/run-fixtures.ts [--lang java,groovy]
 */
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve(__dirname, "..", "..")
const FIXTURES_DIR = path.join(ROOT, "validation", "m14", "fixtures")

const LANGS: Record<string, { wasm: string; analyzerFile: string; className: string; ext: string }> = {
  java: { wasm: "tree-sitter-java.wasm", analyzerFile: "real-java-analyzer", className: "RealJavaAnalyzer", ext: "java" },
  groovy: { wasm: "tree-sitter-groovy.wasm", analyzerFile: "real-groovy-analyzer", className: "RealGroovyAnalyzer", ext: "groovy" },
  kotlin: { wasm: "tree-sitter-kotlin.wasm", analyzerFile: "real-kotlin-analyzer", className: "RealKotlinAnalyzer", ext: "kt" },
  scala: { wasm: "tree-sitter-scala.wasm", analyzerFile: "real-scala-analyzer", className: "RealScalaAnalyzer", ext: "scala" },
}

interface Entry { [k: string]: any }

function matchConstraints(actual: Entry, want: Entry): boolean {
  for (const [k, v] of Object.entries(want)) {
    if (k === "confidenceMin") {
      if (!(typeof actual.confidence === "number" && actual.confidence >= v)) return false
    } else if (k === "confidenceMax") {
      if (!(typeof actual.confidence === "number" && actual.confidence <= v)) return false
    } else if (k.endsWith("EndsWith")) {
      const field = k.slice(0, -"EndsWith".length)
      const aliases: Record<string, string[]> = { target: ["target", "to", "toSymbol"], from: ["from", "source", "fromSymbol"] }
      const vals = (aliases[field] ?? [field]).map(a => actual[a]).filter(x => typeof x === "string")
      if (!vals.some(x => x.endsWith(v))) return false
    } else if (k.startsWith("meta.")) {
      const mk = k.slice(5)
      if ((actual.metadata ?? {})[mk] !== v) return false
    } else if (actual[k] !== v) {
      // relationship field aliases
      const aliases: Record<string, string[]> = {
        from: ["from", "source", "fromSymbol"],
        target: ["target", "to", "toSymbol"],
        type: ["type", "relationshipType"],
      }
      const alt = aliases[k]
      if (alt && alt.some(a => actual[a] === v)) continue
      return false
    }
  }
  return true
}

function normRel(r: Entry): Entry {
  return {
    ...r,
    from: r.from ?? r.source ?? r.fromSymbol,
    target: r.target ?? r.to ?? r.toSymbol,
    type: r.type ?? r.relationshipType,
  }
}

async function runLang(lang: string): Promise<{ pass: number; fail: number; details: any[] }> {
  const cfg = LANGS[lang]
  const dir = path.join(FIXTURES_DIR, lang)
  if (!fs.existsSync(dir)) return { pass: 0, fail: 0, details: [{ fixture: "(none)", ok: true }] }

  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", cfg.wasm)))
  const parser = new ParserClass()
  parser.setLanguage(grammar)
  const mod: any = await import(`../../src/ast/${cfg.analyzerFile}`)
  const analyzer = new mod[cfg.className]()

  const sources = fs.readdirSync(dir).filter(f => f.endsWith("." + cfg.ext))
  let pass = 0, fail = 0
  const details: any[] = []
  for (const src of sources.sort()) {
    const base = src.slice(0, -(cfg.ext.length + 1))
    const expPath = path.join(dir, `${base}.expectation.json`)
    if (!fs.existsSync(expPath)) { fail++; details.push({ fixture: `${lang}/${base}`, ok: false, reason: "missing expectation file" }); continue }
    const exp = JSON.parse(fs.readFileSync(expPath, "utf8"))

    const content = fs.readFileSync(path.join(dir, src), "utf8")
    const tree = parser.parse(content)
    const result = await analyzer.analyze(tree.rootNode, content, `fixtures/${lang}/${src}`)
    const symbols: Entry[] = result.symbols ?? []
    const rels: Entry[] = (result.relationships ?? []).map(normRel)

    const problems: string[] = []

    for (const want of exp.expectSymbols ?? []) {
      if (!symbols.some(s => matchConstraints(s, want))) {
        problems.push(`expected symbol not found: ${JSON.stringify(want)}; got: ${symbols.map((s: any) => s.name + ":" + s.kind).slice(0, 20).join(", ")}`)
      }
    }
    for (const want of exp.forbidSymbols ?? []) {
      const hit = symbols.find(s => matchConstraints(s, want))
      if (hit) problems.push(`forbidden symbol present: ${JSON.stringify(want)} (found ${hit.name}:${hit.kind})`)
    }
    for (const want of exp.expectRelationships ?? []) {
      if (!rels.some(r => matchConstraints(r, want))) {
        problems.push(`expected relationship not found: ${JSON.stringify(want)}; got: ${rels.map((r: any) => r.type + "[" + r.from + "->" + r.target + "]" + (r.confidence != null ? "@" + r.confidence : "")).slice(0, 30).join("; ")}`)
      }
    }
    for (const want of exp.forbidRelationships ?? []) {
      const hit = rels.find(r => matchConstraints(r, want))
      if (hit) problems.push(`forbidden relationship present: ${JSON.stringify(want)} (found ${hit.type}[${hit.from}->${hit.target}]${hit.confidence != null ? "@" + hit.confidence : ""})`)
    }

    if (problems.length === 0) pass++
    else fail++
    details.push({ fixture: `${lang}/${base}`, ok: problems.length === 0, problems })
  }
  return { pass, fail, details }
}

async function main() {
  const argLangs = process.argv.includes("--lang")
    ? process.argv[process.argv.indexOf("--lang") + 1].split(",")
    : Object.keys(LANGS)

  const allDetails: any[] = []
  const summary: Record<string, { pass: number; fail: number }> = {}
  for (const lang of argLangs) {
    if (!LANGS[lang]) throw new Error(`unknown language ${lang}`)
    const r = await runLang(lang)
    summary[lang] = { pass: r.pass, fail: r.fail }
    allDetails.push(...r.details)
  }

  for (const d of allDetails) {
    console.log(`${d.ok ? "PASS" : "FAIL"}  ${d.fixture}`)
    if (!d.ok) for (const p of d.problems ?? [d.reason]) console.log(`      - ${p.split("; got:")[0]}`)
  }
  console.log("\nsummary:", JSON.stringify(summary))

  // evidence via harness (F2)
  const { emitEvidence } = await import("./evidence-harness")
  const checks = Object.entries(summary).map(([lang, s]) => ({
    id: `fixtures-${lang}`,
    description: `${lang} adversarial fixtures`,
    status: s.fail === 0 ? ("pass" as const) : ("fail" as const),
    detail: `${s.pass}/${s.pass + s.fail} fixtures pass`,
  }))
  emitEvidence({
    issueId: "M14.0.F3",
    title: "Adversarial fixture corpus",
    claimLevel: "L1",
    layers: ["fixtures"],
    checks,
    limitations: [
      { description: "JVM languages covered in this emission; other languages gain fixtures during their waves (>=5 each per F3 acceptance)" },
      { description: "fixture failures document CURRENT analyzer defects honestly; they convert to passes during wave fixes, never by editing expectations to match buggy output" },
    ],
    data: { summary, details: allDetails },
  })

  // improvement-forcing gate: failing-fixture counts must never grow
  const BASELINE = path.join(ROOT, "validation", "m14", "fixture-baseline.json")
  const currentFail: Record<string, number> = {}
  for (const [l, s] of Object.entries(summary)) currentFail[l] = s.fail
  const updateBaseline = process.argv.includes("--update-baseline")
  if (updateBaseline) {
    fs.writeFileSync(BASELINE, JSON.stringify(currentFail, null, 2) + "\n")
    console.log("fixture baseline updated:", currentFail)
  } else if (fs.existsSync(BASELINE)) {
    const base = JSON.parse(fs.readFileSync(BASELINE, "utf8"))
    const regressions = Object.keys(currentFail).filter(l => base[l] !== undefined && currentFail[l] > base[l])
    for (const r of regressions) console.error(`FIXTURE REGRESSION ${r}: ${base[r]} -> ${currentFail[r]} failures`)
    if (regressions.length) process.exit(4)
    console.log("fixture baseline gate: no regressions")
  }
  const totalFail = Object.values(summary).reduce((a, s) => a + s.fail, 0)
  console.log(totalFail > 0 ? `\n${totalFail} fixture(s) FAIL — these are honest defect findings, not harness errors` : "\nall fixtures pass")
  process.exit(0) // F3 gate: fixtures RUN successfully; failures are wave work items, tracked via baseline
}

main().catch(e => { console.error(e); process.exit(1) })
