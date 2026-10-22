#!/usr/bin/env bun
/**
 * HTML EXTENDED-SEAM PROBE — DOES EACH OPEN TYPE ACTUALLY REACH AN `.html` PAYLOAD?
 *
 * ## THE QUESTION, AND WHY IT IS NOT A FIXTURE YET
 *
 * The html lane reads 9/14 and the five open types are `decorates`, `implements`, `renders`,
 * `mixes_in` and `part_of`. Each of them is a type HTML'S OWN SOURCE cannot construct — the html
 * grammar is a markup grammar and declares 19 distinct named node types, none of which is a type
 * declaration, a member declaration, a supertype clause or a constructor. But the html analyzer is
 * a CONTAINER: it hands every `<script>`/`<style>` block to the javascript / typescript / css
 * analyzer and copies the delegate's relationships verbatim (`src/ast/real-html-analyzer.ts:2282`).
 *
 * ⇒ THE QUESTION IS ABOUT THE SEAM: "can an HTML document express `decorates`?" is a question
 * about what the seam publishes, and the only honest way to answer it is to PLANT the construct in
 * a document and read what the PRODUCTION path (`ASTEngine.parseFile`) publishes.
 *
 * ⇒ AND THE ANSWER HAS THREE POSSIBLE SHAPES, AND THE PROBE REPORTS WHICH ONE EACH IS:
 *   PUBLISHED  the type arrives on the document's relationship list (and, for the delegated ones,
 *              it arrives TAGGED `htmlEmbedded` — the seam's own origin disclosure);
 *   DROPPED    the construct parses (the delegate sees it) but NO relationship of that type is
 *              published ⇒ THE SEAM LOSES IT, and that is a lane-owned defect;
 *   ABSENT     the construct does not parse at all in the block's own grammar ⇒ the seam had
 *              nothing to lose, and the type's fate is the DELEGATE's fate, not html's.
 *
 * ## WHAT IT DOES NOT CLAIM
 *
 * It claims what the production path publishes for a PLANTED document. It does not claim a corpus
 * count — `script/m14/html-extended-construct-probe.ts` owns that, over the admitted population.
 * And it does not claim resolution: the arm owns resolution.
 *
 * RUN: bun script/m14/html-extended-seam-probe.ts [--json <out.json>]
 */
import { writeFileSync, mkdirSync, rmSync } from "node:fs"
import { resolve, join, dirname } from "node:path"
import { ASTEngine } from "../../src/ast/engine"

const ROOT = resolve(import.meta.dir, "../..")
const argv = process.argv.slice(2)
// THE `--flag=value` FORM AND THE `--flag value` FORM BOTH WORK. The first version of this
// script accepted only `--flag=value`, and the run line in its own header said `--flag <value>`
// — so the documented invocation SILENTLY wrote no artifact at all, and the run looked like it
// had produced a measurement because it had produced its console output. A measurement whose
// artifact is missing is a measurement nobody can cite.
const argOf = (name: string, dflt: string): string => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  if (hit) return hit.slice(name.length + 3)
  const i = argv.indexOf(`--${name}`)
  if (i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith("--")) return argv[i + 1]
  return dflt
}
const JSON_OUT = argOf("json", "")
const TMP = join(ROOT, ".tmp-html-seam-probe")

type Planted = {
  id: string
  type: string
  /** the block's language, which is what the delegate will be */
  lang: "js" | "ts" | "tsx"
  /** the script body */
  body: string
  /** what the block is expected to make the delegate publish */
  expect: string
}

