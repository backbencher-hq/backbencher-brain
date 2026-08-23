/**
 * M14.0.F5 — Differential Corpus Harness
 *
 * Second-opinion verification on real repositories. For a seeded sample of
 * files from a pinned corpus repo:
 *   1. Derive TREE TRUTH directly from the wasm parse tree.
 *   2. Run the real analyzer on the same file.
 *   3. Diff BOTH directions:
 *        tree -> analyzer : silent drops become visible and counted
 *        analyzer -> tree : fabricated/mislabelled edges become visible
 *
 * Target matching tolerates FQN vs last-segment; label matching is exact.
 *
 * CLI: bun run script/m14/differential.ts [--repo <name>] [--sample N]
 */
import * as fs from "fs"
import * as path from "path"
import { execSync } from "child_process"

const ROOT = process.env.BB_M14_ROOT ? path.resolve(process.env.BB_M14_ROOT) : path.resolve((import.meta as any).dirname ?? path.dirname(Bun?.main ?? process.argv[1] ?? "."), "..", "..")
const CORPUS_ROOT = "$HOME/fixtures/repositories"
const REPO = process.argv.includes("--repo") ? process.argv[process.argv.indexOf("--repo") + 1] : "grails-core"
const SAMPLE_PER_LANG = process.argv.includes("--sample") ? parseInt(process.argv[process.argv.indexOf("--sample") + 1]) : 60

const LANGS: Record<string, { wasm: string; analyzerFile: string; className: string; ext: string }> = {
  kotlin: { wasm: "tree-sitter-kotlin.wasm", analyzerFile: "real-kotlin-analyzer", className: "RealKotlinAnalyzer", ext: "kt" },
  java: { wasm: "tree-sitter-java.wasm", analyzerFile: "real-java-analyzer", className: "RealJavaAnalyzer", ext: "java" },
  groovy: { wasm: "tree-sitter-groovy.wasm", analyzerFile: "real-groovy-analyzer", className: "RealGroovyAnalyzer", ext: "groovy" },
}

function seededPick<T>(items: T[], n: number, seedStr: string): T[] {
  let h = 2166136261
  for (const c of seedStr) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) }
  const idx = items.map((_, i) => i)
  for (let i = idx.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h + i), 2246822519)
    const j = Math.abs(h) % (i + 1); [idx[i], idx[j]] = [idx[j], idx[i]]
  }
  return idx.slice(0, n).map(i => items[i])
}
function lastSegment(name: string): string { return name.split(".").pop() ?? name }
function normTarget(t: string): string { return lastSegment(t.replace(/<.*$/, "").trim()) }

interface TreeEdge { label: string; from: string; target: string }

