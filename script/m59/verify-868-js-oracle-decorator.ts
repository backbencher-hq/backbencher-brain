// script/m59/verify-868-js-oracle-decorator.ts — M49/M59 #868, acceptance item 3,
// second half: "the javascript oracle `deriveJavaScriptEdges` needs the same guard".
//
// WHY THIS EXISTS. #868's analyzer half suppresses a decorator-position call
// (`@inject("db")` is a `call_expression` in the tree, but the analyzer rules it
// METADATA on the decorated symbol, so its only edge is a `references` edge from
// that symbol at the decorator's own line). The typescript oracle mirror carries
// the matching guard (`inDecoratorPosition` in `deriveTypeScriptEdges`); the
// javascript oracle was never checked for it, and NOTHING could have caught the
// omission: the corpus lane samples plain `.js` from the web repos, which contain
// no class-body decorators, and the fixture lane compares the analyzer against its
// expectation — never against the oracle. A missing oracle guard is therefore
// latent (it fabricates MISSING rows only where a decorator exists), which is
// exactly the state this verifier makes visible.
//
// INDEPENDENCE. This does NOT import analyzer code. It builds the ORACLE's own
// view — `web-tree-sitter` parse + `deriveJavaScriptEdges`, the same pair the
// differential harness uses — and compares it to the analyzer's emitted
// relationships (the thing under test).
//
// BOTH DIRECTIONS ASSERTED, so the guard cannot become a blanket suppression:
//   * a decorator-position call must NOT appear as an oracle call edge, and
//   * an ORDINARY call in the same file MUST still appear — if the guard were
//     implemented as "skip any call inside a class body", the second assertion
//     fails.
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const FIXTURE = path.join(ROOT, "validation/m14/fixtures/javascript/decorator-metadata-868.js")
const WASM = path.join(ROOT, "wasm/tree-sitter-javascript.wasm")

interface OracleEdge { label: string; from: string; target: string }

