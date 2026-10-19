/**
 * rust-d4-residual-classify — classify EVERY residual row of the rust post-fix canonical differential draws.
 *
 * Inputs: the lane-owned truth (rust-truth.ts + the contains oracle) and the real analyzer over the SAME files
 * (whole repos by default), diffed BOTH directions with the differential's own tolerance (exact, then leaf).
 * Residual rows (= MISSING: truth row the analyzer did not publish; UNEXPLAINED: analyzer row the truth did not
 * derive) are classified by pairing each residual with a counterpart on the other side that shares (target, line)
 * but differs in source spellings (a spelling contract row), or, when there is no counterpart, by the row's own
 * shape (declared pub item vs pub-use bind, nested module, route attribute, impl container, enum member, ...).
 *
 * Output: counts + samples per class + a disposition per class (analyzer-defect / truth-side gap / contract).
 * LIGHT: parse-only (one in-process parser + analyzer), no DB, no gate.
 *
 * CLI: BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/rust-d4-residual-classify.ts --repo ripgrep [--sample N]
 */
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { deriveRustContainsTruth } from "./oracles/rust-contains"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const argOf = (f: string): string | null => {
  const eq = process.argv.find((a) => a.startsWith(`${f}=`))
  if (eq) return eq.slice(f.length + 1)
  const i = process.argv.indexOf(f)
  return i >= 0 ? process.argv[i + 1] ?? null : null
}
const REPO = argOf("--repo")
const SAMPLE = Number(argOf("--sample") ?? "0")
const JSON_OUT = argOf("--json")
const LABELS = ["imports", "exports", "overrides", "contains"] as const

const files: string[] = []
if (!REPO) { console.error("rust-d4-residual-classify: --repo <name> required"); process.exit(2) }
const dir = path.join(CR, REPO)
for (const rel of execFileSync("git", ["-C", dir, "ls-files"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).split("\n").filter(Boolean)) {
  const abs = path.join(dir, rel)
  try { if (fs.statSync(abs).size > 1024 * 1024) continue } catch { continue }
  if (detectLanguageFromPath(abs) !== "rust") continue
  files.push(abs)
}
files.sort()
if (SAMPLE > 0) files.splice(SAMPLE)

const { getParser } = await import(path.join(ROOT, "script/m14/run-fixtures.ts"))
const truthMod: any = await import(path.join(ROOT, "script/m14/rust-truth.ts"))
const rustMod: any = await import(path.join(ROOT, "src/ast/real-rust-analyzer.ts"))
const parser: any = await getParser("rust")

type Row = { label: string; from: string; target: string; line: number; file: string }
const leaf = (s: string) => String(s ?? "").split("::").filter(Boolean).pop() ?? ""
const truthRows: Row[] = []
const analyzerRows: Row[] = []
const pubDecls = new Set<string>()
const pubUseBinds = new Set<string>()
const restrictedNames = new Set<string>()
const routeTargets = new Set<string>()

for (const abs of files) {
  let src = ""
  try { src = fs.readFileSync(abs, "utf8") } catch { continue }
  let tree: any
  try { tree = parser.parse(src) } catch { continue }
  try {
    const rel = path.relative(CR, abs)
    const r: any = await new rustMod.RealRustAnalyzer().analyze(tree.rootNode, src, rel)
    for (const row of r.relationships ?? []) {
      const t = String(row.type)
      if (!(LABELS as readonly string[]).includes(t)) continue
      analyzerRows.push({ label: t, from: String(row.source ?? ""), target: String(row.target ?? ""), line: Number(row.line_number ?? 0), file: rel })
    }
    for (const e of truthMod.deriveRustImportsTruth(tree.rootNode)) truthRows.push({ label: e.label, from: e.from, target: e.target, line: 0, file: rel })
    for (const e of truthMod.deriveRustExportsTruth(tree.rootNode)) truthRows.push({ label: e.label, from: e.from, target: e.target, line: 0, file: rel })
    for (const e of truthMod.deriveRustOverridesTruth(tree.rootNode)) truthRows.push({ label: e.label, from: e.from, target: e.target, line: 0, file: rel })
    for (const e of deriveRustContainsTruth(tree.rootNode) as any[]) truthRows.push({ label: e.label ?? "contains", from: e.from ?? e.source ?? "", target: e.target, line: 0, file: rel })
    // file facts for the export classifier: top-level pub items, pub-use binds, restricted visibility, routes
    const walk = (n: any, depth: number) => {
      if (n.type === "source_file" || n.type === "declaration_list") {
        for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i), depth + 1)
      }
      const t = String(n.type)
      if (["struct_item", "enum_item", "trait_item", "function_item", "mod_item", "type_item", "const_item", "static_item", "union_item"].includes(t)) {
        let vis = ""
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c && c.type === "visibility_modifier") vis = String(c.text) }
        const nm = n.childForFieldName?.("name") ?? n.namedChild(0)
        if (nm && depth === 1) {
          if (vis === "pub") pubDecls.add(String(nm.text))
          else if (vis.startsWith("pub(")) restrictedNames.add(String(nm.text))
        }
      }
      if (t === "use_declaration") {
        const txt = String(n.text ?? "")
        if (txt.startsWith("pub use")) {
          const stack = [n]
          while (stack.length > 0) {
            const m = stack.pop()!
            if (m.type === "use_as_clause") { const al = m.childForFieldName?.("alias") ?? m.namedChild(m.namedChildCount - 1); if (al) pubUseBinds.add(String(al.text)) }
            else if (m.type === "identifier" || m.type === "type_identifier") pubUseBinds.add(String(m.text))
            for (let j = 0; j < m.namedChildCount; j++) stack.push(m.namedChild(j))
          }
        }
      }
      if (t === "attribute_item") {
        const txt = String(n.text ?? "")
        for (const verb of ["get", "post", "put", "delete", "patch", "head", "options", "trace", "route"]) {
          if (txt.startsWith("#[" + verb) && (txt[verb.length + 2] === "(" || txt[verb.length + 2] === " ")) {
            const q1 = txt.indexOf('"'), q2 = q1 >= 0 ? txt.indexOf('"', q1 + 1) : -1
            if (q2 > q1 + 1) routeTargets.add(txt.slice(q1 + 1, q2))
          }
        }
      }
    }
    walk(tree.rootNode, 0)
  } finally { tree.delete?.() }
}

