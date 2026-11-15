// HCL/CLEAN lane D4 row-classification probe (task: fleet-phase analyzer lane).
//
// WHAT THIS IS: a lane-owned, read-only instrument that reproduces the
// differential's own per-file comparison over THE SAME drawn file set the
// scoped `--lang <lane>` run measures (captured with BB_F5_SHOW_FILES=1),
// and classifies EVERY MISSING and EVERY unexplained row into a named class —
// because the scoped run prints only counts and 12 samples, and the census
// page must disposition every row, not the first 12.
//
// WHAT IT REUSES: the differential's OWN exported truth functions
// (`deriveCleanEdges`, `deriveHclEdges`) and its own normTarget/auditTarget
// matchers, imported from script/m14/differential.ts — never re-implemented.
// The comparison loop mirrors the harness's published rule (label + last
// dot/:: segment of the audited target, with the path-like imports EXACT rule)
// which is itself copied verbatim from differential.ts's matchKey.
//
// WHAT IT DOES NOT DO: it does not write any artifact, does not touch
// differential.ts (Lead single-writer), and runs no whole-population gate.

import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")

// The differential's own truth functions and matchers, imported — the one
// rule this programme keeps re-learning: a second copy of an oracle drifts.
const diff = await import(path.join(ROOT, "script/m14/differential.ts"))
const deriveCleanEdges = (diff as any).deriveCleanEdges as (root: any) => { label: string; from: string; target: string }[]
const deriveHclEdges = (diff as any).deriveHclEdges as (root: any, m: string) => { label: string; from: string; target: string }[]
const normTarget = (diff as any).normTarget as (t: string) => string
const auditTarget = (diff as any).auditTarget as (t: string) => string

const lang = process.argv[2] as "clean" | "hcl"
const drawFile = process.argv[3] // the captured [file] list, one relative path per line
const repoDir = process.argv[4] // absolute repo directory the paths are relative to

const rels2 = fs.readFileSync(drawFile, "utf8").split("\n").filter((l) => l.trim().startsWith("[file]")).map((l) => l.trim().replace(/^\[file\]\s*/, ""))
if (rels2.length === 0) throw new Error("no files in draw list")

// The compared-label allowlist, copied VERBATIM from differential.ts's filter
// for the two lanes this probe serves (hcl: base + calls,uses,references,
// imports, exports; clean: base + calls + references). A label the allowlist
// drops is not compared and cannot be MISSING or unexplained.
const comparedLabels = (l: string): string[] => {
  const base = ["extends", "implements", "instantiates", ...(l !== "dart" && l !== "swift" && l !== "cpp" ? ["overrides"] : [])]
  if (l === "hcl") return [...base, "calls", "uses", "references", "imports", "exports"]
  if (l === "clean") return [...base, "calls", "references"]
  return base
}
const allowed = new Set(comparedLabels(lang))

// matchKey: the harness's published match rule (differential.ts matchKey).
const PATH_EXT = new Set(["sol","h","hh","hpp","hxx","c","cc","cpp","cxx","cu","js","jsx","mjs","cjs","ts","tsx","mts","cts","py","pyi","pyw","dart","rb","java","go","rs","json","yaml","yml","toml","md","css","scss","sass","html","proto"])
const isPathLikeImport = (t: string): boolean => {
  if (t.length === 0) return false
  if (t.startsWith(".") || t.includes("/") || t.includes("\\")) return true
  const dot = t.lastIndexOf(".")
  if (dot > 0 && dot < t.length - 1) return PATH_EXT.has(t.slice(dot + 1).toLowerCase())
  return false
}
const matchKey = (label: string, target: any): string => {
  const t = String(target ?? "")
  return label === "imports" && isPathLikeImport(t) ? `EXACT:${t}` : normTarget(auditTarget(t))
}

// Load the parser exactly as the differential does.
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const wasmByLang: Record<string, string> = { clean: "tree-sitter-clean.wasm", hcl: "tree-sitter-hcl.wasm" }
const parser = new ParserClass()
const langWasm = await Language.load(path.join(ROOT, "wasm", wasmByLang[lang]))
parser.setLanguage(langWasm)

const analyzerClass =
  lang === "clean"
    ? (await import(path.join(ROOT, "src/ast/real-clean-analyzer.ts"))).RealCleanAnalyzer
    : (await import(path.join(ROOT, "src/ast/real-hcl-analyzer.ts"))).RealHclAnalyzer
const analyzer: any = new (analyzerClass as any)()

type Row = { label: string; from: string; target: string; file: string; dir: "MISSING" | "UNEXPLAINED"; reason: string }
const rows: Row[] = []
const labelTotals = new Map<string, number>()

