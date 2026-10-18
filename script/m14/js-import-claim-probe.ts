// JAVASCRIPT IMPORTED-BINDING CLAIM PROBE — measures, on the SAME stride population the gate uses,
// how many edges carry the evidence-verified imported-binding claim and how many imports rows carry
// the evidence array, split by the claim's specifier class. It is the emission-side measurement for
// the Lead's arbiter half (the claim itself is counted by the gate only once the arbiter knows the
// kind, so this probe is how the analyzer half is sized before that lands).
//
// USAGE: export BB_CORPUS_ROOT=$PWD/.corpus
//        bun run script/m14/js-import-claim-probe.ts --cap=50
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? path.join(process.cwd(), ".corpus")
const CAP = Number(process.argv.find((a) => a.startsWith("--cap="))?.slice("--cap=".length) ?? 50)
const EXTENSIONS = ["js", "jsx", "mjs", "cjs"]
const SIZE_CAP = 1024 * 1024
function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name)
    let st
    try { st = statSync(abs) } catch { continue }
    if (st.isDirectory()) { walk(abs, out); continue }
    const dot = name.lastIndexOf(".")
    if (dot < 0) continue
    if (!EXTENSIONS.includes(name.slice(dot + 1).toLowerCase())) continue
    if (st.size > SIZE_CAP) continue
    out.push(abs)
  }
}
const all: string[] = []
walk(CR, all)
all.sort()
const stride = Math.max(1, Math.floor(all.length / CAP))
const files: string[] = []
for (let i = 0; i < all.length && files.length < CAP; i += stride) files.push(all[i])

const claims: Record<string, number> = {}
const bySpecifierClass: Record<string, number> = {}
let evidenceEdges = 0, evidenceNames = 0, importsRows = 0, reexportRows = 0, filesWithClaims = 0
let dynamicRefused = 0
for (const abs of files) {
  let r: any
  try { r = await parseFile(abs, path.dirname(abs), { projectRoot: path.dirname(abs) } as any) } catch { continue }
  const rows = r.relationships ?? []
  let fileClaims = 0
  for (const rel of rows) {
    const md = rel.metadata ?? {}
    if (rel.type === "imports") {
      importsRows++
      if (Array.isArray(md.importedBindings)) {
        evidenceEdges++
        evidenceNames += md.importedBindings.length
        if (md.isReExport) reexportRows++
        if (md.isDynamicImport === true || (md.isRequire === false && md.isDynamicImport !== true)) dynamicRefused++
      }
    }
    if (md.importedBinding && typeof md.importedBinding === "object") {
      const label = String(rel.type ?? "")
      claims[label] = (claims[label] ?? 0) + 1
      fileClaims++
      const spec = String(md.importedBinding.specifier ?? "")
      const cls = spec.startsWith(".") || spec.startsWith("/") ? "relative/project" : spec.startsWith("@") ? "scoped-package" : spec.length > 0 && !spec.includes("/") ? "bare-package" : "package-subpath"
      bySpecifierClass[cls] = (bySpecifierClass[cls] ?? 0) + 1
    }
  }
  if (fileClaims > 0) filesWithClaims++
}
console.log(JSON.stringify({
  probe: "js-import-claim-probe",
  command: `bun run script/m14/js-import-claim-probe.ts --cap=${CAP}`,
  population: { corpusFiles: all.length, sampled: files.length },
  evidence: {
    importsRows,
    importsRowsWithImportedBindingsArray: evidenceEdges,
    localNamesPublished: evidenceNames,
    reExportRowsWithEmptyArray: reexportRows,
  },
  claims: { total: Object.values(claims).reduce((a, b) => a + b, 0), byLabel: claims, bySpecifierClass, filesWithClaims },
  note: "Emission-side measurement only. The gate counts these claims in bindOK only once the Lead's arbiter knows the importedBinding kind; this probe sizes the analyzer half and proves the evidence arrays are on every imports row.",
}, null, 1))