// DIFFERENTIAL-MATCHED SEMANTICS (script/m14/differential.ts:25290-25340): a row matches on LABEL + target
// only, where the target is normalised to its LAST dot/`::` segment (imports use the same rule; path-like
// import specifiers are compared exactly, which rust's `a::b` module paths are not). `from` is NOT part of
// the match, so a source-spelling difference can never appear as a residual — only a missing/extra TARGET.
const normTarget = (t: string): string => {
  const parts = String(t ?? "").split(/::|\./).filter(Boolean)
  return parts[parts.length - 1] ?? String(t ?? "")
}
const pathLikeImport = (t: string): boolean => {
  if (t.length === 0) return false
  if (t.startsWith(".") || t.includes("/") || t.includes("\\")) return true
  const dot = t.lastIndexOf(".")
  if (dot > 0 && dot < t.length - 1) return ["rs"].includes(t.slice(dot + 1).toLowerCase())
  return false
}
const matchT = (label: string, target: string): string => (label === "imports" && pathLikeImport(target) ? `EXACT:${target}` : normTarget(target))
const perFile = (rows: Row[]) => {
  const m = new Map<string, Row[]>()
  for (const r of rows) { const k = r.file; (m.get(k) ?? m.set(k, []).get(k)!).push(r) }
  return m
}
const truthByFile = perFile(truthRows)
const anaByFile = perFile(analyzerRows)
const missing: Row[] = []
const unexplained: Row[] = []
for (const [file, trs] of truthByFile) {
  const ars = anaByFile.get(file) ?? []
  const aKeys = new Set(ars.map((r) => `${r.label}\u0000${matchT(r.label, r.target)}`))
  for (const te of trs) if (!aKeys.has(`${te.label}\u0000${matchT(te.label, te.target)}`)) missing.push(te)
}
for (const [file, ars] of anaByFile) {
  const trs = truthByFile.get(file) ?? []
  const tKeys = new Set(trs.map((r) => `${r.label}\u0000${matchT(r.label, r.target)}`))
  for (const r of ars) {
    const hit = tKeys.has(`${r.label}\u0000${matchT(r.label, r.target)}`) ||
      (r.label !== "imports" && trs.some((te) => te.label === r.label && te.target.includes(normTarget(r.target))))
    if (!hit) unexplained.push(r)
  }
}