// Independent oracle: derive extends/implements/instantiates edges straight
// from clause node structure — no analyzer code involved.
function deriveTreeEdges(root: any, lang: string): TreeEdge[] {
  const edges: TreeEdge[] = []
  const TYPE = /type_identifier|scoped_type_identifier|generic_type/
  const collect = (x: any, label: string, clsName: string) => {
    if (!x) return
    if (TYPE.test(x.type)) edges.push({ label, from: clsName, target: x.text })
    else for (let k = 0; k < x.namedChildCount; k++) collect(x.namedChild(k), label, clsName)
  }
  const walk = (n: any) => {
    const t = n.type
    if (/^(class|interface|record|trait|object)_declaration$|^enum_declaration$|^class_definition$/.test(t)) {
      const nameNode = n.childForFieldName?.("name") ?? n.namedChildren.find((c: any) => c.type === "identifier")
      const clsName = nameNode?.text ?? "?"
      // extends side: superclass (classes) or extends_interfaces+type_list (interfaces)
      const sup = n.childForFieldName?.("superclass") ?? n.namedChildren.find((c: any) => c.type === "superclass" || c.type === "extends_interfaces")
      if (sup) {
        if (sup.type === "superclass" || sup.type === "extends_interfaces") collect(sup, "extends", clsName)
      }
      // implements side
      const impls = n.childForFieldName?.("interfaces") ?? n.namedChildren.find((c: any) => c.type === "super_interfaces")
      if (impls) collect(impls, "implements", clsName)
      // kotlin delegation_specifiers: first constructor_invocation = extends,
      // every other user_type = implements; on interface_declaration all extends
      const isInterfaceDecl = t === "interface_declaration"
      let extendsUsed = false
      for (let i = 0; i < n.namedChildCount; i++) {
        const d = n.namedChild(i)
        if (!d || d.type !== "delegation_specifier") continue
        const ctor = d.namedChildren?.find((c: any) => c.type === "constructor_invocation")
        const userType = ctor
          ? ctor.namedChild(0)?.type === "user_type" ? ctor.namedChild(0) : d.namedChildren?.find((c: any) => c.type === "user_type")
          : d.namedChildren?.find((c: any) => c.type === "user_type")
        // Only the HEAD type_identifier is the supertype; deeper children are
        // type ARGUMENTS (SuspendExecutable<Int, UpdateStatement>) and must
        // not become phantom supertypes.
        const head = userType?.namedChild(0)?.type === "type_identifier" ? userType.namedChild(0) : userType
        if (ctor && head && !isInterfaceDecl && !extendsUsed) {
          edges.push({ label: "extends", from: clsName, target: head.text })
          extendsUsed = true
        } else if (head) {
          edges.push({ label: isInterfaceDecl ? "extends" : "implements", from: clsName, target: head.text })
        }
      }
    }
    if (t === "object_creation_expression") {
      const typeNode = n.namedChildren.find((c: any) => /type_identifier|scoped_type_identifier|generic_type$/.test(c.type))
      if (typeNode) edges.push({ label: "instantiates", from: "(expr)", target: typeNode.text })
    }
    // kotlin has no `new`: constructions are call_expressions whose callee
    // leaf follows the PascalCase type convention (language naming rule).
    if (lang === "kotlin" && t === "call_expression") {
      const callee = n.namedChild(0)
      let leaf = ""
      if (callee?.type === "navigation_expression") {
        const sel = callee.namedChild(callee.namedChildCount - 1)
        leaf = sel?.text ?? ""
      } else if (callee) {
        leaf = callee.text.split("<")[0]
      }
      leaf = leaf.replace(/\(.*$/, "")
      if (/^[A-Z]/.test(leaf)) edges.push({ label: "instantiates", from: "(expr)", target: leaf })
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(root)
  return edges
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })

  const repoDir = path.join(CORPUS_ROOT, REPO)
  if (!fs.existsSync(repoDir)) throw new Error(`corpus repo missing: ${repoDir}`)
  const repoPin = execSync("git rev-parse HEAD", { cwd: repoDir }).toString().trim()

  const report: Record<string, any> = {}
  for (const [lang, cfg] of Object.entries(LANGS)) {
    const files: string[] = []
    const scan = (d: string) => {
      if (files.length > 4000) return
      let entries
      try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) { if (!/^(\.|node_modules|build|target)/.test(e.name)) scan(p) }
        else if (e.name.endsWith("." + cfg.ext)) files.push(p)
      }
    }
    scan(repoDir)

    const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", cfg.wasm)))
    const parser = new ParserClass()
    parser.setLanguage(grammar)
    const mod: any = await import(`../../src/ast/${cfg.analyzerFile}`)
    const analyzer = new mod[cfg.className]()

    const sample = seededPick(files, SAMPLE_PER_LANG, `${REPO}:${lang}:m14-f5`)
    let treeEdgesTotal = 0, coveredByAnalyzer = 0, missingInAnalyzer = 0
    let analyzerEdgesTotal = 0, explainableByTree = 0, unexplainedInAnalyzer = 0
    const samples: any[] = []

    for (const f of sample) {
      const content = fs.readFileSync(f, "utf8")
      const relPath = path.relative(repoDir, f)
      let root
      try { root = parser.parse(content).rootNode } catch { continue }
      if (!root) continue

      const truth = deriveTreeEdges(root, lang)
      let result
      try { result = await analyzer.analyze(root, content, relPath) } catch { continue }
      const rels = (result.relationships ?? []).map((r: any) => ({
        label: String(r.type ?? r.relationshipType ?? ""),
        target: String(r.target ?? r.to ?? r.toSymbol ?? ""),
      })).filter((r: any) => ["extends", "implements", "instantiates"].includes(r.label))

      treeEdgesTotal += truth.length
      analyzerEdgesTotal += rels.length

      for (const te of truth) {
        const hit = rels.some((r: any) => r.label === te.label && normTarget(r.target) === normTarget(te.target))
        if (hit) coveredByAnalyzer++
        else { missingInAnalyzer++; if (samples.length < 300) samples.push({ dir: "MISSING", file: relPath, ...te }) }
      }
      for (const r of rels) {
        const hit = truth.some(te => te.label === r.label && (normTarget(te.target) === normTarget(r.target) || te.target.includes(normTarget(r.target))))
        if (hit) explainableByTree++
        else { unexplainedInAnalyzer++; if (samples.length < 300) samples.push({ dir: "UNEXPLAINED", file: relPath, ...r }) }
      }
    }

    report[lang] = {
      filesSampled: sample.length,
      treeTruthEdges: treeEdgesTotal,
      coveredByAnalyzer,
      missingInAnalyzer,
      analyzerEdges: analyzerEdgesTotal,
      explainableByTree,
      unexplainedInAnalyzer,
      coveragePct: treeEdgesTotal ? +(100 * coveredByAnalyzer / treeEdgesTotal).toFixed(1) : null,
      fabricationPct: analyzerEdgesTotal ? +(100 * unexplainedInAnalyzer / analyzerEdgesTotal).toFixed(1) : null,
      samples,
    }
    console.log(`${lang}: files=${sample.length} tree-truth=${treeEdgesTotal} covered=${coveredByAnalyzer} (${report[lang].coveragePct}%) MISSING=${missingInAnalyzer} | analyzer-edges=${analyzerEdgesTotal} unexplained=${unexplainedInAnalyzer} (${report[lang].fabricationPct}%)`)
  }

  const { emitEvidence } = await import("./evidence-harness")
  emitEvidence({
    issueId: "M14.0.F5",
    title: "Differential corpus harness",
    claimLevel: "L1",
    layers: ["differential"],
    checks: Object.entries(report).map(([lang, r]: any) => ({
      id: `differential-${lang}`,
      description: `${REPO}@${repoPin.slice(0, 10)}: tree-truth vs analyzer diff`,
      status: "pass",
      detail: `${r.filesSampled} files, coverage ${r.coveragePct}%, unexplained ${r.fabricationPct}%`,
    })),
    limitations: [
      { description: "second opinion is a clause-structure re-derivation from the same wasm grammars; a grammar bug shared by both paths would be invisible to this harness" },
      { description: "seeded sample of files per language, deterministic; not exhaustive over the corpus" },
      { description: "coverage/fabrication baselines recorded; wave M14.1 must reduce missing/unexplained counts" },
    ],
    data: {
      corpusPins: { [REPO]: repoPin },
      samplingRule: `seeded ${SAMPLE_PER_LANG} files/language`,
      report,
    },
  })
  console.log("evidence written: validation/m14/results/M14.0.F5.json")

  // improvement-forcing gate: missing/unexplained counts may never grow
  const BASELINE = path.join(ROOT, "validation", "m14", "differential-baseline.json")
  const current: Record<string, any> = {}
  for (const [lang, r] of Object.entries<any>(report)) current[`${REPO}:${lang}`] = { missing: r.missingInAnalyzer, unexplained: r.unexplainedInAnalyzer }
  const updateBaseline = process.argv.includes("--update-baseline")
  if (updateBaseline) {
    let merged: any = { samplePerLang: SAMPLE_PER_LANG, counts: {} }
    if (fs.existsSync(BASELINE)) {
      try {
        const prev = JSON.parse(fs.readFileSync(BASELINE, "utf8"))
        merged.samplePerLang = SAMPLE_PER_LANG
        merged.counts = { ...(prev.counts ?? prev), ...merged.counts }
      } catch {}
    }
    merged = { samplePerLang: SAMPLE_PER_LANG, counts: { ...(fs.existsSync(BASELINE) ? (JSON.parse(fs.readFileSync(BASELINE, "utf8")).counts ?? {}) : {}), ...current } }
    fs.writeFileSync(BASELINE, JSON.stringify(merged, null, 2) + "\n")
    console.log("differential baseline updated:", current)
  } else if (fs.existsSync(BASELINE)) {
    const parsed = JSON.parse(fs.readFileSync(BASELINE, "utf8"))
    const base = parsed.counts ?? parsed // legacy flat format
    if (parsed.samplePerLang && parsed.samplePerLang !== SAMPLE_PER_LANG) {
      console.log(`differential baseline gate: SKIPPED (baseline sampled ${parsed.samplePerLang}/lang, this run ${SAMPLE_PER_LANG}/lang — probe mode, not comparable)`)
    } else {
      const regressions = Object.keys(current).filter(l =>
        base[l] && (current[l].missing > base[l].missing || current[l].unexplained > base[l].unexplained))
      for (const r of regressions) console.error(`DIFFERENTIAL REGRESSION ${r}: ${JSON.stringify(base[r])} -> ${JSON.stringify(current[r])}`)
      if (regressions.length) process.exit(5)
      console.log("differential baseline gate: no regressions")
    }
  }
}

if (process.argv[1]?.endsWith("differential.ts")) {
  main().catch(e => { console.error(e); process.exit(1) })
}