for (const rel of rels2) {
  const abs = path.join(repoDir, rel)
  const content = fs.readFileSync(abs, "utf8")
  const tree = parser.parse(content)
  const root = tree.rootNode
  const result = analyzer.analyze(root, content, rel)
  const moduleName = (rel.split("/").pop() ?? lang).replace(/\.(tfvars|tofu|hcl|tf|icl|dcl)$/i, "") || lang

  let truth: { label: string; from: string; target: string }[] = []
  if (lang === "clean") truth = deriveCleanEdges(root)
  else truth = deriveHclEdges(root, moduleName)
  truth = truth.filter((t: any) => String(t.target ?? "").trim().length > 0)

  const rels = ((result.relationships ?? []) as any[])
    .map((r: any) => ({
      label: String(r.type ?? r.relationshipType ?? ""),
      target: String(r.target ?? r.to ?? r.toSymbol ?? ""),
      from: String(r.source ?? r.from ?? r.fromSymbol ?? ""),
      confidence: typeof r.confidence === "number" ? r.confidence : 1,
    }))
    .filter((r: any) => allowed.has(r.label))

  // MISSING: truth rows no analyzer edge covers (harness rule).
  for (const te of truth) {
    const hit = rels.some((r: any) => r.label === te.label && matchKey(r.label, r.target) === matchKey(te.label, te.target))
    if (!hit) {
      rows.push({ label: te.label, from: te.from, target: te.target, file: rel, dir: "MISSING", reason: "" })
      labelTotals.set(`MISSING:${te.label}`, (labelTotals.get(`MISSING:${te.label}`) ?? 0) + 1)
    }
  }
  // UNEXPLAINED: confident analyzer edges no truth row covers (harness rule:
  // rels.some includes the `te.target.includes(norm)` substring fallback for
  // non-imports labels — reproduced verbatim).
  for (const r of rels) {
    const hit = truth.some(
      (te: any) =>
        r.label === te.label &&
        (matchKey(te.label, te.target) === matchKey(r.label, r.target) ||
          (r.label !== "imports" && String(te.target).includes(normTarget(auditTarget(r.target))))),
    )
    if (!hit && r.confidence >= 0.7) {
      rows.push({ label: r.label, from: r.from, target: r.target, file: rel, dir: "UNEXPLAINED", reason: "" })
      labelTotals.set(`UNEXPLAINED:${r.label}`, (labelTotals.get(`UNEXPLAINED:${r.label}`) ?? 0) + 1)
    }
  }
  tree.delete?.()
}

// ── classification rules (lane-owned, each class named from the construct) ──
const classOf = (row: Row): string => {
  const t = row.target
  if (lang === "hcl") {
    // HCL classes: the roots the analyzer's own reference model defines.
    const root = t.split(".")[0]
    if (row.dir === "MISSING") {
      if (t.startsWith("./") || t.includes("/")) return "A-module-source-path (imports target is a PATH; truth derives it, analyzer edge spelled differently or absent)"
      return "B-other-missing"
    }
    if (["count", "each", "self", "path", "terraform"].includes(root)) return "U-builtin-namespace-uses"
    return "U-other-unexplained"
  }
  // CLEAN classes, from the analyzer's own emission sites.
  if (row.dir === "MISSING") {
    if (row.label === "instantiates") {
      // The truth walker derives instantiates for EVERY uppercase head in body
      // position; the analyzer guards on ctx.declaredConstructors / functions /
      // classes / typeDefs and declines the rest. The samples are all declined
      // applications (foreign/stdlib functions applied with an uppercase head).
      return "M-instantiates-declined-application (truth derives every uppercase body head; analyzer declines names this file does not declare — the 1,026-edge discipline)"
    }
    if (row.label === "references") {
      if (t.includes(":")) return "M-references-module-import-dependency (oracle derives import-dep references the analyzer does not emit for this form)"
      return "M-references-other"
    }
    if (row.label === "calls") return "M-calls (oracle derives a call the analyzer's in-file resolution rule declines)"
    return "M-other"
  }
  // UNEXPLAINED classes
  if (row.label === "references") {
    if (row.from === "" || row.from === undefined) return "U-references-empty-source (analyzer edge the oracle's from-space cannot mirror)"
    if (t.includes(":")) return "U-references-module-item (imports Module:item — truth derives only whole-module deps)"
    return "U-references-type/class-context (analyzer's typeRefs/classContext emission classes the oracle does not derive)"
  }
  if (row.label === "calls") {
    if (t.includes(".")) return "U-calls-qualified (qualified_identifier head; oracle emits these but from a different owner scope)"
    return "U-calls-in-file-resolved (analyzer resolves to a scoped/local target the oracle's currentFunction attribution misses)"
  }
  if (row.label === "implements") return "U-implements (instance-target/class pairing differs: analyzer guards isExternalClass; oracle pairs first constructor)"
  if (row.label === "overrides") return "U-overrides-COMPARED-NO-TRUTH (admitted label with ZERO truth — the G20 class the run itself flags)"
  if (row.label === "instantiates") return "U-instantiates (constructor application the oracle's isPatternPosition read disagrees on)"
  return "U-other"
}

for (const r of rows) r.reason = classOf(r)

// ── output ──
const byClass = new Map<string, Row[]>()
for (const r of rows) {
  const arr = byClass.get(r.reason) ?? []
  arr.push(r)
  byClass.set(r.reason, arr)
}
console.log(`# ${lang} D4 row classification — ${rows.length} rows over ${rels2.length} drawn files (${repoDir})`)
console.log(`# label totals: ${[...labelTotals.entries()].sort().map(([k, v]) => `${k}=${v}`).join(" · ")}`)
for (const [cls, arr] of [...byClass.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n## ${cls} — ${arr.length} row(s)`)
  const files = new Set(arr.map((r) => r.file))
  console.log(`   files: ${files.size} — ${[...files].slice(0, 6).join(", ")}${files.size > 6 ? ", …" : ""}`)
  const targets = new Map<string, number>()
  for (const r of arr) targets.set(r.target, (targets.get(r.target) ?? 0) + 1)
  const top = [...targets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  console.log(`   top targets: ${top.map(([t, n]) => `${t} ×${n}`).join(" · ")}`)
  for (const r of arr.slice(0, 3)) console.log(`   e.g. ${r.label} ${r.from} -> ${r.target}   (${r.file})`)
}
