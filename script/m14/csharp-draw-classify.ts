/**
 * CSHARP LANE — post-wiring DRAW row classifier (task-37 STEP 3/4, light, read-only).
 *
 * Reproduces ONE differential csharp draw: same drawn file list the harness printed
 * (`BB_F5_SHOW_FILES=1`), the same truth composition the hook pushes (all exported csharp
 * oracle helpers imported from differential.ts), the same analyzer entry point and the same
 * interface-kind companion, the harness's own match normalisation, and the same label
 * allowlist — then prints EVERY MISSING and UNEXPLAINED row so each one is adjudicated
 * (oracle-defect / analyzer-defect / rule-gap) instead of inferred from the 12/6-sample cap.
 *
 * `--new-truth` simulates the pending wiring: adds the lane's exports/imports/overrides truth
 * modules to the truth side and re-admits those labels on the analyzer side (overrides re-admitted
 * here means the C923 analyzer-side exclusion is also lifted in the simulation, exactly the pair
 * the wiring request asks for).
 *
 * CLI: bun run script/m14/csharp-draw-classify.ts <repo> <files-file> [--new-truth] [--json]
 * EXIT 0 measured · 2 usage
 */
import { readFileSync } from "node:fs"
import * as fs from "node:fs"
import * as path from "node:path"
import { getParser } from "../../src/ast/engine"
import { normTarget, auditTarget, deriveCSharpEdges, deriveCSharpDeclaredTypeEdges, deriveCSharpUsingReferences, deriveCSharpContains, deriveCSharpFieldAccessUses, deriveCSharpBareUses } from "./differential"
import { deriveCSharpExportsTruth, deriveCSharpImportsTruth, deriveCSharpOverridesTruth } from "./csharp-truth"

const argv = process.argv.slice(2)
const repo = argv.find((a) => !a.startsWith("--"))
const filesFile = argv.filter((a) => !a.startsWith("--"))[1]
const NEW_TRUTH = argv.includes("--new-truth")
const asJson = argv.includes("--json")
if (!repo || !filesFile) {
  console.error("usage: csharp-draw-classify.ts <repo> <files-file> [--new-truth] [--json]")
  process.exit(2)
}
const CORPUS = process.env.BB_CORPUS_ROOT ?? path.resolve(".corpus")
const repoDir = path.join(CORPUS, repo)
const drawn = readFileSync(filesFile, "utf8").split("\n").map((s) => s.trim()).filter(Boolean)

const BASE_LABELS = ["calls", "contains", "references", "uses", "extends", "implements", "instantiates"]
const NEW_LABELS = ["exports", "imports", "overrides"]
const COMPARED = new Set(NEW_TRUTH ? [...BASE_LABELS, ...NEW_LABELS] : BASE_LABELS)

// The harness's corpus-level interface-name set (regex pass over the repo, cheap, no second parse):
// the analyzer's base-list interface-vs-class companion must be the SAME set on both sides.
const CSHARP_INTERFACES = new Set<string>()
{
  const re = /\binterface\s+([A-Za-z_][A-Za-z0-9_]*)/g
  const stack = [repoDir]
  while (stack.length) {
    const d = stack.pop()!
    let es: fs.Dirent[]
    try { es = fs.readdirSync(d, { withFileTypes: true }) } catch { continue }
    for (const e of es) {
      const abs = path.join(d, e.name)
      let isDir = e.isDirectory()
      if (!isDir && e.isSymbolicLink()) { try { isDir = fs.statSync(abs).isDirectory() } catch { isDir = false } }
      if (isDir) { stack.push(abs); continue }
      if (!e.name.endsWith(".cs") && !e.name.endsWith(".csx")) continue
      let s = ""
      try { s = fs.readFileSync(abs, "utf8") } catch { continue }
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(s))) if (m[1]) CSHARP_INTERFACES.add(m[1])
    }
  }
}
const INTERFACE_KINDS = new Map<string, string>()
for (const nm of CSHARP_INTERFACES) INTERFACE_KINDS.set(nm, "interface")

const PATH_EXT = new Set(["sol","h","hh","hpp","hxx","c","cc","cpp","cxx","cu","js","jsx","mjs","cjs","ts","tsx","mts","cts","py","pyi","pyw","dart","rb","java","go","rs","json","yaml","yml","toml","md","css","scss","sass","html","proto"])
const isPathLikeImport = (t: string): boolean => {
  const dot = t.lastIndexOf(".")
  if (dot > 0 && dot < t.length - 1) return PATH_EXT.has(t.slice(dot + 1).toLowerCase())
  return false
}
const matchKey = (label: string, target: any): string => {
  const t = String(target ?? "")
  return label === "imports" && isPathLikeImport(t) ? `EXACT:${t}` : normTarget(auditTarget(t))
}
function familyOf(label: string, target: string): string {
  const t = String(target ?? "")
  if (!t) return "empty"
  if (label === "exports") return t.includes(".") ? "qualified-type" : "bare-type"
  if (t.startsWith(":")) return "erlang-atom"
  if (t.includes("/")) return "signature-ish"
  if (t.includes(".")) {
    const f = t.split(".")[0]
    return f.length > 0 && f[0] >= "A" && f[0] <= "Z" ? "dotted-type" : "dotted-lower"
  }
  if (t[0] >= "A" && t[0] <= "Z") return "bare-type"
  return "member-leaf"
}

