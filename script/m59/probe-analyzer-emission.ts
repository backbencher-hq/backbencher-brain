// script/m59/probe-analyzer-emission.ts — M59.P0
// Validates the analyzer seam: ASTEngine.parseFile() answers "what does the
// analyzer emit?" WITHOUT the store, so the store's hardcoded 0
// (src/ast/parallel-indexer.ts:2559) cannot mask the answer.
//
// Reads real files from $HOME/fixtures/repositories (the corpus the
// milestones name), one per language, and reports how many relationships carry
// a numeric line_number. No tool code is reused for the verdict.

import { readFileSync, existsSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const CORPUS = "$HOME/fixtures/repositories"

const CANDIDATES: Array<{ lang: string; rel: string }> = [
  { lang: "scala", rel: "cats-effect/example/native/src/main/scala/cats/effect/example/Example.scala" },
  { lang: "java", rel: "Exposed/src/main/java/org/jetbrains/exposed/sql/Table.kt" },
]

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

  for (const c of CANDIDATES) {
    const p = path.join(CORPUS, c.rel)
    if (!existsSync(p)) {
      console.log(`${c.lang}: SKIP (not found) ${p}`)
      continue
    }
    const content = readFileSync(p, "utf8")
    const t0 = Date.now()
    let res: any
    try {
      res = await ASTEngine.parseFile(p, content)
    } catch (e: any) {
      console.log(`${c.lang}: THROW ${e?.message}`)
      continue
    }
    const rels: any[] = res?.relationships ?? []
    const withLine = rels.filter((r) => typeof r.line_number === "number" && r.line_number > 0)
    console.log(
      `${c.lang}: language=${res?.language} symbols=${res?.symbols?.length ?? 0} rels=${rels.length} withLine=${withLine.length} (${Date.now() - t0}ms)`,
    )
    for (const r of rels.slice(0, 6)) {
      console.log(
        `    type=${r.type ?? r.relationshipType ?? "?"} src=${String(r.source ?? r.from ?? "?").slice(0, 40)} tgt=${String(r.target ?? r.to ?? "?").slice(0, 40)} line_number=${JSON.stringify(r.line_number)}`,
      )
    }
  }
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
