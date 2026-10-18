// JAVASCRIPT IMPORTED-BINDING CLAIM PROBE — measures, on the SAME stride population the gate uses,
// how many edges carry the evidence-verified imported-binding claim and how many imports rows carry
// the evidence array, split by the claim's specifier class. It is the emission-side measurement for
// the Lead's arbiter half (the claim itself is counted by the gate only once the arbiter knows the
// kind, so this probe is how the analyzer half is sized before that lands).
//
// USAGE: export BB_CORPUS_ROOT=$PWD/.corpus
//        bun run script/m14/js-import-claim-probe.ts --cap=50
import { readFileSync, readdirSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? path.join(process.cwd(), ".corpus")
const CAP = Number(process.argv.find((a) => a.startsWith("--cap="))?.slice("--cap=".length) ?? 50)
const EXTENSIONS = ["js", "jsx", "mjs", "cjs"]
const SIZE_CAP = 1024 * 1024
function repoNames(): string[] {
  try {
    return readdirSync(CR).filter((n) => { try { return statSync(path.join(CR, n)).isDirectory() } catch { return false } }).sort()
  } catch { return [] }
}
function admitByExtension(rel: string): boolean {
  const dot = rel.lastIndexOf(".")
  const ext = dot >= 0 ? rel.slice(dot + 1).toLowerCase() : ""
  if (EXTENSIONS.includes(ext)) return true
  return EXTENSIONS.includes(path.basename(rel))
}
// THE GATE'S ADMITTED POPULATION (git ls-files per real checkout + extension/basename admission + 1 MB
// cap), printed as admittedTotal/repos so a drift from 12,374/95 can never be silently measured.
const found: string[] = []
const repos = new Set<string>()
for (const name of repoNames()) {
  const dir = path.join(CR, name)
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[] = []
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!admitByExtension(rel)) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    found.push(abs); repos.add(name)
  }
}
found.sort()
const files = CAP > 0 && found.length > CAP ? (() => {
  const stride = Math.max(1, Math.floor(found.length / CAP))
  const out: string[] = []
  for (let i = 0; i < found.length && out.length < CAP; i += stride) out.push(found[i])
  return out
})() : found
const admittedTotal = found.length

const claims: Record<string, number> = {}
const receiverClaims: Record<string, number> = {}
const receiverBySpecifierClass: Record<string, number> = {}
let receiverRows = 0
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
    if (typeof md.receiverImportSpecifier === "string" && typeof md.receiverImportBinding === "string") {
      receiverRows++
      receiverClaims[String(rel.type ?? "")] = (receiverClaims[String(rel.type ?? "")] ?? 0) + 1
      const spec = String(md.receiverImportSpecifier)
      const cls = spec.startsWith(".") || spec.startsWith("/") ? "relative/project" : spec.startsWith("@") ? "scoped-package" : spec.length > 0 && !spec.includes("/") ? "bare-package" : "package-subpath"
      receiverBySpecifierClass[cls] = (receiverBySpecifierClass[cls] ?? 0) + 1
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
  population: { admittedTotal, repos: repos.size, sampled: files.length },
  evidence: {
    importsRows,
    importsRowsWithImportedBindingsArray: evidenceEdges,
    localNamesPublished: evidenceNames,
    reExportRowsWithEmptyArray: reexportRows,
  },
  claims: { total: Object.values(claims).reduce((a, b) => a + b, 0), byLabel: claims, bySpecifierClass, filesWithClaims },
  receiverPositionClaims: { total: receiverRows, byLabel: receiverClaims, bySpecifierClass: receiverBySpecifierClass },
  note: "Emission-side measurement only. The gate counts these claims in bindOK only once the Lead's arbiter knows the importedBinding kind; this probe sizes the analyzer half and proves the evidence arrays are on every imports row.",
}, null, 1))
