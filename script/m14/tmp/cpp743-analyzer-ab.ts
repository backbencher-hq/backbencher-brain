// #743 cpp port: ANALYZER-level A/B. The F5 oracle walks the same tree the
// analyzer does, so it cannot tell a removed phantom edge from a lost real one:
// both sides move together and still read MISSING=0. This probe dumps the
// analyzer's OWN output (positions included) through the production entry, so
// two grammars can be compared edge by edge.
//
// Usage: bun script/m14/tmp/cpp743-analyzer-ab.ts <repoDir> [limit]
import { readFileSync } from "node:fs"
import { execSync } from "node:child_process"
import path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const { parseFile } = await import(path.join(ROOT, "src", "ast", "engine.ts"))

const repoDir = process.argv[2]
const limit = process.argv[3] ? Number(process.argv[3]) : 0
if (!repoDir) {
  console.error("usage: cpp743-analyzer-ab.ts <repoDir> [limit]")
  process.exit(2)
}
const EXTS = new Set([".cc", ".cpp", ".cxx", ".h", ".hpp", ".hh"])
let files = execSync("git ls-files", { cwd: repoDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  .split("\n")
  .map((f) => f.trim())
  .filter((f) => f.length > 0 && EXTS.has(path.extname(f)))
  .sort()
if (limit > 0) files = files.slice(0, limit)

const out: string[] = []
for (const f of files) {
  const content = readFileSync(path.join(repoDir, f), "utf8")
  try {
    const r: any = await parseFile(f, content)
    out.push(`== ${f}`)
    const syms = (r.symbols ?? []).map(
      (s: any) => `SYM ${s.kind} ${s.name} @${s.range?.startLine}:${s.range?.startColumn} scope=${s.scope ?? ""}`,
    )
    const rels = (r.relationships ?? []).map((x: any) => {
      const src = x.source ?? x.from ?? x.fromSymbol ?? "?"
      const tgt = x.target ?? x.to ?? x.toSymbol ?? "?"
      const rt = (x.metadata ?? {}).relationshipType ?? x.type ?? x.relationshipType ?? "?"
      return `REL ${rt} ${src} -> ${tgt}`
    })
    out.push(...syms.sort(), ...rels.sort())
  } catch (e) {
    out.push(`== ${f} THREW ${(e as Error).message}`)
  }
}
process.stdout.write(out.join("\n") + "\n")
