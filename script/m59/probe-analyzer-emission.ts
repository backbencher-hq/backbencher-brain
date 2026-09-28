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

// FIXED 2026-09-15 (M49 W19): the java row pointed at
// `Exposed/src/main/java/org/jetbrains/exposed/sql/Table.kt` — a Kotlin file that
// does not exist at that path — so the probe reported `java: SKIP` and the
// java/kotlin/groovy rows of M59's P0 instrument measured nothing at all. Every
// row below is a real file in the named corpus, and the JVM family now has one
// call-rich file per language so the line semantics are comparable across them.
const CANDIDATES: Array<{ lang: string; rel: string }> = [
  { lang: "java", rel: "cats-effect/core/jvm/src/main/java/cats/effect/Signal.java" },
  { lang: "kotlin", rel: "kotlinx-coroutines/kotlinx-coroutines-core/common/src/flow/Flow.kt" },
  { lang: "groovy", rel: "grails-core/grails-test-core/src/main/groovy/org/grails/test/io/MultiplexingOutputStream.groovy" },
  { lang: "scala", rel: "cats-effect/example/native/src/main/scala/cats/effect/example/Example.scala" },
  { lang: "xml", rel: "grails-core/grails-test-suite-uber/src/test/resources/org/grails/commons/test-web.xml" },
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
    // Multiplicity check (#822's shape): if many distinct calls share one line
    // number, the analyzer is recording the enclosing expression's start rather
    // than each call node's own line — the defect #825 documents in scala, which
    // the other languages would otherwise copy.
    const lines = withLine.map((r) => r.line_number as number)
    const distinct = new Set(lines)
    const mult = new Map<number, number>()
    for (const l of lines) mult.set(l, (mult.get(l) ?? 0) + 1)
    const worst = [...mult.entries()].sort((a, b) => b[1] - a[1])[0]
    console.log(
      `    distinct lines=${distinct.size}/${withLine.length}  worst multiplicity=${worst ? `${worst[1]} rels on line ${worst[0]}` : "n/a"}`,
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
