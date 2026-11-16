// Dump every relationship (with its line) for a fixture, so an expectation can
// be authored against the fixture's OWN TEXT. Reads the analyzer (the thing on
// trial) but asserts nothing: it prints, the author adjudicates.
import { readFileSync } from "node:fs"
import path from "node:path"

// `--root=` lets this run against a HEAD worktree, so a pre-fix value in a
// fixture's forbid list is MEASURED rather than reconstructed.
const ROOT =
  process.argv.find((a) => a.startsWith("--root="))?.slice("--root=".length) ??
  "<corpus-root>/mcp/backbencher-brain"
const rel = process.argv.find((a) => a.startsWith("--file="))?.slice("--file=".length) ?? ""

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const abs = path.join(ROOT, rel)
  const text = readFileSync(abs, "utf8")
  const lines = text.split("\n")
  const res: any = await ASTEngine.parseFile(abs, text)
  console.log(`=== ${rel} — ${(res?.relationships ?? []).length} relationships`)
  for (const r of res?.relationships ?? []) {
    const ln = typeof r.line_number === "number" ? r.line_number : null
    const src = ln ? (lines[ln - 1] ?? "").trim().slice(0, 64) : ""
    console.log(
      `${String(r.type).padEnd(13)} ${String(r.source).padEnd(22)} -> ${String(r.target).padEnd(30)} line=${String(ln).padStart(3)}  | ${src}`,
    )
  }
  console.log(`--- symbols: ${(res?.symbols ?? []).length}`)
  for (const s of res?.symbols ?? []) {
    console.log(`  ${String(s.kind).padEnd(10)} ${String(s.name).padEnd(20)} line=${s.range?.startLine}`)
  }
}

main()
