// Author a fixture expectation from LIVE emission (repo rule: never from
// memory). Dumps the analyzer's actual symbols / relationships for one file.
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")

async function main() {
  const file = process.argv[2]
  if (!file) throw new Error("usage: bun script/m14/tmp/clj881-dump.ts <file.clj>")
  const engine: any = await import(path.join(ROOT, "src/ast/engine.ts"))
  const parser = await engine.ASTEngine.getParser("clojure")
  const mod: any = await import(path.join(ROOT, "src/ast/real-clojure-analyzer.ts"))
  const analyzer = new mod.RealClojureAnalyzer()

  const content = readFileSync(file, "utf8")
  const res = await analyzer.analyze(parser.parse(content).rootNode, content, file)

  console.log("SYMBOLS:")
  for (const s of res.symbols ?? []) console.log(`  ${s.kind}\t${s.ownerName ? s.ownerName + "." : ""}${s.name}`)
  console.log("RELATIONSHIPS:")
  for (const r of res.relationships ?? []) console.log(`  ${r.type}\t${r.source} -> ${r.target}${r.confidence !== undefined ? " @" + r.confidence : ""}`)
  console.log("PARSE ERRORS:", res.errors?.length ?? res.parseErrors ?? 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
