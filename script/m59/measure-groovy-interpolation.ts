// M59: Groovy GString interpolation — the surface size of a graph gap.
//
// The pinned grammar inherits Java's `_string_literal`, whose `string_fragment`
// token matches every character except `"` and `\` — so `${…}` and `$name` are
// swallowed as ONE OPAQUE FRAGMENT. Nothing reaches the analyzer as an
// expression, so no interpolated identifier becomes a `uses` edge, while dart,
// php and ruby analyzers all emit interpolation reads (each has a
// `drop-interp-read-uses` mutant proving it). Measured here, not argued.
//
// Usage: bun script/m59/measure-groovy-interpolation.ts [--repo NAME]
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { ASTEngine } from "../../src/ast/engine"

const REPOS: Record<string, string> = {
  "grails-core": "$HOME/fixtures/repositories/grails-core",
  geb: "$HOME/fixtures/repositories/geb",
}
const only = process.argv.includes("--repo") ? process.argv[process.argv.indexOf("--repo") + 1] : null

// A double-quoted Groovy string containing an interpolation, matched on the
// SOURCE (so the count does not depend on the grammar being fixed).
const INTERP = /\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*/g
// A double-quoted string whose interpolation contains a nested double quote —
// the subset that fails to PARSE rather than merely going ungraphable.
const NESTED = /"[^"\n]*\$\{[^}]*"[^}]*\}[^"\n]*"/g

async function main(): Promise<void> {
  const names = only ? [only] : Object.keys(REPOS)
  for (const name of names) {
    const repo = REPOS[name]
    if (!repo) throw new Error(`unknown repo ${name}`)
    const rev = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
    const files = execFileSync("git", ["-C", repo, "ls-files", "*.groovy", "*.gradle", "*.gsp"], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    })
      .trim()
      .split("\n")
      .filter(Boolean)

    let filesWithInterp = 0
    let interpCount = 0
    let filesWithNested = 0
    let nestedCount = 0
    let parseFail = 0
    let rels = 0

    for (const f of files) {
      let src: string
      try {
        src = readFileSync(`${repo}/${f}`, "utf8")
      } catch {
        continue
      }
      const interp = src.match(INTERP)
      if (interp) {
        filesWithInterp++
        interpCount += interp.length
      }
      const nested = src.match(NESTED)
      if (nested) {
        filesWithNested++
        nestedCount += nested.length
      }
      const parser = await ASTEngine.getParser("groovy" as any)
      const root = parser.parse(src)?.rootNode
      if (root?.hasError) parseFail++
      try {
        const res: any = await ASTEngine.parseFile(`${repo}/${f}`, src)
        rels += (res.relationships ?? []).length
      } catch {
        /* counted as 0 */
      }
    }

    const pct = (x: number) => `${((x / Math.max(1, files.length)) * 100).toFixed(1)}%`
    console.log(`\n=== ${name} @ ${rev.slice(0, 12)} — ${files.length} groovy-surface files ===`)
    console.log(`files with interpolation          : ${filesWithInterp} (${pct(filesWithInterp)})`)
    console.log(`interpolation sites in source     : ${interpCount}`)
    console.log(`  of which nested-double-quote    : ${nestedCount} in ${filesWithNested} files (${pct(filesWithNested)}) — these FAIL TO PARSE`)
    console.log(`parse-failing files (hasError)    : ${parseFail} (${pct(parseFail)})`)
    console.log(`relationships emitted             : ${rels}`)
    console.log(`   <- every interpolation site above contributes 0 reads at present`)
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