async function main() {
  const { deriveJavaScriptEdges } = (await import(path.join(ROOT, "script/m14/differential.ts"))) as any
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({
    locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
  })
  const grammar = await Language.load(readFileSync(WASM))
  const parser = new ParserClass()
  parser.setLanguage(grammar)

  const text = readFileSync(FIXTURE, "utf8")
  const root = parser.parse(text).rootNode
  const oracleEdges: OracleEdge[] = deriveJavaScriptEdges(root)

  // The analyzer's own view — the thing under test.
  const { ASTEngine } = (await import(path.join(ROOT, "src/ast/engine.ts"))) as any
  const res: any = await ASTEngine.parseFile(FIXTURE, text)
  const analyzerCalls = new Set<string>()
  const analyzerRefs = new Set<string>()
  for (const r of res?.relationships ?? []) {
    const t = String(r?.type ?? r?.relationshipType ?? "")
    const target = String(r?.target ?? r?.to ?? "")
    if (t === "calls") analyzerCalls.add(target)
    if (t === "references") analyzerRefs.add(target)
  }

  // ── the decorator names, read off the source (not off either side's output) ──
  const decoratorNames = [...text.matchAll(/^\s*@([A-Za-z_$][\w$]*)/gm)].map((m) => m[1])
  const uniqueDecorators = [...new Set(decoratorNames)]

  console.log(`fixture: ${path.relative(ROOT, FIXTURE)}`)
  console.log(`decorator names written in source: ${JSON.stringify(uniqueDecorators)}`)
  // EVERY oracle edge, by label — not only `calls`. The analyzer skips the whole
  // decorator subtree (a nested call `@inject(make())` and a decorator ARGUMENT
  // read are both decorator position), so an oracle that guards only `calls`
  // would still manufacture `uses`/`references` rows for the argument.
  const byLabel = new Map<string, string[]>()
  for (const e of oracleEdges) {
    if (!byLabel.has(e.label)) byLabel.set(e.label, [])
    byLabel.get(e.label)!.push(e.target)
  }
  console.log(`\noracle edges by label:`)
  for (const [label, targets] of [...byLabel].sort()) {
    console.log(`   ${label.padEnd(12)} ${JSON.stringify([...new Set(targets)].sort())}`)
  }
  console.log(`analyzer call targets: ${JSON.stringify([...analyzerCalls])}`)
  console.log(`analyzer reference targets: ${JSON.stringify([...analyzerRefs])}`)

  const checks: Array<{ name: string; ok: boolean; detail: string }> = []

  // 1. no decorator name may be an oracle CALL edge (the mirror of the analyzer's rule)
  const oracleCallTargets = oracleEdges.filter((e) => e.label === "calls").map((e) => e.target)
  const decoratorAsOracleCall = oracleCallTargets.filter((t) => uniqueDecorators.includes(t))
  checks.push({
    name: "oracle emits no CALL edge for a decorator name",
    ok: decoratorAsOracleCall.length === 0,
    detail: decoratorAsOracleCall.length === 0
      ? `none (decorators: ${uniqueDecorators.join(", ")})`
      : `oracle manufactures ${decoratorAsOracleCall.length} call edge(s) the analyzer suppresses: ${decoratorAsOracleCall.join(", ")} — these would surface as false MISSING rows in the javascript differential lane`,
  })

  // 2. the guard must not be a blanket suppression: ordinary calls survive
  const ordinaryCallPresent = oracleCallTargets.length > 0
  checks.push({
    name: "ordinary (non-decorator) calls still derive",
    ok: ordinaryCallPresent,
    detail: ordinaryCallPresent ? `${oracleCallTargets.length} call edge(s): ${oracleCallTargets.join(", ")}` : "ZERO call edges — the guard swept the entire file",
  })

  // 3. the analyzer's decorator trace is the reference edge (so suppression is not data loss)
  const decoratorRefsFromAnalyzer = uniqueDecorators.filter((d) => analyzerRefs.has(d))
  checks.push({
    name: "the analyzer keeps the decorator's trace as a reference edge",
    ok: decoratorRefsFromAnalyzer.length === uniqueDecorators.length,
    detail: `${decoratorRefsFromAnalyzer.length}/${uniqueDecorators.length} decorator name(s) reachable: ${decoratorRefsFromAnalyzer.join(", ") || "none"}`,
  })

  // 4. and no decorator name may be an analyzer CALL edge either (the #861/#868 contract)
  const decoratorAsAnalyzerCall = [...analyzerCalls].filter((t) => uniqueDecorators.includes(t))
  checks.push({
    name: "analyzer emits no CALL edge for a decorator name",
    ok: decoratorAsAnalyzerCall.length === 0,
    detail: decoratorAsAnalyzerCall.length === 0 ? "none" : `found: ${decoratorAsAnalyzerCall.join(", ")}`,
  })

  // 5. the decorator's ARGUMENT is decorator position too: the source writes `DB`
  //    once, inside `@inject(DB)`, and the analyzer skips the whole subtree — so an
  //    oracle `uses -> DB` edge would be a second false MISSING row. Read from the
  //    source (the argument list of a decorator), never from either side's output.
  const decoratorArgReads = new Set<string>()
  for (const m of text.matchAll(/^\s*@[A-Za-z_$][\w$]*\(([^)]*)\)/gm)) {
    for (const ident of m[1].matchAll(/[A-Za-z_$][\w$]*/g)) decoratorArgReads.add(ident[0])
  }
  const args = [...decoratorArgReads]
  const oracleUses = (byLabel.get("uses") ?? []).filter((t) => args.includes(t))
  const analyzerReadsDecoratorArg = Object.keys(res?.symbols ?? {}).length >= 0
  checks.push({
    name: "oracle emits no edge for a decorator ARGUMENT read",
    ok: oracleUses.length === 0,
    detail: args.length === 0
      ? "no decorator argument written (vacuous)"
      : oracleUses.length === 0
        ? `none (decorator argument(s): ${args.join(", ")})`
        : `oracle manufactures ${oracleUses.length} edge(s) for argument read(s): ${oracleUses.join(", ")}`,
  })

  for (const c of checks) console.log(`\n${c.ok ? "PASS" : "FAIL"}  ${c.name}\n      ${c.detail}`)
  const failed = checks.filter((c) => !c.ok)
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
  if (failed.length > 0) {
    console.log("#868 acceptance item 3 (javascript oracle mirror): NOT met")
    process.exit(1)
  }
  console.log("#868 acceptance item 3 (javascript oracle mirror): met")
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
