// JAVASCRIPT EXPORTS-CLAIM EVIDENCE PROBE — measures, on the gate's admitted population (capped), the
// distribution of the exports-claim evidence emitted for `defaultExport` / `moduleExports`:
//   · default rows by form (named-declaration / export-alias / expression / anonymous) and how many
//     carry a localName;
//   · CJS rows by write form (module-exports-object / exports-object / deep-member-assignment /
//     module-exports-binding|expression) — the `moduleExports` class.
// It is the emission-side measurement the claim CONTRACT quotes; the whole-population arm is the
// Lead's to run once the arbiter kind is decided.
//
// USAGE: export BB_CORPUS_ROOT=$PWD/.corpus
//        bun run script/m14/js-export-claim-probe.ts --cap=400
import { readFileSync, readdirSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? path.join(process.cwd(), ".corpus")
const CAP = Number(process.argv.find((a) => a.startsWith("--cap="))?.slice("--cap=".length) ?? 400)
const EXTENSIONS = ["js", "jsx", "mjs", "cjs"]
const SIZE_CAP = 1024 * 1024
function repoNames(): string[] {
  try {
    return readdirSync(CR).filter((n) => { try { return statSync(path.join(CR, n)).isDirectory() } catch { return false } }).sort()
  } catch { return [] }
}
function admit(rel: string): boolean {
  const dot = rel.lastIndexOf(".")
  const ext = dot >= 0 ? rel.slice(dot + 1).toLowerCase() : ""
  if (EXTENSIONS.includes(ext)) return true
  return EXTENSIONS.includes(path.basename(rel))
}
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
    if (!admit(rel)) continue
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

const defaultByForm: Record<string, number> = {}
const defaultWithLocalName: Record<string, number> = {}
const cjsByForm: Record<string, number> = {}
let exportsRows = 0, parsed = 0, skipped = 0
for (const abs of files) {
  let r: any
  try { r = await parseFile(abs, path.dirname(abs), { projectRoot: path.dirname(abs) } as any) } catch { skipped++; continue }
  parsed++
  for (const rel of r.relationships ?? []) {
    if (rel.type !== "exports") continue
    exportsRows++
    const md = rel.metadata ?? {}
    if (typeof md.defaultExportForm === "string") {
      defaultByForm[md.defaultExportForm] = (defaultByForm[md.defaultExportForm] ?? 0) + 1
      if (typeof md.defaultExportLocalName === "string") {
        defaultWithLocalName[md.defaultExportForm] = (defaultWithLocalName[md.defaultExportForm] ?? 0) + 1
      }
    }
    if (typeof md.moduleExportsForm === "string") {
      cjsByForm[md.moduleExportsForm] = (cjsByForm[md.moduleExportsForm] ?? 0) + 1
    }
  }
}
console.log(JSON.stringify({
  probe: "js-export-claim-probe",
  command: `bun run script/m14/js-export-claim-probe.ts --cap=${CAP}`,
  population: { admittedTotal: found.length, repos: repos.size, sampled: files.length, parsed, skipped },
  exportsRowsSampled: exportsRows,
  defaultExportForms: defaultByForm,
  defaultRowsWithLocalName: defaultWithLocalName,
  moduleExportsForms: cjsByForm,
  note: "SAMPLE of the gate's admitted population. The contract quotes the census class totals (DEFAULT-LITERAL 6,186; UNRESOLVED-OTHER 4,884) and these form SHARES; the whole-population arm is the Lead's once the arbiter kind is decided.",
}, null, 1))
