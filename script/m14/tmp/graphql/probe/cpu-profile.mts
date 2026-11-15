/**
 * GraphQL CPU PROFILE HARNESS — runs the analyzer on the largest real schema
 * under V8's sampling profiler and prints a SELF-TIME ranking, so the next
 * optimisation is chosen from a measurement rather than from a guess about
 * which line "looks expensive".
 *
 * Run it with:
 *   node --cpu-prof --cpu-prof-dir=/tmp/cpuprof --import tsx graphql/probe/cpu-profile.mts
 * then:
 *   node probe/read-profile.mts /tmp/cpuprof/<file>.cpuprofile
 */
import * as fs from "fs"
import * as path from "path"
import { CORPORA, ROOT } from "../paths.mts"

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new ParserClass()
parser.setLanguage(await Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-graphql.wasm"))))
const { RealGraphqlAnalyzer } = await import(path.join(ROOT, "src/ast/real-graphql-analyzer.ts"))

const files = process.argv.slice(2)
const inputs = (files.length ? files : [`${CORPORA}/graphql-js/benchmark/github-schema.graphql`]).map((f) => ({ f, src: fs.readFileSync(f, "utf8") }))
const trees = inputs.map((i) => ({ ...i, tree: parser.parse(i.src) }))

// Warm once so the profile is of steady-state behaviour, not of first-call JIT.
for (const t of trees) new RealGraphqlAnalyzer().analyze(t.tree.rootNode, t.src, t.f)

const REPS = Number(process.env.PROFILE_REPS ?? 8)
let facts = 0
const t0 = Date.now()
for (let r = 0; r < REPS; r++) {
  for (const t of trees) {
    const res: any = new RealGraphqlAnalyzer().analyze(t.tree.rootNode, t.src, t.f)
    facts = res.symbols.length + res.relationships.length
  }
}
const ms = Date.now() - t0
console.error(`profiled ${REPS} reps over ${trees.length} file(s): ${ms} ms total, ${(ms / REPS).toFixed(0)} ms/rep, ${facts} facts, ${((trees.reduce((a, t) => a + t.src.split("\n").length, 0) * REPS) / (ms / 1000)).toFixed(0)} lines/s`)
