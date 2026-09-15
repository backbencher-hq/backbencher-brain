// M59 (#825) — line coverage BY RELATIONSHIP TYPE.
//
// The oracle reports a language-level ratio (scala: 2,949 of 9,320 relationships
// carry a line, ~32%). A ratio cannot be acted on: it does not say WHICH kinds of
// edge are silently line-less, and the difference matters — a `calls` edge without
// a call-site line is a defect, while a `contains` edge arguably has no "call
// site" at all and should carry the declaration's line instead.
//
// This probe names them. Nothing here decides the contract; it only produces the
// per-type evidence the contract has to be written against.
//
// Usage: bun script/m59/probe-line-coverage.ts [--lang=scala] [--files=60]
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const CORPUS = "$HOME/fixtures/repositories"
const SKIP_DIRS = new Set([
  ".git", "node_modules", "dist", "build", "out", "target", ".venv", "venv",
  "__pycache__", ".gradle", ".idea", "vendor", "third_party", "tmp", ".next", "coverage",
])
const EXT: Record<string, string[]> = {
  java: [".java"], kotlin: [".kt", ".kts"], scala: [".scala"], groovy: [".groovy", ".gradle"],
}

function arg(name: string, dflt: string): string {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`))
  return a ? a.split("=")[1] : dflt
}

function walkFiles(root: string, exts: Set<string>, cap: number): string[] {
  const found: string[] = []
  const stack = [root]
  while (stack.length > 0 && found.length < cap) {
    const dir = stack.pop()!
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const e of entries) {
      if (found.length >= cap) break
      if (e.startsWith(".") || SKIP_DIRS.has(e)) continue
      const p = path.join(dir, e)
      let st
      try {
        st = readdirSync(p)
      } catch {
        if (exts.has(path.extname(e))) found.push(p)
        continue
      }
      if (Array.isArray(st)) stack.push(p)
    }
  }
  return found
}

async function main() {
  const lang = arg("lang", "scala")
  const files = Number(arg("files", "60"))
  const exts = EXT[lang]
  if (!exts) {
    console.error(`no extension map for ${lang}`)
    process.exit(1)
  }
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

  const paths = walkFiles(CORPUS, new Set(exts), files)
  const byType = new Map<string, { total: number; withLine: number; examples: string[] }>()
  let rels = 0
  let scanned = 0

  for (const f of paths) {
    let res: any
    try {
      res = await ASTEngine.parseFile(f, readFileSync(f, "utf8"))
    } catch {
      continue
    }
    scanned++
    for (const r of res?.relationships ?? []) {
      rels++
      // Sub-kind matters more than the top-level type: `references` alone covers
      // imports, declared types, return types, casts and instanceof checks, which
      // live at different emission sites. Grouping by the metadata sub-kind is
      // what makes the missing sites nameable.
      const top = String(r.type ?? r.relationshipType ?? "(untyped)")
      const sub = r.metadata?.relationshipType != null ? `:${r.metadata.relationshipType}` : r.metadata?.isImportDep ? ":import" : r.metadata?.isContained ? ":contained" : r.metadata?.isOverride ? ":override" : ""
      const t = `${top}${sub}`
      const bucket = byType.get(t) ?? { total: 0, withLine: 0, examples: [] }
      bucket.total++
      if (typeof r.line_number === "number" && r.line_number > 0) bucket.withLine++
      else if (bucket.examples.length < 3) {
        bucket.examples.push(`${String(r.source ?? r.from ?? "?").slice(0, 28)} → ${String(r.target ?? r.to ?? "?").slice(0, 28)}`)
      }
      byType.set(t, bucket)
    }
  }

  const rows = [...byType.entries()].sort((a, b) => b[1].total - a[1].total)
  console.log(`${lang}: ${scanned} files, ${rels} relationships\n`)
  console.log(`${"type".padEnd(22)} ${"total".padStart(7)} ${"withLine".padStart(9)} ${"coverage".padStart(9)}`)
  for (const [t, b] of rows) {
    const pct = ((b.withLine / b.total) * 100).toFixed(1)
    console.log(`${t.padEnd(22)} ${String(b.total).padStart(7)} ${String(b.withLine).padStart(9)} ${(pct + "%").padStart(9)}`)
    if (b.withLine < b.total) {
      for (const e of b.examples) console.log(`${"".padEnd(24)}no-line e.g. ${e}`)
    }
  }
  const totalNo = rels - rows.reduce((a, [, b]) => a + b.withLine, 0)
  console.log(`\nno line at all: ${totalNo} of ${rels}`)
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
