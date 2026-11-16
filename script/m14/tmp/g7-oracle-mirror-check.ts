// G7 oracle-mirror check.
//
// The scoped differential lanes report `MISSING=N` (oracle-only truths) but do not
// persist the per-edge detail, so this probe answers the one question that matters
// before claiming the mirror is right: are any oracle-only edges INTERPOLATION
// reads the mirror invented, or are they pre-existing gaps of other kinds?
//
// Plumbing is copied from the differential itself (parser.parse + analyzer.analyze
// with the repo-relative path), so the instrument is not biased: the same tree, the
// same analyzer entry point, the same normTarget semantics as the harness.
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"
import { RealGroovyAnalyzer } from "../../../src/ast/real-groovy-analyzer"
import { deriveGroovyEdges, deriveTreeEdges } from "../differential"

// The harness compares only the labels a language's truth derives (harness
// filter, groovy arm): extends/implements/instantiates/overrides/calls + now
// uses. Mirroring the same set here is what makes this probe a check of the
// LANE rather than of a function.
const GROOVY_COMPARED_LABELS = new Set(["extends", "implements", "instantiates", "overrides", "calls", "uses"])

const CORPUS = "<corpus-root>/bb_tests/repositories"
const REPOS = ["grails-core", "geb"]
const EXTS = new Set([".groovy", ".gradle", ".gsp"])

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[] = []
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    if (e === ".git" || e === "build" || e === "target" || e === "node_modules") continue
    const p = path.join(dir, e)
    let st: any
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out)
    else if (EXTS.has(path.extname(e))) out.push(p)
  }
  return out
}

const normTarget = (t: string): string => String(t ?? "").replace(/^(this\.|self\.)/, "").replace(/\s/g, "")

async function main(): Promise<void> {
  const parser = await ASTEngine.getParser("groovy" as any)
  const analyzer = new RealGroovyAnalyzer()
  let analyzed = 0
  let parseFail = 0
  let oracleOnly = 0
  let analyzerOnly = 0
  let interpShapedMiss = 0
  let fileLosses = 0
  const samples: string[] = []
  const analyzerSamples: string[] = []
  const byLabelOracle: Record<string, number> = {}
  const byLabelAnalyzer: Record<string, number> = {}
  for (const repo of REPOS) {
    const repoDir = path.join(CORPUS, repo)
    const files = walk(repoDir).sort()
    for (const f of files) {
      const content = readFileSync(f, "utf8")
      const relPath = path.relative(repoDir, f)
      let root: any
      try { root = parser.parse(content).rootNode } catch { parseFail++; continue }
      if (!root) { parseFail++; continue }
      let result: any
      try { result = await analyzer.analyze(root, content, relPath) } catch { parseFail++; continue }
      analyzed++
      const relsAll = (result.relationships ?? []).map((r: any) => ({
        label: String(r.type ?? r.relationshipType ?? ""),
        target: String(r.target ?? r.to ?? ""),
      }))
      const rels = relsAll.filter((r: any) => GROOVY_COMPARED_LABELS.has(r.label))
      const truth = [...deriveTreeEdges(root, "groovy"), ...deriveGroovyEdges(root)]
      const lines = content.split("\n")
      let lost = false
      for (const te of truth) {
        const hit = rels.some((r: any) => r.label === te.label && normTarget(r.target) === normTarget(te.target))
        if (!hit) {
          oracleOnly++
          lost = true
          // does an interpolation form naming this target occur anywhere in the file?
          const esc = String(te.target).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          const rx = new RegExp(`\\$\\{[^}]*\\b${esc}\\b|\\$${esc}\\b`)
          const onInterpLine = lines.some((l) => rx.test(l))
          if (onInterpLine) interpShapedMiss++
          if (samples.length < 80) {
            samples.push(`ORACLE-ONLY ${te.label} -> ${te.target} | ${repo}/${relPath}${onInterpLine ? "  [INTERPOLATION-SHAPED TARGET IN FILE]" : ""}`)
          }
          byLabelOracle[te.label] = (byLabelOracle[te.label] ?? 0) + 1
        }
      }
      if (lost) fileLosses++
      for (const r of rels) {
        const hit = truth.some((te) => te.label === r.label && (normTarget(te.target) === normTarget(r.target) || String(te.target).includes(normTarget(r.target))))
        if (!hit) {
          analyzerOnly++
          byLabelAnalyzer[r.label] = (byLabelAnalyzer[r.label] ?? 0) + 1
          if (analyzerSamples.length < 60) analyzerSamples.push(`ANALYZER-ONLY ${r.label} -> ${r.target} | ${repo}/${relPath}`)
        }
      }
    }
  }
  console.log(`files analyzed      : ${analyzed} (parse/analyze failures ${parseFail})`)
  console.log(`files with a loss   : ${fileLosses}`)
  console.log(`oracle-only truths  : ${oracleOnly}`)
  console.log(`  of which an interpolation form naming that target occurs in the file: ${interpShapedMiss}`)
  console.log(`analyzer-only edges : ${analyzerOnly}`)
  console.log(`oracle-only by label : ${JSON.stringify(byLabelOracle)}`)
  console.log(`analyzer-only by label: ${JSON.stringify(byLabelAnalyzer)}`)
  console.log(`--- first ${samples.length} oracle-only samples ---`)
  for (const s of samples) console.log(s)
  console.log(`--- first ${analyzerSamples.length} analyzer-only samples ---`)
  for (const s of analyzerSamples) console.log(s)
}
main().catch((e) => { console.error(e); process.exit(1) })
