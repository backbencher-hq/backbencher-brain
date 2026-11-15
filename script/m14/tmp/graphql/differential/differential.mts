/**
 * GraphQL DIFFERENTIAL harness (L3).
 *
 * Runs the REAL analyzer over the hand-derived fixture suite and reports
 * precision / recall / false-positive rate / false-negative rate SEPARATELY,
 * per file and in total, for four fact kinds: symbols, relationships, argument
 * optionality, and docstrings — plus the range, relationship-line, metadata,
 * export and anonymous-identity channels that a set comparison alone cannot see.
 *
 * `mustNotEmit` is the adversarial half: named phantoms that must never appear.
 * A fact expected but not produced is a false negative; a fact produced but not
 * expected is a false positive; a `mustNotEmit` hit is reported separately
 * because it is the more serious failure — a published phantom.
 */
import * as fs from "fs"
import * as path from "path"
import { HERE, ROOT } from "../paths.mts"

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const language: any = await Language.load(fs.readFileSync(process.env.GQL_WASM ?? path.join(ROOT, "wasm/tree-sitter-graphql.wasm")))
const parser = new ParserClass()
parser.setLanguage(language)

const { evaluate, TRUTH } = await import("./score.mts")
const { RealGraphqlAnalyzer } = await import(path.join(ROOT, "src/ast/real-graphql-analyzer.ts"))

const v = evaluate(RealGraphqlAnalyzer)

const pct = (tp: number, fp: number, fn: number) => {
  const expected = tp + fn
  const observed = tp + fp
  return {
    expected,
    observed,
    truePositive: tp,
    falsePositive: fp,
    falseNegative: fn,
    precision: observed === 0 ? 1 : +(tp / observed).toFixed(6),
    recall: expected === 0 ? 1 : +(tp / expected).toFixed(6),
    falsePositiveRate: observed === 0 ? 0 : +(fp / observed).toFixed(6),
    falseNegativeRate: expected === 0 ? 0 : +(fn / expected).toFixed(6),
  }
}

const total = {
  symbols: pct(v.symTp, v.symFp, v.symFn),
  relationships: pct(v.relTp, v.relFp, v.relFn),
  parameters: pct(v.paramTp, v.paramFp, v.paramFn),
  docstrings: pct(v.docTp, v.docFp, v.docFn),
}

for (const [name, s] of Object.entries<any>(TRUTH.files)) {
  const pf = v.perFile[name]
  const mark = pf ? "ok" : "NOT REACHED"
  console.log(
    `${name.padEnd(28)} sym ${String(pf?.symTp ?? 0).padStart(2)}tp/${String(pf?.symFn ?? 0).padStart(2)}fn/${String(pf?.symFp ?? 0).padStart(2)}fp` +
      `  rel ${String(pf?.relTp ?? 0).padStart(2)}tp/${String(pf?.relFn ?? 0).padStart(2)}fn/${String(pf?.relFp ?? 0).padStart(2)}fp` +
      `  param ${String(pf?.paramTp ?? 0).padStart(2)}tp/${String(pf?.paramFn ?? 0).padStart(2)}fn/${String(pf?.paramFp ?? 0).padStart(2)}fp` +
      `  doc ${String(pf?.docTp ?? 0).padStart(2)}tp/${String(pf?.docFn ?? 0).padStart(2)}fn/${String(pf?.docFp ?? 0).padStart(2)}fp  ${mark}`,
  )
  for (const f of pf?.failures ?? []) console.log(`      ${f}`)
}

console.log(`\n=== GRAPHQL DIFFERENTIAL (hand-derived ground truth) ===`)
for (const [k, s] of Object.entries(total)) {
  console.log(
    `${k.padEnd(14)} expected=${String(s.expected).padStart(3)} observed=${String(s.observed).padStart(3)} ` +
      `tp=${String(s.truePositive).padStart(3)} fp=${String(s.falsePositive).padStart(2)} fn=${String(s.falseNegative).padStart(2)} ` +
      `P=${s.precision} R=${s.recall} fpr=${s.falsePositiveRate} fnr=${s.falseNegativeRate}`,
  )
}
console.log(`\nrangeFailures=${v.rangeFailures.length} violations=${v.violations.length}`)
console.log(`unexpectedParseErrors=${v.unexpectedParseErrors.length} expectedParseErrors=${v.expectedParseErrors.length}`)
console.log(`\nfixtures=${Object.keys(TRUTH.files).length}  totalFailures=${v.failures.length}  FAILED=${v.failed}`)
for (const f of v.failures.slice(0, 60)) console.log(`  ${f}`)
if (v.failures.length > 60) console.log(`  ... ${v.failures.length - 60} more`)

fs.mkdirSync(path.join(HERE, "out"), { recursive: true })
fs.writeFileSync(
  path.join(HERE, "out/differential.json"),
  JSON.stringify(
    { schemaVersion: 1, kind: "graphql_differential", truthSource: "hand_derived_from_spec", wasm: process.env.GQL_WASM ?? path.join(ROOT, "wasm/tree-sitter-graphql.wasm"), total, rangeFailures: v.rangeFailures, violations: v.violations, unexpectedParseErrors: v.unexpectedParseErrors, perFile: v.perFile, failures: v.failures },
    null,
    2,
  ),
)
process.exitCode = v.failed ? 1 : 0
