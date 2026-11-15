/**
 * Second guard for the unnamed-operation identity: analyzer-instance reuse.
 *
 * `unnamedOperationIdentity(filePath, ordinal)` numbers the unnamed operations of a
 * document, and that ordinal lives on the analyzer instance. A pooled worker reuses
 * one instance across files (pool-worker.ts), so a counter that is not reset per
 * `analyze` call numbers the SECOND file's operations from where the first stopped —
 * `beta.graphql`'s only unnamed operation would publish as `beta::operation_2`
 * because `alpha.graphql` had already consumed 0 and 1.
 *
 * This bug is invisible to both existing instruments, which is why it needs its own:
 * run-fixtures.ts analyses ONE file per fixture, and the mutation harness
 * (differential/mutation.mts -> score.mts:77) does `new Analyzer()` per file too. Both
 * start the counter at 0 every time, so the mutant "counter not reset" SURVIVES both
 * and is recorded in mutation.mts as defeated by this probe rather than left
 * unmentioned.
 *
 * Asserts three things: the ordinal restarts on a reused instance, the identity tracks
 * the file it is given, and a caller that supplies no path gets the specification's own
 * word for the thing rather than an empty name.
 *
 * Usage: npx tsx script/m14/tmp/graphql/probe/analyzer-reuse.mts
 * Exits non-zero on any failure.
 */
import * as fs from "fs"
import * as path from "path"
import { HERE, ROOT } from "../paths.mts"

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const wasmPath = process.env.GQL_WASM ?? path.join(ROOT, "wasm/tree-sitter-graphql.wasm")
const language: any = await Language.load(fs.readFileSync(wasmPath))
const parser = new ParserClass()
parser.setLanguage(language)

const { RealGraphqlAnalyzer } = await import(path.join(ROOT, "src/ast/real-graphql-analyzer.ts"))

// ONE instance on purpose: this is the state the guard is about.
const analyzer = new RealGraphqlAnalyzer()

const ALPHA = `{
  hero {
    name
  }
}

{
  droid {
    primaryFunction
  }
}
`
const BETA = `{
  viewer {
    login
  }
}
`

const failures: string[] = []

function opNames(src: string, filePath: string): string[] {
  const tree = parser.parse(src)
  const res: any = analyzer.analyze(tree.rootNode, src, filePath)
  const names = ((res.symbols ?? []) as any[]).map((s) => String(s.name))
  const edges = ((res.relationships ?? []) as any[]).filter((e) => String(e.type) === "uses")
  const fromAnon = new Set<string>()
  for (const e of edges) {
    const s = String(e.source ?? "")
    if (s.includes("::operation_") || s.startsWith("anonymous_")) fromAnon.add(s)
  }
  return [...names.filter((n) => n.includes("::operation_") || n.startsWith("anonymous_")), ...fromAnon]
}

function expect(label: string, actual: string[], wanted: string[]): void {
  const missing = wanted.filter((w) => !actual.includes(w))
  const leaked = actual.filter((a) => a.startsWith("anonymous_"))
  if (missing.length) failures.push(`${label}: missing ${JSON.stringify(missing)}; got ${JSON.stringify([...new Set(actual)])}`)
  if (leaked.length) failures.push(`${label}: published a name the store discards by design: ${JSON.stringify(leaked)}`)
  if (!missing.length && !leaked.length) console.log(`  ok  ${label}: ${JSON.stringify([...new Set(actual)])}`)
}

console.log("=== analyzer-instance reuse: the unnamed-operation ordinal must be per document ===")
expect("alpha.graphql (two unnamed operations)", opNames(ALPHA, "alpha.graphql"), ["alpha::operation_0", "alpha::operation_1"])
expect("beta.graphql (one, on the SAME instance)", opNames(BETA, "beta.graphql"), ["beta::operation_0"])
expect("alpha.graphql again (ordinal must not have drifted)", opNames(ALPHA, "alpha.graphql"), ["alpha::operation_0", "alpha::operation_1"])
expect("no path supplied", opNames(BETA, ""), ["document::operation_0"])
expect("a bare filename with no directory", opNames(BETA, "gamma.gql"), ["gamma::operation_0"])

console.log(failures.length ? `\nFAIL (${failures.length}):` : "\nall reuse assertions hold")
for (const f of failures) console.log(`  ${f}`)
process.exit(failures.length ? 1 : 0)