// M59 (#861) change-surface sweep. Dumps every symbol and relationship for the
// seven web corpus repos the F5 differential uses (primary + second per web
// language), through the REAL SFC-aware entry point (ASTEngine.parseFile), so
// .vue/.svelte script blocks are measured the way production measures them.
// Run once with --root=<pre-fix tree> and once against the working tree, then
// diff with script/m14/tmp/866-sweep-diff.ts.
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT =
  process.argv.find((a) => a.startsWith("--root="))?.slice("--root=".length) ??
  "<corpus-root>/mcp/backbencher-brain"
const OUT = process.argv.find((a) => a.startsWith("--out="))?.slice("--out=".length) ?? "/tmp/861-sweep.json"

const LANGS: Array<{ lang: string; exts: string[]; repos: string[] }> = [
  { lang: "typescript", exts: [".ts", ".tsx"], repos: ["vue-core", "element-plus"] },
  { lang: "javascript", exts: [".js", ".jsx", ".mjs", ".cjs"], repos: ["grails-core", "lodash"] },
  { lang: "vue", exts: [".vue"], repos: ["element-plus", "vue-element-admin"] },
  { lang: "svelte", exts: [".svelte"], repos: ["svelte", "shadcn-svelte"] },
]
const CORPUS_ROOT = "<corpus-root>/bb_tests/repositories"

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === "dist" || e.name === "build" || e.name === ".svelte-kit") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, exts, out)
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p)
  }
  return out
}

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const dump: Record<string, { symbols: string[]; rels: string[] }> = {}
  let files = 0
  for (const l of LANGS) {
    const seen = new Set<string>()
    for (const repo of l.repos) {
      for (const f of walk(path.join(CORPUS_ROOT, repo), l.exts).sort()) {
        const rel = `${l.lang}|${path.relative(CORPUS_ROOT, f)}`
        if (seen.has(rel)) continue
        seen.add(rel)
        let text: string
        try {
          text = readFileSync(f, "utf8")
        } catch {
          continue
        }
        let res: any
        try {
          res = await ASTEngine.parseFile(f, text)
        } catch {
          continue
        }
        const symbols = (res.symbols ?? []).map(
          (s: any) => `S|${s.name}|${s.kind}|${s.ownerName ?? "-"}|${s.range?.startLine ?? "-"}`,
        )
        const rels = (res.relationships ?? []).map(
          (r: any) =>
            `R|${r.type}|${typeof r.source === "object" ? r.source?.name : r.source}|${
              typeof r.target === "object" ? r.target?.name : r.target
            }|${r.line_number ?? "-"}`,
        )
        symbols.sort()
        rels.sort()
        dump[rel] = { symbols, rels }
        files++
        if (files % 500 === 0) console.error(`  ...${files} files`)
      }
    }
  }
  writeFileSync(OUT, JSON.stringify(dump))
  console.error(`ROOT=${ROOT}`)
  console.error(`files=${files}`)
  console.error(`out=${OUT}`)
}

main()
