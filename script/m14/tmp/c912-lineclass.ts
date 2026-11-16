// M59 (#825) residue, measured: every relationship the oracle's Tier A calls
// INCONSISTENT on the c/cpp sample — the claimed line does not carry the
// target's name as a token — enumerated IN FULL (the oracle's artifact keeps
// only a 3-per-file sample) and classified by where the name actually is:
//
//   A  name on a LATER line of the same declaration (attribute/macro token or
//      a wrapped signature on its own line: `ALWAYS_INLINE\ntype name(...)`)
//   B  name on a later line because the declaration's head spans lines
//      (`typedef CombinedAllocator<...>\n    InternalAllocator;`)
//   C  name inside the declaration's BODY (`typedef enum { ... } morder;`)
//   D  name not found in the file's text at all
//
// Usage: bun script/m14/tmp/c912-lineclass.ts
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const REPOS = "<corpus-root>/bb_tests/repositories"
const { parseFile } = await import(path.join(ROOT, "src", "ast", "engine.ts"))

const artifact = JSON.parse(
  readFileSync(path.join(ROOT, "validation/m59/results/oracle-callsite-scoped-c-cpp-f120.json"), "utf8"),
)

const token = (name: string): RegExp => new RegExp(`(^|[^\\w$])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\w$])`)

const classes: Record<string, number> = {}
const rows: string[] = []
const perLang: Record<string, { rels: number; inconsistent: number; notCheckable: number }> = {}

for (const [lang, entries] of Object.entries<any>(artifact.perFile)) {
  perLang[lang] = { rels: 0, inconsistent: 0, notCheckable: 0 }
  for (const e of entries) {
    const abs = path.join(REPOS, e.file)
    let src: string
    try {
      src = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    const lines = src.split("\n")
    const res: any = await parseFile(abs, src, { language: lang })
    for (const r of res.relationships ?? []) {
      const line = r?.line_number
      if (typeof line !== "number" || line < 1 || line > lines.length) continue
      const target = String(r?.target ?? "")
      if (!target) continue
      perLang[lang].rels++
      const text = lines[line - 1]
      if (token(target).test(text)) continue
      // not on the claimed line: is the name written anywhere near?
      let where = -1
      for (let i = line + 1; i < Math.min(lines.length, line + 6) && where < 0; i++) {
        if (token(target).test(lines[i])) where = i + 1
      }
      let cls: string
      if (where < 0) {
        const anywhere = lines.some((l) => token(target).test(l))
        cls = anywhere ? "D-elsewhere" : "D-absent"
      } else if (/[{(;]\s*$/.test(text) && where > line + 1) cls = "C-body"
      else if (where === line + 1) cls = "A-next-line"
      else cls = "B-multiline-head"
      classes[`${lang}/${cls}`] = (classes[`${lang}/${cls}`] ?? 0) + 1
      perLang[lang].inconsistent++
      if (rows.length < 60) {
        rows.push(
          `  ${lang} ${r.type} ${r.source} -> ${target}  claimed=${line}  name at=${where || "-"}  [${cls}]\n      ${line}: ${text.trim().slice(0, 88)}${where > 0 ? `\n      ${where}: ${lines[where - 1].trim().slice(0, 88)}` : ""}`,
        )
      }
    }
  }
}

console.log("=== per language (re-derived, full enumeration) ===")
for (const [lang, v] of Object.entries(perLang)) {
  console.log(`  ${lang}: rels=${v.rels} inconsistent=${v.inconsistent} (${((v.inconsistent / Math.max(1, v.rels)) * 100).toFixed(2)}%)`)
}
console.log("\n=== class distribution (lang/class: count) ===")
for (const [k, v] of Object.entries(classes).sort()) console.log(`  ${k}: ${v}`)
console.log("\n=== first rows ===")
for (const r of rows) console.log(r)