const PLANTS: Planted[] = [
  {
    id: "decorates", type: "decorates", lang: "js",
    body: `
      function sealed(target) { return target }
      @sealed
      class Decorated {
        method() { return 1 }
      }
    `,
    expect: "a `decorates` row from the decorated declaration to the decorator",
  },
  {
    id: "implements", type: "implements", lang: "ts",
    body: `
      interface Shape { area(): number }
      class Square implements Shape {
        area(): number { return 1 }
      }
    `,
    expect: "an `implements` row from the class to the interface",
  },
  {
    id: "renders", type: "renders", lang: "js",
    body: `
      function Button() { return null }
      function Panel() {
        return <Button />
      }
    `,
    expect: "a `renders` row from the rendering component to the rendered component",
  },
  {
    id: "mixes_in", type: "mixes_in", lang: "js",
    body: `
      const Timestamped = (Base) => class extends Base {}
      class Record extends Timestamped(Base) {}
      class Base {}
    `,
    expect: "a `mixes_in` row from the class to the mixin",
  },
  {
    id: "part_of", type: "part_of", lang: "js",
    body: `
      part 'other.js'
      export const x = 1
    `,
    expect: "a `part_of` row — javascript has NO part directive, so this is the ABSENT shape",
  },
]

const LANG_ATTR: Record<string, string> = { js: "", ts: ' lang="ts"', tsx: ' lang="tsx"' }

async function main(): Promise<void> {
  mkdirSync(TMP, { recursive: true })
  const results: any[] = []
  for (const plant of PLANTS) {
    const html = `<!doctype html>
<html lang="en">
<head><title>plant</title></head>
<body>
  <main id="app">
    <script${LANG_ATTR[plant.lang]}>
${plant.body}
    </script>
  </main>
</body>
</html>
`
    const file = join(TMP, `${plant.id}.html`)
    writeFileSync(file, html)
    let res: any = null
    let error: string | null = null
    try {
      res = await ASTEngine.parseFile(file, html)
    } catch (e: any) {
      error = String(e).slice(0, 200)
    }
    const rels = (res?.relationships ?? []) as any[]
    const byType: Record<string, number> = {}
    const embeddedByType: Record<string, number> = {}
    for (const r of rels) {
      byType[r.type] = (byType[r.type] ?? 0) + 1
      if (r.metadata?.htmlEmbedded) embeddedByType[r.type] = (embeddedByType[r.type] ?? 0) + 1
    }
    const ofType = rels.filter((r) => r.type === plant.type)
    const shape = ofType.length > 0 ? "PUBLISHED" : (rels.length > 0 ? "DROPPED" : "ABSENT")
    results.push({
      id: plant.id,
      type: plant.type,
      lang: plant.lang,
      expectation: plant.expect,
      shape,
      error,
      relationshipsByType: byType,
      embeddedByType,
      rowsOfThisType: ofType.map((r) => ({
        source: r.source, target: r.target, type: r.type,
        htmlEmbedded: r.metadata?.htmlEmbedded === true,
        embeddedLang: r.metadata?.embeddedLang,
        line: r.line_number,
      })),
    })
    console.log(`── ${plant.id} (${plant.lang}) — ${shape}`)
    console.log(`   expectation: ${plant.expect}`)
    if (error) console.log(`   ERROR: ${error}`)
    console.log(`   relationships by type: ${JSON.stringify(byType)}`)
    console.log(`   of them tagged htmlEmbedded: ${JSON.stringify(embeddedByType)}`)
    for (const r of ofType) {
      console.log(`   ROW  ${r.type}  ${r.source} -> ${r.target}  htmlEmbedded=${r.metadata?.htmlEmbedded === true} lang=${r.metadata?.embeddedLang ?? "-"} line=${r.line_number ?? "-"}`)
    }
  }
  try { rmSync(TMP, { recursive: true, force: true }) } catch { /* the probe's own scratch */ }

  if (JSON_OUT) {
    mkdirSync(dirname(JSON_OUT), { recursive: true })
    writeFileSync(JSON_OUT, JSON.stringify({
      instrument: "html-extended-seam-probe",
      command: `bun run script/m14/html-extended-seam-probe.ts --json ${JSON_OUT}`,
      path: "ASTEngine.parseFile — the PRODUCTION path (it builds the inline <script>/<style> context)",
      results,
    }, null, 2))
    console.log()
    console.log(`WROTE ${JSON_OUT}`)
  }
}

await main()
