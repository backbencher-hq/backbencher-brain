// #921 probe (dump-driven): for a sample of the residue rows, print the CONTAINING
// side from the analyzer's own objects — the owner symbol (does it exist at all?),
// the child symbol, and the lines where the child's name is really written.
import { ASTEngine } from "../../../src/ast/engine"
import { readFileSync } from "node:fs"

const R = "/home/ishaq2321/bb_tests/repositories"
const rows: Array<{ lang: string; file: string; target: string; claimedLine: number; sourceLine: string }> =
  JSON.parse(readFileSync("/tmp/m59-dump.json", "utf8"))

// Deterministic, one per language bucket: iterate the dump in order, group by
// (lang, file), take the first 4 files per language with all their rows.
const byLang = new Map<string, Map<string, typeof rows>>()
for (const r of rows) {
  if (!byLang.has(r.lang)) byLang.set(r.lang, new Map())
  const m = byLang.get(r.lang)!
  if (!m.has(r.file)) m.set(r.file, [])
  m.get(r.file)!.push(r)
}

for (const [lang, files] of byLang) {
  for (const [file, rs] of [...files.entries()].slice(0, 3)) {
    const abs = `${R}/${file}`
    const text = readFileSync(abs, "utf8")
    const res: any = await ASTEngine.parseFile(abs, text)
    const lines = text.split("\n")
    console.log(`\n=== [oracle lane ${lang}] ${file} — product dispatch: ${res.language}, ${(res.symbols ?? []).length} symbols, ${(res.relationships ?? []).length} rels`)
    const ownerNames = new Set((res.symbols ?? []).map((s: any) => s.name))
    for (const r of rs.slice(0, 4)) {
      const syms = (res.symbols ?? []).filter((s: any) => s.name === r.target)
      const rels = (res.relationships ?? []).filter((x: any) => x.type === "contains" && x.target === r.target)
      const at: number[] = []
      lines.forEach((l, i) => { if (new RegExp(`\\b${r.target}\\b`).test(l)) at.push(i + 1) })
      console.log(`  -- ${r.target} @claimed ${r.claimedLine} (${JSON.stringify(r.sourceLine.slice(0, 60))})`)
      console.log(`     name written on: ${at.slice(0, 6).join(", ")}`)
      for (const s of syms) {
        console.log(`     symbol: kind=${s.kind} owner=${JSON.stringify(s.ownerName)} scope=${JSON.stringify(s.scope)} range.startLine=${s.range?.startLine} nameLine-meta=${JSON.stringify((s.metadata ?? {}).nameLine)}`)
      }
      for (const x of rels) {
        const src = String(x.source)
        const srcSym = (res.symbols ?? []).find((s: any) => s.name === src)
        console.log(`     contains ${src} -> ${x.target} @${x.line_number} | owner symbol exists: ${ownerNames.has(src)} (kind=${srcSym?.kind ?? "-"} startLine=${srcSym?.range?.startLine ?? "-"})`)
      }
    }
  }
}
