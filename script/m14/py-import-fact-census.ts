/**
 * PY-IMPORT-FACT-CENSUS — the D7 priority-2 measurement: of the whole population's `imports`
 * edges, which ones the COMPLETE PROJECT INDEX can retarget to a declaration (the once-question),
 * and which stay FACT-ONLY because no single declaration answers them.
 *
 * It builds the SAME project index the production pipeline builds (`buildProjectIndex` with
 * `PYTHON_DECLARATION_SPEC`, one index per repository, trees parsed once and reused) and runs the
 * production analyzer against it, so the marker keys read here are the keys the gate read on the
 * indexed verdict arm:
 *
 *   projectIndexResolution === "item-declared-once"   RETARGETED — the edge now names the symbol
 *                                                     (a RESOLVABLE row; counted as candidate)
 *   projectLocalModule && no resolution               FACT-ONLY — the index PROVES the module is
 *                                                     this project's, but the edge cannot name a
 *                                                     declaration. Split by SHAPE:
 *                                                       namespace   `import pkg.mod` (item "*")
 *                                                       ambiguous   item count > 1 (once-question
 *                                                                   refuses: picking one is the
 *                                                                   false-binding class)
 *                                                       absent      symbolCounts has no entry
 *                                                       dotted      item is itself a dotted path
 *   isExternalTarget + reason module-namespace        THIRD-PARTY CLAIM (extOK on the arm)
 *
 * Usage: BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/py-import-fact-census.ts [--repos N]
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { RealPythonAnalyzer } from "../../src/ast/real-python-analyzer"
import { buildProjectIndex, PYTHON_DECLARATION_SPEC } from "../../src/ast/project-index"

const ROOT = process.cwd()
const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const OUT = argOf("--out")
const REPO_LIMIT = Number(argOf("--repos") ?? "0")
const CORPUS = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")

function listFiles(dir: string, out: string[], depth = 0): void {
  if (depth > 12) return
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return }
  for (const e of entries) {
    if (e === ".git" || e === "node_modules") continue
    const p = path.join(dir, e)
    let st: any
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) listFiles(p, out, depth + 1)
    else if (st.isFile() && (e.endsWith(".py") || e.endsWith(".pyi") || e.endsWith(".pyw"))) out.push(p)
  }
}
const repos = readdirSync(CORPUS)
  .map((e) => path.join(CORPUS, e))
  .filter((p) => { try { return statSync(p).isDirectory() } catch { return false } })
  .sort()
// REPO_LIMIT counts repos that ACTUALLY CARRY python files: the first alphabetical corpus
// entries are javascript/swift repos (Aporia, afnetworking, …), so slicing the raw list measured
// nothing and reported 0 rows — a scope bug, not a finding.
const selectedAll: string[] = []
for (const r of repos) {
  const probe: string[] = []
  listFiles(r, probe)
  if (probe.length > 0) selectedAll.push(r)
  if (REPO_LIMIT > 0 && selectedAll.length >= REPO_LIMIT) break
}
const selected = selectedAll
const parser: any = await ASTEngine.getParser("python")
type Shape = { retargeted: number; namespace: number; ambiguous: number; absent: number; dotted: number; thirdParty: number; noMarker: number; total: number; resolvedRetargeted: number }
const global: Shape = { retargeted: 0, namespace: 0, ambiguous: 0, absent: 0, dotted: 0, thirdParty: 0, noMarker: 0, total: 0, resolvedRetargeted: 0 }
const perRepo: Array<{ repo: string; files: number; shape: Shape }> = []
for (const repo of selected) {
  const files: string[] = []
  listFiles(repo, files)
  if (files.length === 0) continue
  const trees: any[] = []
  const contents: string[] = []
  for (const f of files) {
    let text: string | null = null
    try { text = readFileSync(f, "utf8") } catch { text = null }
    if (text === null) continue
    const tree = parser.parse(text)
    if (!tree) continue
    trees.push({ path: f, tree })
    contents.push(text)
  }
  const index = buildProjectIndex(trees, PYTHON_DECLARATION_SPEC)
  // THE COMPLETENESS CONTRACT, satisfied by the instrument's OWN scope: it walked the WHOLE
  // repository (the production gate sets the same flag when its file list is the project). Without
  // it `applyProjectIndexFacts` fails closed and publishes NO marker — the first run of this
  // instrument measured 20,606 imports with every one "no marker", which is the fail-closed
  // contract working, not a finding.
  index.complete = true
  const analyzer = new RealPythonAnalyzer()
  const shape: Shape = { retargeted: 0, namespace: 0, ambiguous: 0, absent: 0, dotted: 0, thirdParty: 0, noMarker: 0, total: 0, resolvedRetargeted: 0 }
  for (let i = 0; i < trees.length; i++) {
    const f = files[i]!
    let r: any
    try { r = analyzer.analyze(trees[i]!.tree.rootNode, contents[i]!, f, { projectIndex: index } as any) } catch { continue }
    for (const rel of r.relationships) {
      if (String(rel.type) !== "imports") continue
      const md = rel.metadata ?? {}
      shape.total++
      if (md.projectIndexResolution === "item-declared-once") { shape.retargeted++; continue }
      if (md.projectLocalModule === true) {
        const target = String(rel.target ?? "")
        const colon = target.lastIndexOf(":")
        const item = colon >= 0 ? target.slice(colon + 1) : ""
        if (item === "" || item === "*") { shape.namespace++; continue }
        if (item.indexOf(".") !== -1) { shape.dotted++; continue }
        const count = index.symbolCounts?.get(item) ?? 0
        if (count > 1) shape.ambiguous++
        else shape.absent++
        continue
      }
      if (md.isExternalTarget === true && md.externalReason === "module-namespace") { shape.thirdParty++; continue }
      shape.noMarker++
    }
  }
  const add = (a: Shape, b: Shape): void => { for (const k of Object.keys(a) as Array<keyof Shape>) a[k] += b[k] }
  add(global, shape)
  perRepo.push({ repo: path.basename(repo), files: trees.length, shape })
  console.error(`  ${path.basename(repo).padEnd(28)} files=${String(trees.length).padEnd(6)} imports=${String(shape.total).padEnd(6)} retargeted=${String(shape.retargeted).padEnd(6)} factOnly=${shape.namespace + shape.ambiguous + shape.absent + shape.dotted}`)
}
console.log(`\nPYTHON imports FACT CENSUS — complete-project-index pass over ${selected.length} repos`)
console.log(`${"repo".padEnd(30)}${"files".padEnd(8)}${"imports".padEnd(9)}${"retargeted".padEnd(12)}${"namespace".padEnd(11)}${"ambiguous".padEnd(11)}${"absent".padEnd(9)}${"dotted".padEnd(8)}${"thirdParty".padEnd(11)}${"noMarker".padEnd(10)}`)
for (const r of perRepo) {
  console.log(`${r.repo.padEnd(30)}${String(r.files).padEnd(8)}${String(r.shape.total).padEnd(9)}${String(r.shape.retargeted).padEnd(12)}${String(r.shape.namespace).padEnd(11)}${String(r.shape.ambiguous).padEnd(11)}${String(r.shape.absent).padEnd(9)}${String(r.shape.dotted).padEnd(8)}${String(r.shape.thirdParty).padEnd(11)}${String(r.shape.noMarker).padEnd(10)}`)
}
console.log(`${"TOTAL".padEnd(30)}${"".padEnd(8)}${String(global.total).padEnd(9)}${String(global.retargeted).padEnd(12)}${String(global.namespace).padEnd(11)}${String(global.ambiguous).padEnd(11)}${String(global.absent).padEnd(9)}${String(global.dotted).padEnd(8)}${String(global.thirdParty).padEnd(11)}${String(global.noMarker).padEnd(10)}`)
console.log(`\nD7 DISPOSITION INPUT:`)
console.log(`  retargeted (once-question PASSED)         ${global.retargeted}  -> RESOLVED on the indexed arm (declaration target)`)
console.log(`  fact-only total                          ${global.namespace + global.ambiguous + global.absent + global.dotted}`)
console.log(`    namespace import (item "*")            ${global.namespace}  -> INSTRUMENT GAP: no module/file declaration target exists in the gate's model`)
console.log(`    ambiguous item (symbolCounts > 1)      ${global.ambiguous}  -> RULED UNDECIDABLE by the lane's own once-question (picking one of N is false binding)`)
console.log(`    absent item (no count entry)           ${global.absent}  -> INSTRUMENT GAP (payload lacks counts) if any; else RULED`)
console.log(`    dotted item                            ${global.dotted}  -> RULED (grammar shape has no single declaration)`)
console.log(`  third-party module claim                 ${global.thirdParty}  -> CLAIMED (moduleNamespace, extOK)`)
console.log(`  no marker                                ${global.noMarker}  -> not project-local/third-party (relative, __future__, unresolved index questions)`)
if (OUT) { writeFileSync(OUT, JSON.stringify({ scope: { repos: selected.length }, global, perRepo }, null, 2)); console.log(`\nwrote ${OUT}`) }
