/**
 * rust-truth-verify — lane-owned differential PRE-CHECK for rust-truth.ts.
 *
 * Runs the three independent derivations and the real analyzer over the same files and reports, per label,
 * matched / missing-in-analyzer (truth edge the analyzer did not publish) / unexplained (analyzer edge the
 * truth did not derive) / matched-with-leaf-only. Scoped: fixture files by default, or `--repo <name>` for a
 * corpus sample. This is the evidence the Lead's differential wiring will make corpus-wide; it does NOT
 * replace the differential.
 *
 * CLI: BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/rust-truth-verify.ts [--repo ripgrep --sample 100] [--json=path] [--text]
 */
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"

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
const TEXT = process.argv.includes("--text")
const LABELS = ["imports", "exports", "overrides"] as const

const files: Array<{ abs: string }> = []
if (REPO) {
  const dir = path.join(CR, REPO)
  const tracked = execFileSync("git", ["-C", dir, "ls-files"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).split("\n").filter(Boolean)
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (fs.statSync(abs).size > 1024 * 1024) continue } catch { continue }
    if (detectLanguageFromPath(abs) !== "rust") continue
    files.push({ abs })
  }
  files.sort((a, b) => (a.abs < b.abs ? -1 : 1))
  if (SAMPLE > 0) files.splice(SAMPLE)
} else {
  const dir = path.join(ROOT, "validation", "m14", "fixtures", "rust")
  for (const f of fs.readdirSync(dir).sort()) if (f.endsWith(".rs")) files.push({ abs: path.join(dir, f) })
}

const { getParser } = await import(path.join(ROOT, "script/m14/run-fixtures.ts"))
const truthMod: any = await import(path.join(ROOT, "script/m14/rust-truth.ts"))
const rustMod: any = await import(path.join(ROOT, "src/ast/real-rust-analyzer.ts"))
const parser: any = await getParser("rust")

const norm = (s: string) => String(s ?? "")
const leafOf = (s: string) => norm(s).split("::").filter(Boolean).pop() ?? ""
const keyExact = (e: any) => `${e.label ?? e.type}\u0000${norm(e.from ?? e.source)}\u0000${norm(e.target)}`
const keyLeaf = (e: any) => `${e.label ?? e.type}\u0000${leafOf(e.from ?? e.source)}\u0000${leafOf(e.target)}`

const stats: Record<string, { truth: number; analyzer: number; matched: number; matchedLeafOnly: number; missing: string[]; unexplained: string[] }> = {}
for (const l of LABELS) stats[l] = { truth: 0, analyzer: 0, matched: 0, matchedLeafOnly: 0, missing: [], unexplained: [] }

for (const f of files) {
  let src = ""
  try { src = fs.readFileSync(f.abs, "utf8") } catch { continue }
  let tree: any
  try { tree = parser.parse(src) } catch { continue }
  try {
    const rel = path.relative(CR, f.abs)
    const r: any = await new rustMod.RealRustAnalyzer().analyze(tree.rootNode, src, rel)
    const truth = [
      ...truthMod.deriveRustImportsTruth(tree.rootNode),
      ...truthMod.deriveRustExportsTruth(tree.rootNode),
      ...truthMod.deriveRustOverridesTruth(tree.rootNode),
    ]
    const analyzerRows = (r.relationships ?? []).filter((x: any) => (LABELS as readonly string[]).includes(String(x.type)))
    const byExact = new Map<string, any>()
    const byLeaf = new Map<string, any>()
    for (const t of truth) { if (!byExact.has(keyExact(t))) byExact.set(keyExact(t), t); if (!byLeaf.has(keyLeaf(t))) byLeaf.set(keyLeaf(t), t) }
    const usedTruth = new Set<string>()
    for (const row of analyzerRows) {
      const s = stats[String(row.type)]; if (!s) continue
      s.analyzer++
      const k = keyExact(row)
      if (byExact.has(k) && !usedTruth.has(k)) { s.matched++; usedTruth.add(k); continue }
      const kl = keyLeaf(row)
      if (byLeaf.has(kl) && !usedTruth.has(kl)) { s.matchedLeafOnly++; usedTruth.add(kl); continue }
      if (s.unexplained.length < 15) s.unexplained.push(`${path.relative(CR, f.abs)}:${row.line_number} ${row.source} -> ${row.target}`)
    }
    for (const t of truth) {
      const s = stats[t.label]; if (!s) continue
      s.truth++
      if (usedTruth.has(keyExact(t)) || usedTruth.has(keyLeaf(t))) continue
      // a truth row may match an analyzer row with the same leaf spellings that was consumed by another
      const anyAnalyzer = analyzerRows.some((row: any) => String(row.type) === t.label && keyLeaf(row) === keyLeaf(t))
      if (anyAnalyzer) { s.matchedLeafOnly++; usedTruth.add(keyExact(t)); continue }
      if (s.missing.length < 15) s.missing.push(`${path.relative(CR, f.abs)} ${t.from} -> ${t.target}`)
    }
  } finally { tree.delete?.() }
}
const report = { schemaVersion: 1, instrument: "script/m14/rust-truth-verify.ts", scope: REPO ? `repo ${REPO} (${files.length} files)` : `fixtures (${files.length} files)`, labels: Object.fromEntries(LABELS.map((l) => { const s = stats[l]; return [l, { truth: s.truth, analyzer: s.analyzer, matched: s.matched, matchedLeafOnly: s.matchedLeafOnly, missingInAnalyzer: s.missing.length, unexplainedInTruth: s.unexplained.length, missingSamples: s.missing, unexplainedSamples: s.unexplained }] })) }
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 1) + "\n")
if (TEXT || !JSON_OUT) {
  console.log(`rust-truth-verify — ${report.scope}`)
  for (const l of LABELS) { const s = report.labels[l]; console.log(`  ${l}: truth ${s.truth} · analyzer ${s.analyzer} · matched ${s.matched} (+leaf ${s.matchedLeafOnly}) · missingInAnalyzer ${s.missingInAnalyzer} · unexplainedInTruth ${s.unexplainedInTruth}`) }
  for (const l of LABELS) { const s = report.labels[l]; if (s.missingSamples.length) console.log(`  MISSING(${l}): ${JSON.stringify(s.missingSamples.slice(0, 5))}`); if (s.unexplainedSamples.length) console.log(`  UNEXPLAINED(${l}): ${JSON.stringify(s.unexplainedSamples.slice(0, 5))}`) }
}
