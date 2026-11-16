// Dump the live analyzer payload for a fixture, so expectations are authored
// from real emission and never from memory (M14 fixture discipline).
import * as path from "path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"

async function main() {
  const rel = process.argv[2]
  if (!rel) throw new Error("usage: ts-typeparams-dump.ts <fixture-path>")
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const abs = path.join(ROOT, rel)
  const text = await (await import("node:fs")).readFileSync(abs, "utf8")
  const res: any = await ASTEngine.parseFile(abs, text)
  const symbols = res.symbols ?? []
  for (const s of symbols) {
    const tps = s.genericParameters ?? s.metadata?.typeParameters
    console.log(
      [
        s.kind,
        s.name,
        "line=" + (s.range?.startLine ?? s.line ?? "?"),
        tps ? "typeParameters=" + JSON.stringify(tps) : null,
      ]
        .filter(Boolean)
        .join(" "),
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
