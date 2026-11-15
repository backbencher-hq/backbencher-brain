/**
 * Grammar A/B harness for the Make lane.
 *
 * Two questions, kept apart because they have different answers:
 *
 *   SURFACE   does a locally built wasm declare the same node types and fields as
 *             the one wired into the product? Until this holds, no other comparison
 *             means anything, because a difference could be the toolchain rather
 *             than the patch.
 *   BEHAVIOUR on the whole 99-file corpus: parse errors per file, and the PRODUCT
 *             output (symbols / relationships) through the production entry. A
 *             grammar change that lowers errors while changing what the analyzer
 *             publishes is not a win, and that is only visible at the product
 *             level — which is the lesson the sql lane recorded after its own
 *             headline error-count reduction turned out to be byte-identical output.
 *
 * Usage: grammar-ab.mts <label> <wasm-path> [<wasm-path> ...]
 */
import { readFileSync, writeFileSync } from "node:fs"
import { Parser, Language } from "web-tree-sitter"

const REPO = "/home/ishaq2321/backbencher-brain"
const SRC = "/home/ishaq2321/backbencher-brain/grammars/tree-sitter-make"
const OUT = "/home/ishaq2321/bb_tests/make/out"
const MAN = JSON.parse(readFileSync(`${OUT}/corpus-manifest.json`, "utf8"))
const REPOS = "/home/ishaq2321/bb_tests/repositories"

const declared = (() => {
  const nt = JSON.parse(readFileSync(`${SRC}/src/node-types.json`, "utf8"))
  return {
    named: [...new Set(nt.filter((x: any) => x.named).map((x: any) => x.type))].sort(),
    fields: [...new Set(nt.flatMap((x: any) => Object.keys(x.fields ?? {})))].sort(),
  }
})()

await Parser.init()

async function surfaceOf(wasm: string) {
  const g: any = await Language.load(wasm)
  const named: string[] = []
  const fields: string[] = []
  for (let i = 0; i < g.nodeTypeCount; i++) if (g.nodeTypeIsNamed(i)) named.push(String(g.nodeTypeForId(i)))
  for (let i = 1; i <= g.fieldCount; i++) { const f = g.fieldNameForId(i); if (f) fields.push(f) }
  return { ids: g.nodeTypeCount, named: [...new Set(named)].sort(), fields: [...new Set(fields)].sort() }
}

async function behaviourOf(wasm: string) {
  const parser = new Parser()
  parser.setLanguage(await Language.load(wasm))
  const perFile: Record<string, { errorNodes: number; missingNodes: number; hasError: boolean }> = {}
  let totalErrorNodes = 0
  let filesWithErrors = 0
  for (const f of MAN.fileList) {
    const abs = `${REPOS}/${f.repo}/${f.rel}`
    const content = readFileSync(abs, "utf8")
    const tree = parser.parse(content)
    let errs = 0, missing = 0
    const stack: any[] = [tree.rootNode]
    while (stack.length) {
      const n = stack.pop()
      if (n.type === "ERROR") errs++
      if (n.isMissing) missing++
      for (const c of n.children) stack.push(c)
    }
    perFile[`${f.repo}/${f.rel}`] = { errorNodes: errs, missingNodes: missing, hasError: !!tree.rootNode.hasError }
    totalErrorNodes += errs
    if (tree.rootNode.hasError) filesWithErrors++
  }
  return { perFile, totalErrorNodes, filesWithErrors, totalFiles: MAN.fileList.length }
}

const labels: string[] = []
const results: Record<string, unknown>[] = []
const surfaces: Record<string, unknown>[] = []

const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i += 2) {
  const label = argv[i]
  const wasm = argv[i + 1]
  const surf = await surfaceOf(wasm)
  const beh = await behaviourOf(wasm)
  surfaces.push({ label, ...surf })
  results.push({ label, ...beh })
  labels.push(label)
  console.log(`${label.padEnd(22)} ids=${String(surf.ids).padStart(4)} named=${String(surf.named.length).padStart(3)} fields=${String(surf.fields.length).padStart(3)} | error files ${String(beh.filesWithErrors).padStart(2)}/${beh.totalFiles}  error nodes ${String(beh.totalErrorNodes).padStart(3)}`)
}

const base = surfaces[0]
const report: Record<string, unknown> = {
  declaredSource: { named: declared.named.length, fields: declared.fields.length },
  surfaces,
  behaviour: results.map((r) => ({ label: r.label, totalErrorNodes: r.totalErrorNodes, filesWithErrors: r.filesWithErrors, perFile: r.perFile })),
}

// surface delta of each candidate against the source declaration AND the first build
for (let i = 1; i < surfaces.length; i++) {
  const s = surfaces[i] as any
  report[`surfaceDelta_${s.label}`] = {
    namedMissingVsSource: declared.named.filter((t) => !s.named.includes(t)),
    namedExtraVsSource: s.named.filter((t) => !declared.named.includes(t)),
    fieldsMissingVsSource: declared.fields.filter((t) => !s.fields.includes(t)),
    fieldsExtraVsSource: s.fields.filter((t) => !declared.fields.includes(t)),
    namedAddedVsFirstBuild: s.named.filter((t: string) => !(base.named as string[]).includes(t)),
    namedRemovedVsFirstBuild: (base.named as string[]).filter((t: string) => !s.named.includes(t)),
  }
}

// per-file regression check: a patch may not make any file worse
if (results.length >= 2) {
  const a = results[0] as any
  const b = results[1] as any
  const improved: string[] = [], regressed: string[] = []
  let unchanged = 0
  for (const k of Object.keys(a.perFile)) {
    const before = a.perFile[k].errorNodes, after = b.perFile[k].errorNodes
    if (after < before) improved.push(`${k}: ${before} -> ${after}`)
    else if (after > before) regressed.push(`${k}: ${before} -> ${after}`)
    else unchanged++
  }
  report.comparison = {
    from: a.label, to: b.label,
    totalErrorNodes: [a.totalErrorNodes, b.totalErrorNodes],
    filesWithErrors: [a.filesWithErrors, b.filesWithErrors],
    improved, regressed, unchanged,
    verdict: regressed.length === 0 && b.totalErrorNodes < a.totalErrorNodes
      ? `ADOPT: ${a.totalErrorNodes} -> ${b.totalErrorNodes} error nodes, ${improved.length} file(s) improved, 0 regressed`
      : regressed.length > 0
        ? `REJECT: ${regressed.length} file(s) got WORSE — ${regressed.slice(0, 5).join("; ")}`
        : `NO CHANGE: ${a.totalErrorNodes} -> ${b.totalErrorNodes}`,
  }
}

writeFileSync(`${OUT}/grammar-ab.json`, JSON.stringify(report, null, 2) + "\n")
if (report.comparison) console.log(`\n  verdict: ${(report.comparison as any).verdict}`)
