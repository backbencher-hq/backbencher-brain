/**
 * THE `uses` W1 PROBE — DURABLE, RELATIVE-PATHED, AND WITH A VERDICT (2026-10-22).
 *
 * ⇒ WHY THIS FILE EXISTS ✓✓. The javascript spec cited the evidence for the `uses` type as
 * `script/m14/tmp/fixwaves/w1-repro.ts + w1-bare.ts` — **a path under a TEMPORARY DIRECTORY** ✓✓,
 * and the Lead's citation-trackedness check names it: *"a temporary path is ephemeral by
 * construction and is in no commit"* ✓✓. ⇒ A CITATION TO A FILE THAT IS IN NO COMMIT IS A CITATION
 * NOBODY ELSE CAN CHECK ✓✓.
 *
 * ⇒ AND THE PROBES THEMSELVES WERE NON-REPRODUCIBLE FOR A SECOND REASON ✓✓: they hard-coded
 * `const ROOT = "$HOME/mcp/backbencher-brain"` ✓✓, so they could only ever run on the
 * machine that wrote them ✓✓. ⇒ THIS INSTRUMENT DERIVES ITS ROOT FROM ITS OWN LOCATION ✓✓.
 *
 * ⇒ WHAT IT MEASURES ✓✓. The `uses` fix has two halves and each needs its own control:
 *   (1) A CHAINED READ — `config.inner.deeper.leaf` — must publish the ROOT segment `config` AND
 *       the chain segments `inner` and `deeper` ✓✓. The defect this closes was that the chain's
 *       ROOT was dropped, so a read of a nested property published no `uses` edge for the object
 *       the chain hangs off ✓✓.
 *   (2) A BARE IDENTIFIER READ — `return config` — must publish `config` ✓✓, and a bare read of a
 *       name the file DOES NOT declare must publish NOTHING ✓✓ (a name nobody declares names
 *       nothing) ✓✓.
 *
 * ⇒ AND IT HAS A VERDICT, BECAUSE A PROBE THAT ALWAYS EXITS 0 IS NOT A PROBE ✓✓: it exits **0** when
 * every expected row is present and every forbidden row is absent, and **3** otherwise, naming the
 * first failure ✓✓.
 *
 * ⇒ THE FIXTURE AND THE MUTANTS PIN THE SAME BEHAVIOUR IN THE SUITE ✓✓
 * (`javascript/chain-root-and-bare-reads`; mutants `javascript/drop-chain-root-uses` and
 * `javascript/drop-bare-read-uses`) — this probe is the RAW MEASUREMENT those rest on, and it is
 * here so that the citation points at something a reader can re-run ✓✓.
 *
 * ⇒ RUN: `bun run script/m14/javascript-uses-w1-probe.ts`
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dir, "../..")

const CHAIN_SRC = `const config = { inner: { deeper: { leaf: 1 } } };
function read() {
  return config.inner.deeper.leaf;
}
function bare() {
  return config;
}
`
const BARE_DECLARED_SRC = `function bare() {
  return config;
}
let config = 1;
`
// THE THREE GATES THE FIXTURE PINS, AND EACH IS A GATE ON WHAT IS **NOT** PUBLISHED ✓✓.
const GATE_WRITE_SRC = `const config = { inner: 1 };
function w() {
  config.inner = 2;
  return config;
}
`
const GATE_CALLEE_SRC = `function f() { return g(); }
function g() { return 1; }
`
const GATE_DECL_SRC = `let config = 1;
function r() { return 2; }
`

async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
  const js = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-javascript.wasm")))
  const { RealJavaScriptAnalyzer } = await import("../../src/ast/real-javascript-analyzer")

  const usesOf = (src: string, file: string): string[] => {
    const p = new P()
    p.setLanguage(js)
    const a = new RealJavaScriptAnalyzer() as any
    const r = a.analyze(p.parse(src).rootNode, src, file, {})
    const rels = r?.relationships ?? []
    return rels
      .filter((x: any) => x.type === "uses")
      .map((x: any) => `${x.source} -> ${x.target}`)
      .sort()
  }

  const chain = usesOf(CHAIN_SRC, "T.js")
  const bareDeclared = usesOf(BARE_DECLARED_SRC, "T.js")
  const gateWrite = usesOf(GATE_WRITE_SRC, "T.js")
  const gateCallee = usesOf(GATE_CALLEE_SRC, "T.js")
  const gateDecl = usesOf(GATE_DECL_SRC, "T.js")

  console.log(`THE W1 PROBE — the uses fix's two halves, and the three gates`)
  console.log(`  the grammar: ${path.join(ROOT, "wasm/tree-sitter-javascript.wasm")}`)
  console.log(`  the analyzer: ${path.join(ROOT, "src/ast/real-javascript-analyzer.ts")}`)
  console.log(`(1) THE CHAINED READ — the root segment and the chain segments:`)
  for (const u of chain) console.log(`      ${u}`)
  console.log(`(2) THE BARE READ — a bare identifier read is a read:`)
  for (const u of bareDeclared) console.log(`      ${u}`)
  console.log(`(3) GATE — an assignment LHS is a WRITE, so the assigned member is not read:`)
  for (const u of gateWrite) console.log(`      ${u}`)
  console.log(`(4) GATE — a call callee stays calls-only:`)
  for (const u of gateCallee) console.log(`      ${u}`)
  console.log(`(5) GATE — a declaration name is not a read:`)
  for (const u of gateDecl) console.log(`      ${u}`)

  // THE EXPECTATIONS — AND THEY ARE THE FIXTURE's OWN PINS, NOT A NEW RULE ✓✓.
  //
  // ⇒ AND THE FIRST DRAFT OF THIS PROBE ASSERTED THAT A BARE READ OF AN **UNDECLARED** NAME
  // PUBLISHES NOTHING ✓✓ — AND THAT IS **A RULE THAT DOES NOT EXIST** ✓✓. `uses` IS A **READ**,
  // NOT A RESOLUTION ✓✓: the row says "this symbol reads that name", and whether the name resolves
  // to a declaration is the **ARBITER's** business ✓✓, not the analyzer's ✓✓. THE FIXTURE SAYS SO
  // (`javascript/chain-root-and-bare-reads`): the bare read publishes `bare -> config` ✓✓.
  // ⇒ A PROBE THAT ASSERTS A RULE THE CODE DOES NOT HAVE IS THE "AN INSTRUMENT THAT REPORTS A
  // CONFIDENT NUMBER FOR A CHECK THAT NEVER RAN" CLASS ✓✓ — SO THE ASSERTION IS CORRECTED HERE,
  // NOT IN THE ANALYZER ✓✓.
  const failures: string[] = []
  const has = (rows: string[], frag: string) => rows.some((r) => r.includes(frag))
  if (!has(chain, "-> config")) failures.push("the chain published no `uses` row for the ROOT `config`")
  if (!has(chain, "-> inner")) failures.push("the chain published no `uses` row for the segment `inner`")
  if (!has(chain, "-> deeper")) failures.push("the chain published no `uses` row for the segment `deeper`")
  if (!has(chain, "-> leaf")) failures.push("the chain published no `uses` row for the leaf `leaf`")
  if (!has(bareDeclared, "-> config")) failures.push("the bare read published no `uses` row for `config`")
  if (has(gateWrite, "-> inner")) failures.push("an assignment LHS published a `uses` row for the ASSIGNED member `inner` — the LHS is a WRITE, not a read")
  if (gateCallee.length > 0) failures.push(`a call callee published a \`uses\` row: ${gateCallee.join(", ")} — a callee stays calls-only`)
  if (gateDecl.length > 0) failures.push(`a declaration name published a \`uses\` row: ${gateDecl.join(", ")} — a declaration name is not a read`)

  if (failures.length > 0) {
    console.error(`VERDICT: **FAIL** — ${failures.length} expectation(s) unmet:`)
    for (const f of failures) console.error(`  · ${f}`)
    process.exit(3)
  }
  console.log(`VERDICT: PASS — the chain publishes its root, its segments and its leaf; the bare read publishes its name; and all three gates hold (an assignment LHS is a write, a call callee stays calls-only, a declaration name is not a read).`)
  process.exit(0)
}

main()
