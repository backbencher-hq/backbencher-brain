// Is a lane's `MISSING=0` as strong as it reads? The differential matches a truth
// row to an analyzer row on `label` + `normTarget(target)` where normTarget is
// LAST SEGMENT ONLY. I found one consequence of that today by hand (groovy's
// `anonymous_X.decode -> X.decode` was satisfied by the analyzer's unrelated
// `IdentityDecoder.decode -> PropertyDecoder.decode`, so four real truth rows
// were published as two), which means the rule can hide a row on ANY lane.
//
// This is the report-only instrument for that question, on the whole corpus at
// full extent (no draws: the lane's own universe, `.groovy` + `.gradle`):
//
//   loose  = label + last-segment(target)      — the rule the artifact publishes
//   strict = label + the target AS WRITTEN     — generics/args stripped, the
//            qualifier chain kept, and compared only when BOTH sides carry one
//
// A row that is loose-covered and not strict-covered is a HIDING SITE. It is
// split two ways so the report is adjudicable rather than alarming:
//
//   HARD  both sides written with a qualifier and they disagree  -> a mask
//   SOFT  one side is a bare leaf                                -> asymmetry
//
// Nothing here changes a gate. It measures how much the current rule can hide,
// which is the input to deciding whether the rule should change.
import * as fs from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"
import { deriveTreeEdges, deriveGroovyEdges } from "../differential"
import { ASTEngine } from "../../../src/ast/engine"

const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const LANGS: Record<string, { repos: string[]; exts: string[]; lang: string }> = {
  groovy: { repos: ["grails-core", "geb"], exts: [".groovy", ".gradle"], lang: "groovy" },
  java: { repos: ["grails-core", "clojure"], exts: [".java"], lang: "java" },
}
const WHICH = process.argv[2] ?? "groovy"
const cfg = LANGS[WHICH]
if (!cfg) throw new Error(`unknown lane ${WHICH}`)
// `--files=a,b` restricts the walk to named repo-relative paths. It exists for
// the INSTRUMENT'S OWN falsification: the audit's sensitivity is demonstrated on
// the two corpus files whose pre-fix state is known (fix reverted in place), not
// asserted from a 0-count. A 0-count from an instrument that cannot fail is not
// evidence, which is the whole point of this file.
const FILES_ARG = process.argv.find((a) => a.startsWith("--files="))
const ONLY: Set<string> | null = FILES_ARG ? new Set(FILES_ARG.slice("--files=".length).split(",")) : null

// ---- the two rules ---------------------------------------------------------
const strip = (t: string): string => String(t ?? "").replace(/<.*$/, "").replace(/\[.*$/, "").trim()
const lastSegment = (t: string): string => {
  const parts = strip(t).split(".").filter(Boolean)
  return parts.length ? parts[parts.length - 1] : ""
}
// `A.B` -> qualifier `A`; a bare leaf -> "" (unqualified).
const qualifier = (t: string): string => {
  const parts = strip(t).split(".").filter(Boolean)
  return parts.length > 1 ? parts.slice(0, -1).join(".") : ""
}
const looseKey = (label: string, target: string): string => `${label}|${lastSegment(target)}`
const strictKey = (label: string, target: string): string => `${label}|${strip(target)}`

const parser = await ASTEngine.getParser(cfg.lang as any)
const analyzer: any = new (
  await import(`../../../src/ast/real-${cfg.lang}-analyzer`)
)[`Real${cfg.lang[0].toUpperCase()}${cfg.lang.slice(1)}Analyzer`]()

let files = 0
let truthRows = 0
let analyzerRows = 0
let looseCovered = 0
let strictCovered = 0
let hard = 0
let soft = 0
const hardSamples: string[] = []
const softSamples: string[] = []
const filesWithHard = new Set<string>()

for (const repo of cfg.repos) {
  const root = path.join(CORPUS, repo)
  const stack = [root]
  const found: string[] = []
  while (stack.length) {
    const d = stack.pop()!
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (!/^(\.|node_modules|build|target)/.test(e.name)) stack.push(p) }
      else if (cfg.exts.some((x) => e.name.endsWith(x))) found.push(p)
    }
  }
  found.sort()
  for (const f of found) {
    const rel = path.relative(root, f)
    if (ONLY && !ONLY.has(rel)) continue
    // The lane's own admission rule: the router decides.
    let head = ""
    try { head = fs.readFileSync(f, "utf8").slice(0, 65536) } catch { continue }
    if (detectLanguageFromPath(f, head) !== cfg.lang) continue
    files++
    let content: string
    try { content = fs.readFileSync(f, "utf8") } catch { continue }
    const tree = parser.parse(content)
    const rootNode = tree.rootNode
    const truth: any[] =
      cfg.lang === "groovy"
        ? [...(deriveTreeEdges(rootNode, "groovy") as any[]), ...deriveGroovyEdges(rootNode, content)]
        : (deriveTreeEdges(rootNode, cfg.lang as any) as any[])
    const res: any = await analyzer.analyze(rootNode, content, rel)
    const rels = (res.relationships ?? []).map((r: any) => ({
      label: String(r.type ?? ""),
      target: String(r.target ?? ""),
    }))
    truthRows += truth.length
    analyzerRows += rels.length
    const looseSet = new Set(rels.map((r: any) => looseKey(r.label, r.target)))
    const strictSet = new Set(rels.map((r: any) => strictKey(r.label, r.target)))
    for (const te of truth) {
      const lk = looseKey(te.label, te.target)
      if (analyzerRows >= 0 && looseSet.has(lk)) looseCovered++
      else continue
      const sk = strictKey(te.label, te.target)
      if (strictSet.has(sk)) { strictCovered++; continue }
      // loose-covered but not strict-covered: which direction of asymmetry?
      const tq = qualifier(te.target)
      const sameLeaf = rels.filter((r: any) => r.label === te.label && lastSegment(r.target) === lastSegment(te.target))
      const withQual = sameLeaf.filter((r: any) => qualifier(r.target) !== "")
      if (tq !== "" && withQual.length > 0) {
        hard++
        filesWithHard.add(`${repo}/${rel}`)
        if (hardSamples.length < 40) {
          hardSamples.push(
            `${repo}/${rel} :: ${te.label} truth=${te.from ?? "?"} -> ${te.target}   vs analyzer -> ${withQual.map((r: any) => r.target).join(" / ")}`,
          )
        }
      } else {
        soft++
        if (softSamples.length < 20) {
          softSamples.push(`${repo}/${rel} :: ${te.label} truth -> ${te.target}  analyzer -> ${sameLeaf.map((r: any) => r.target).join(" / ")}`)
        }
      }
    }
  }
}

console.log(`\n=== ${WHICH} — oracle sharpness, full extent (no draws)`)
console.log(`  files=${files}  truth rows=${truthRows}  analyzer rows=${analyzerRows}`)
console.log(`  loose-covered  (the published rule)   : ${looseCovered}/${truthRows}`)
console.log(`  strict-covered (target as written)    : ${strictCovered}/${truthRows}  -> ${truthRows - strictCovered} row(s) the published rule passes that a written-target rule would not`)
console.log(`  HARD (both sides qualified, disagree) : ${hard} across ${filesWithHard.size} file(s)`)
console.log(`  SOFT (one side a bare leaf)           : ${soft}`)
if (hardSamples.length) { console.log(`  --- HARD samples (these are hidden sites)`); for (const s of hardSamples) console.log(`    ${s}`) }
if (softSamples.length) { console.log(`  --- SOFT samples (asymmetry to adjudicate, not yet a defect)`); for (const s of softSamples) console.log(`    ${s}`) }
process.exit(0)