const counterparts = (row: Row, side: Row[]): Row | undefined => side.find((x) => x.label === row.label && x.file === row.file && matchT(x.label, x.target) === matchT(row.label, row.target))
const classify = (row: Row, kind: "missing" | "unexplained"): string => {
  const other = counterparts(row, kind === "missing" ? analyzerRows : truthRows)
  if (other) {
    if (row.label === "overrides") return "overrides.impl-target-spelling"
    if (row.label === "imports") return "imports.scope-source-spelling"
    if (row.label === "exports") return "exports.publisher-spelling"
    if (row.label === "contains") return "contains.source-spelling"
  }
  switch (row.label) {
    case "imports":
      if (row.target.includes("::") && row.from !== "(file)" && row.from !== "") return kind === "unexplained" ? "imports.function-scope-source-contract" : "imports.truth-scope-row"
      return kind === "unexplained" ? "imports.analyzer-row-truth-absent" : "imports.truth-row-analyzer-absent"
    case "exports":
      if (routeTargets.has(row.target) || row.target.startsWith("/")) return "exports.route-attribute-truth-gap"
      if (kind === "missing") {
        if (pubUseBinds.has(row.target)) return "exports.pub-use-bound-not-published"
        if (pubDecls.has(row.target)) return "exports.declared-pub-item-not-published"
        if (restrictedNames.has(row.target)) return "exports.restricted-visibility-truth-overreach"
        return "exports.truth-row-analyzer-absent"
      }
      return "exports.analyzer-row-truth-absent"
    case "overrides":
      if (kind === "unexplained") return "overrides.analyzer-source-spelling"
      return "overrides.truth-source-spelling"
    case "contains":
      if (kind === "unexplained") {
        if (row.from.endsWith("::impl")) return "contains.impl-container-row"
        return "contains.analyzer-row-truth-absent"
      }
      return "contains.truth-row-analyzer-absent"
  }
  return `${row.label}.other`
}
const classes: Record<string, { missing: number; unexplained: number; samples: string[] }> = {}
const bump = (row: Row, kind: "missing" | "unexplained") => {
  const c = classify(row, kind)
  const e = (classes[c] ??= { missing: 0, unexplained: 0, samples: [] })
  e[kind]++
  if (e.samples.length < 6) e.samples.push(`${kind}: ${row.file}:${row.line && row.line > 0 ? row.line + " " : ""}${row.from} -> ${row.target}`)
}
for (const r of missing) bump(r, "missing")
for (const r of unexplained) bump(r, "unexplained")
const report = { schemaVersion: 1, instrument: "script/m14/rust-d4-residual-classify.ts", repo: REPO, files: files.length, rows: { truth: truthRows.length, analyzer: analyzerRows.length, missing: missing.length, unexplained: unexplained.length }, classes }
const out = JSON_OUT ?? path.join(ROOT, ".tmp-rust", `rust-d4-residuals-${REPO}.json`)
fs.writeFileSync(out, JSON.stringify(report, null, 1) + "\n")
console.log(`rust-d4-residual-classify — ${REPO}: ${files.length} files · truth ${truthRows.length} · analyzer ${analyzerRows.length} · MISSING ${missing.length} · unexplained ${unexplained.length}`)
for (const [c, e] of Object.entries(classes).sort((a, b) => (b[1].missing + b[1].unexplained) - (a[1].missing + a[1].unexplained))) {
  console.log(`  ${String(e.missing + e.unexplained).padStart(5)}  missing=${String(e.missing).padStart(3)} unexplained=${String(e.unexplained).padStart(4)}  ${c}`)
  for (const s of e.samples.slice(0, 2)) console.log(`         ${s}`)
}
