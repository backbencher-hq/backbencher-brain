/**
 * M12 graphql differential — REGENERATES `validation/m12/results/graphql-differential.json`.
 *
 * ## Why this exists
 *
 * That artifact was committed by the M12.38 / #177 wave and then nothing touched
 * it again: no script wrote it, no script read it, and it carried no timestamp.
 * An artifact nobody regenerates and nobody checks is a claim frozen in time that
 * still reads `passed: true` — which is exactly the failure this repository
 * already tracks as a finding, the same shape as the #884 "inert fixture": it
 * looks like evidence and it cannot fail. The lane's own differential
 * (`script/m14/tmp/graphql/differential/`) is larger and hand-derived, but it
 * lives in a different place with a different identity contract, so it cannot
 * stand in for the M12 record.
 *
 * So this regenerates it, from the M12 inputs that are already committed:
 *   - `validation/m12/fixtures/graphql/*.graphql`  the three fixtures
 *   - `validation/m12/ground-truth/graphql.json`    97 hand-audited facts
 *
 * ## The identity contract, taken from the artifact's own note
 *
 *   symbol        symbol:<file>:<line>:<symbolKind>:<name>
 *   relationship  rel:<file>:<type>:<source>:<target>   (attributes = {type} ONLY)
 *
 * The relationship key deliberately carries no line and no extra attributes, so
 * the comparison measures whether the analyzer extracted the right facts and not
 * whether two spellings of the same edge agree. That is the M12 contract and it
 * is preserved rather than tightened: a tighter contract would be a different
 * measurement wearing this one's name.
 *
 * Run: npx tsx script/m12/graphql-differential.ts
 */
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), "..", "..")
const FIXTURE_DIR = path.join(ROOT, "validation/m12/fixtures/graphql")
const TRUTH = path.join(ROOT, "validation/m12/ground-truth/graphql.json")
const OUT = path.join(ROOT, "validation/m12/results/graphql-differential.json")
const WASM = process.env.GQL_WASM ?? path.join(ROOT, "wasm/tree-sitter-graphql.wasm")

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new ParserClass()
parser.setLanguage(await Language.load(fs.readFileSync(WASM)))
const { RealGraphqlAnalyzer } = await import(path.join(ROOT, "src/ast/real-graphql-analyzer.ts"))

const truth = JSON.parse(fs.readFileSync(TRUTH, "utf8"))
const expected: string[] = truth.facts.map((f: any) => f.id)

const observed = new Set<string>()
const perFile: Record<string, any> = {}
for (const name of fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".graphql")).sort()) {
  const src = fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8")
  const tree = parser.parse(src)
  const r: any = new RealGraphqlAnalyzer().analyze(tree.rootNode, src, name)
  const ids: string[] = []
  for (const s of r.symbols) {
    const id = `symbol:${name}:${s.range.startLine}:${s.kind}:${s.name}`
    observed.add(id)
    ids.push(id)
  }
  for (const rel of r.relationships) {
    const id = `rel:${name}:${rel.type}:${rel.source}:${rel.target}`
    observed.add(id)
    ids.push(id)
  }
  perFile[name] = { symbols: r.symbols.length, relationships: r.relationships.length, factIds: ids.length }
}

const tp = expected.filter((id) => observed.has(id))
const fn = expected.filter((id) => !observed.has(id))
const fp = [...observed].filter((id) => !expected.includes(id))
const precision = tp.length / (tp.length + fp.length || 1)
const recall = tp.length / (tp.length + fn.length || 1)

const metrics = {
  expected: expected.length,
  observedResolved: observed.size,
  truePositive: tp.length,
  falsePositive: fp.length,
  falseNegative: fn.length,
  unknown: 0,
  unsupported: 0,
  correctlyClassifiedUnknown: 0,
  correctlyClassifiedUnsupported: 0,
  precision: Number(precision.toFixed(3)),
  recall: Number(recall.toFixed(3)),
  falsePositiveRate: Number(((fp.length / (observed.size || 1))).toFixed(3)),
  falseNegativeRate: Number(((fn.length / (expected.length || 1))).toFixed(3)),
  unknownRate: 0,
}

const failed = fp.length > 0 || fn.length > 0
const out = {
  schemaVersion: 1,
  kind: "m12-differential",
  generatedAt: new Date().toISOString(),
  regeneratedBy: "script/m12/graphql-differential.ts",
  truthSource: truth.truthSource,
  truthReference: "validation/m12/ground-truth/graphql.json",
  fixtureDir: "validation/m12/fixtures/graphql",
  wasm: path.relative(ROOT, WASM),
  fixtures: Object.keys(perFile),
  perFile,
  passing: {
    schemaVersion: 1,
    passed: !failed,
    metrics,
    earliestFailingLayer: failed ? "ast_extraction" : null,
    truePositiveIds: tp,
    falsePositiveIds: fp,
    falseNegativeIds: fn,
    unknownIds: [],
    unsupportedIds: [],
    minimizedFailure: null,
  },
  intentionalFailure: null,
  note:
    "M12 per-analyzer differential for graphql, REGENERATED by script/m12/graphql-differential.ts. " +
    "Identity contract: symbol facts keyed by file:line:kind:name; relationship facts keyed by " +
    "file:type:sourceId:targetId with attributes={type} only (no line, no extra fields) so the " +
    "comparison measures extraction correctness, not naming noise. " +
    "This artifact was previously committed with no generator and no timestamp; the lane's larger " +
    "hand-derived differential (292 facts, 7 fixtures) is at script/m14/tmp/graphql/differential/ " +
    "under its own, stricter identity contract.",
  supersedes: {
    priorState: "committed with no generating script, no timestamp, and no gate reading it",
    supersededBy:
      "script/m14/tmp/graphql/differential/ for breadth (292 facts over 7 fixtures, P=1.000 R=1.000, " +
      "ground truth hand-derived from the specification and verified line by line); THIS file remains " +
      "the M12 milestone's own 3-fixture / 97-fact record and is now regenerated on every run",
  },
  bbSeal: {
    seal: "sha256",
    note: "see script/m12/verify-m12-final-audit.ts for the audit that consumes this artifact",
  },
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n")
console.log(
  `m12 graphql differential: ${metrics.truePositive}/${metrics.expected} tp, ` +
    `${metrics.falsePositive} fp, ${metrics.falseNegative} fn, P=${metrics.precision} R=${metrics.recall} -> ${failed ? "FAIL" : "PASS"}`,
)
if (fp.length) console.log(`  false positives: ${fp.slice(0, 8).join(", ")}`)
if (fn.length) console.log(`  false negatives: ${fn.slice(0, 8).join(", ")}`)
process.exitCode = failed ? 1 : 0