const parser = await getParser("csharp" as any)
const AnalyzerMod: any = await import("../../src/ast/real-csharp-analyzer")
const analyzer = new AnalyzerMod.RealCSharpAnalyzer()

type Mismatch = { dir: "MISSING" | "UNEXPLAINED"; label: string; target: string; from?: string; file: string }
const mismatches: Mismatch[] = []
let truthTotal = 0, analyzerTotal = 0, covered = 0, explainable = 0
for (const rel of drawn) {
  const abs = path.join(repoDir, rel)
  let content = ""
  try { content = readFileSync(abs, "utf8") } catch { continue }
  let tree: any
  try { tree = parser.parse(content) } catch { continue }
  let result: any = null
  try { result = await analyzer.analyze(tree.rootNode, content, rel, { typeKinds: INTERFACE_KINDS }) } catch { continue }
  const all = ((result?.relationships ?? []) as any[]).map((r) => ({ label: String(r.type), target: String(r.target ?? "") }))
  let analyzerRels = all.filter((r) => COMPARED.has(r.label))
  analyzerRels = analyzerRels.filter((r, i, arr) => { const k = r.label + "|" + r.target; return i === arr.findIndex((x) => x.label + "|" + x.target === k) })
  let truth: { label: string; from: string; target: string }[] = []
  for (const e of deriveCSharpEdges(tree.rootNode, CSHARP_INTERFACES)) {
    if (e.label === "overrides" && !NEW_TRUTH) continue // the harness skips overrides on BOTH sides
    truth.push(e)
  }
  if (NEW_TRUTH) {
    for (const e of deriveCSharpExportsTruth(tree.rootNode)) truth.push(e)
    for (const e of deriveCSharpImportsTruth(tree.rootNode)) truth.push(e)
    for (const e of deriveCSharpOverridesTruth(tree.rootNode)) truth.push(e)
  }
  for (const e of deriveCSharpDeclaredTypeEdges(tree.rootNode)) truth.push(e)
  for (const e of deriveCSharpUsingReferences(tree.rootNode)) truth.push(e)
  for (const e of deriveCSharpContains(tree.rootNode)) truth.push(e)
  for (const e of deriveCSharpFieldAccessUses(tree.rootNode)) truth.push(e)
  for (const e of deriveCSharpBareUses(tree.rootNode, result?.symbols ?? [])) truth.push(e)
  truth = truth.filter((t) => COMPARED.has(t.label))
  truth = truth.filter((t, i, arr) => { const k = t.label + "|" + t.target; return i === arr.findIndex((x) => x.label + "|" + x.target === k) })
  truthTotal += truth.length
  analyzerTotal += analyzerRels.length
  for (const te of truth) {
    const hit = analyzerRels.some((r) => r.label === te.label && matchKey(r.label, r.target) === matchKey(te.label, te.target))
    if (hit) covered++
    else mismatches.push({ dir: "MISSING", label: te.label, target: String(te.target), from: String(te.from ?? ""), file: rel })
  }
  for (const r of analyzerRels) {
    const hit = truth.some((te) => te.label === r.label && (matchKey(te.label, te.target) === matchKey(r.label, r.target) || (r.label !== "imports" && String(te.target).includes(normTarget(auditTarget(r.target))))))
    if (hit) { explainable++; continue }
    mismatches.push({ dir: "UNEXPLAINED", label: r.label, target: r.target, file: rel })
  }
}
const groups = new Map<string, { count: number; samples: Mismatch[] }>()
for (const m of mismatches) {
  const key = `${m.dir}\u0000${m.label}\u0000${familyOf(m.label, m.target)}`
  const g = groups.get(key) ?? { count: 0, samples: [] }
  g.count++
  if (g.samples.length < 6) g.samples.push(m)
  groups.set(key, g)
}
const out = {
  repo, drawn: drawn.length, newTruth: NEW_TRUTH, truthTotal, covered, analyzerTotal, explainable,
  missing: mismatches.filter((m) => m.dir === "MISSING").length,
  unexplained: mismatches.filter((m) => m.dir === "UNEXPLAINED").length,
  groups: [...groups.entries()].map(([k, v]) => { const [dir, label, family] = k.split("\u0000"); return { dir, label, family, count: v.count, samples: v.samples } }).sort((a, b) => b.count - a.count),
  mismatches,
}
if (asJson) console.log(JSON.stringify(out, null, 2))
else {
  console.log(`repo=${repo} drawn=${drawn.length} newTruth=${NEW_TRUTH} truth=${truthTotal} covered=${covered} analyzer=${analyzerTotal} missing=${out.missing} unexplained=${out.unexplained}`)
  for (const g of out.groups) {
    console.log(`\n${g.dir} ${g.label} (${g.family}) × ${g.count}`)
    for (const s of g.samples.slice(0, 4)) console.log(`   ${s.from ? `from ${s.from} ` : ""}-> ${s.target}  [${s.file}]`)
  }
}
