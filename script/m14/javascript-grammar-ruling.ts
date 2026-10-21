/**
 * JAVASCRIPT — THE GRAMMAR-HALF RULING for the lane's EXCLUDED types, and the TWO-GRAMMAR FINDING.
 *
 * WHAT THIS INSTRUMENT IS FOR. The lane's denominator is `n = 14 − (types the grammar cannot
 * express, each ruled with a citation)`. A ruling is only a citation if it carries BOTH halves:
 *
 *   THE GRAMMAR HALF — the pinned grammar the PRODUCTION PARSER is configured with has no node
 *     type that could produce the construct, so no corpus count can exist. That is positive
 *     evidence of absence, and it is measured here against the node-type inventory of the
 *     grammar the population instrument actually loads.
 *   THE CORPUS HALF — the construct occurs 0 times in the whole admitted population.
 *
 * A count of zero alone is NOT a ruling (a zero is a claim about a POPULATION and it can be
 * produced by an analyzer that never looked), and a grammar inventory alone is not either (a
 * grammar can have a node the corpus never uses). Both halves, or prose.
 *
 * ── THE FINDING THIS INSTRUMENT ALSO MEASURES, BECAUSE IT INVALIDATES A CITATION ───────────────────
 * **THERE ARE TWO JAVASCRIPT GRAMMARS IN THIS REPOSITORY, AND THE LANE'S OWN INSTRUMENTS USE
 * DIFFERENT ONES.**
 *
 *   · `script/m14/incoming-gate.ts:1287` (THE POPULATION INSTRUMENT) loads
 *     `tree-sitter-javascript/tree-sitter-javascript.wasm` — the node_modules build.
 *   · `script/m14/run-fixtures.ts:58` (THE FIXTURE INSTRUMENT) loads `tree-sitter-javascript.wasm`
 *     — the repository's own `wasm/` copy.
 *   · `script/m14/javascript-implements-ruling.ts:106` (THE EXISTING implements RULING) loads the
 *     `wasm/` copy — the FIXTURE grammar, not the population grammar.
 *
 * They are NOT byte-identical (the shas below differ), so a node-type inventory taken from one
 * is not an inventory of the other. The lane's existing `implements` exclusion cites a named-type
 * count that belongs to the FIXTURE grammar, and the corpus half it was measured over was the
 * TYPESCRIPT corpus, not the javascript population. **This instrument re-measures both halves
 * against the POPULATION grammar and the JAVASCRIPT population, and reports the two inventories
 * side by side so the difference is visible rather than assumed.**
 *
 * ── THE POSITIVE CONTROL, BECAUSE AN INSTRUMENT THAT CANNOT FIRE MEASURES NOTHING ──────────────────
 * The same node-type scan runs against the sibling grammars that DO have the constructs
 * (`tree-sitter-typescript` has `implements_clause`; `tree-sitter-dart` has `mixin_application`
 * and `part_directive`). If the scan reported "absent" for all of them, it would be measuring
 * nothing, and the verdict below would be worthless.
 *
 * ── WHAT IS WRITTEN ────────────────────────────────────────────────────────────────────────────────
 * `validation/m14/measurements/javascript-grammar-ruling.json` — the citation the lane's spec block
 * and the lane's pages carry. NOTHING ELSE IS WRITTEN; the corpus is read-only.
 *
 *   bun run script/m14/javascript-grammar-ruling.ts [--corpus=<dir>] [--max-files=N]
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = process.cwd()
const OUT = path.join(ROOT, "validation/m14/measurements/javascript-grammar-ruling.json")

function argOf(name: string): string | undefined {
  const argv = process.argv.slice(2)
  const i = argv.indexOf("--" + name)
  if (i >= 0) return argv[i + 1]
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}
const CR = argOf("corpus") ?? process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const MAX_FILES = Number(argOf("max-files") ?? "0")
const SIZE_CAP = 1024 * 1024

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE TWO JAVASCRIPT GRAMMARS, NAMED BY THE INSTRUMENT THAT USES EACH.
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const GATE_WASM = "node_modules/tree-sitter-javascript/tree-sitter-javascript.wasm" // incoming-gate.ts:1287
const FIXTURE_WASM = "wasm/tree-sitter-javascript.wasm" // run-fixtures.ts:58
const TS_WASM = "node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm" // the CONTROL
const DART_WASM = "wasm/tree-sitter-dart.wasm" // the CONTROL

const sha256 = (p: string) => createHash("sha256").update(readFileSync(path.join(ROOT, p))).digest("hex")
const digestOf = (xs: string[]) => createHash("sha256").update(xs.join("\n")).digest("hex")

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE POPULATION — the gate's rule, copied rule-for-rule (incoming-gate.ts:454 discoverFiles).
//   1. every entry of BB_CORPUS_ROOT; symlinks FOLLOWED (statSync)
//   2. only real git checkouts are corpus (git rev-parse --git-dir)
//   3. the file set is `git ls-files -z` — TRACKED files only
//   4. extension admission is the lane's own table (js,mjs,cjs,jsx)
//   5. the size cap is 1 MB (the engine's FULL_AST_LIMIT)
const EXTS = [".js", ".mjs", ".cjs", ".jsx"]
function admitByExtension(rel: string, exts: string[]): boolean {
  const lower = rel.toLowerCase()
  return exts.some((e) => lower.endsWith(e))
}
function discover(): { files: string[]; absent: number; overCap: number; overCapLargest: number; repos: number } {
  const found: string[] = []
  const repos = new Set<string>()
  let absent = 0
  let overCap = 0
  let overCapLargest = 0
  let entries: string[]
  try {
    entries = readdirSync(CR)
  } catch {
    return { files: [], absent, overCap, overCapLargest, repos: 0 }
  }
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    try {
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
        encoding: "utf8",
        maxBuffer: 512 * 1024 * 1024,
      })
        .split("\0")
        .filter(Boolean)
    } catch {
      continue
    }
    for (const rel of tracked) {
      if (!admitByExtension(rel, EXTS)) continue
      const abs = path.join(dir, rel)
      try {
        const size = statSync(abs).size
        if (size > SIZE_CAP) {
          overCap++
          overCapLargest = Math.max(overCapLargest, size)
          continue
        }
      } catch {
        absent++
        continue
      }
      found.push(abs)
      repos.add(name)
    }
  }
  found.sort()
  return { files: found, absent, overCap, overCapLargest, repos: repos.size }
}

const pop = discover()
const population = MAX_FILES > 0 ? pop.files.slice(0, MAX_FILES) : pop.files
console.log(
  `population ${CR}: ${population.length} admitted js/jsx/mjs/cjs files over ${pop.repos} repos ` +
    `(absent ${pop.absent}, over the 1 MB cap ${pop.overCap})` +
    (MAX_FILES > 0 ? ` — CAPPED AT ${MAX_FILES} FOR A TIMING PROBE, NOT A POPULATION` : ""),
)

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE GRAMMARS — the node-type inventories.
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })

type Inventory = { wasm: string; sha256: string; bytes: number; nodeTypeCount: number; namedCount: number; named: string[]; namedDigest: string }
async function inventoryOf(relWasm: string): Promise<Inventory> {
  const abs = path.join(ROOT, relWasm)
  const bytes = readFileSync(abs)
  const lang = await WSL.load(bytes)
  const named: string[] = []
  for (let id = 1; id < lang.nodeTypeCount; id++) {
    const t = lang.nodeTypeForId(id)
    if (t == null) continue
    if (lang.nodeTypeIsNamed(id)) named.push(t)
  }
  named.sort()
  return {
    wasm: relWasm,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
    nodeTypeCount: lang.nodeTypeCount,
    namedCount: named.length,
    named,
    namedDigest: digestOf(named),
  }
}

const gateInv = await inventoryOf(GATE_WASM)
const fixInv = await inventoryOf(FIXTURE_WASM)
const tsInv = await inventoryOf(TS_WASM)
const dartInv = await inventoryOf(DART_WASM)
console.log(`\nGRAMMAR INVENTORIES (named node types)`)
for (const inv of [gateInv, fixInv, tsInv, dartInv]) {
  console.log(`  ${inv.wasm}\n    sha256 ${inv.sha256}  ${inv.bytes} bytes  ${inv.namedCount} named of ${inv.nodeTypeCount} ids  namedDigest ${inv.namedDigest}`)
}
const onlyInGate = gateInv.named.filter((n) => !fixInv.named.includes(n))
const onlyInFixture = fixInv.named.filter((n) => !gateInv.named.includes(n))
console.log(`  the two javascript grammars are ${gateInv.sha256 === fixInv.sha256 ? "BYTE-IDENTICAL" : "DIFFERENT BUILDS"}`)
console.log(`    named types only in the GATE's grammar: ${onlyInGate.length} ${JSON.stringify(onlyInGate)}`)
console.log(`    named types only in the FIXTURE grammar: ${onlyInFixture.length} ${JSON.stringify(onlyInFixture)}`)

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE VOCABULARIES — one per excluded type. A vocabulary is a LITERAL SUBSTRING TEST over the
// grammar's own named node types; a match is a node type that could carry the construct.
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const VOCABULARIES: { type: string; label: string; words: string[]; positiveControl: { wasm: string; mustContain: string } }[] = [
  {
    type: "implements",
    label: "a nominal conformance clause (`class A implements B`)",
    words: ["implement"],
    positiveControl: { wasm: TS_WASM, mustContain: "implements_clause" },
  },
  {
    type: "mixes_in",
    label: "a mixin clause in a class's supertype list (`class C with M`)",
    words: ["mixin"],
    positiveControl: { wasm: DART_WASM, mustContain: "mixin_application" },
  },
  {
    type: "part_of",
    label: "a part directive (`part 'x.js';` / `part of 'x.js';`)",
    words: ["part_directive", "part_of_directive", "part"],
    positiveControl: { wasm: DART_WASM, mustContain: "part_directive" },
  },
]
const inventories: Record<string, Inventory> = {
  [GATE_WASM]: gateInv,
  [FIXTURE_WASM]: fixInv,
  [TS_WASM]: tsInv,
  [DART_WASM]: dartInv,
}
for (const v of VOCABULARIES) {
  const hits = gateInv.named.filter((n) => v.words.some((w) => n.includes(w)))
  const ctrlInv = inventories[v.positiveControl.wasm]
  const ctrlHit = ctrlInv.named.includes(v.positiveControl.mustContain)
  console.log(`\n  ${v.type} — ${v.label}`)
  console.log(`    the GATE's grammar: ${hits.length} named node type(s) match ${JSON.stringify(v.words)} ${JSON.stringify(hits)}`)
  console.log(`    the CONTROL: ${v.positiveControl.wasm} declares "${v.positiveControl.mustContain}" — ${ctrlHit ? "PRESENT (the scan is not blind)" : "ABSENT — THE SCAN IS BLIND"}`)
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE COUNTERFACTUALS — what the GATE's grammar makes of each construct. This is the decisive
// measurement: it answers "what does this grammar DO with the construct" instead of "did I find it".
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const gateParser = new WSP()
gateParser.setLanguage(await WSL.load(readFileSync(path.join(ROOT, GATE_WASM))))
const COUNTERFACTUALS = [
  { src: "class A extends B { }", of: "implements" },
  { src: "class A implements B { }", of: "implements" },
  { src: "class A extends B implements C { }", of: "implements" },
  { src: "class C with M { }", of: "mixes_in" },
  { src: "class C extends mixin(Base) { }", of: "mixes_in" },
  { src: "part 'x.js';", of: "part_of" },
  { src: "part of 'x.js';", of: "part_of" },
  { src: "import 'x.js';", of: "part_of" },
]
const counterfactuals = COUNTERFACTUALS.map((c) => {
  const t = gateParser.parse(c.src)
  const sexp = t!.rootNode.toString()
  const out = {
    source: c.src,
    of: c.of,
    sexp: sexp.slice(0, 300),
    hasError: /\(ERROR/.test(sexp),
    hasHeritage: /class_heritage/.test(sexp),
    hasPartDirective: /part_directive|part_of_directive/.test(sexp),
  }
  t!.delete?.()
  return out
})
console.log("\nCOUNTERFACTUALS (the GATE's grammar)")
for (const c of counterfactuals) {
  console.log(`  ${c.hasError ? "ERRORS " : "PARSES "} ${c.source.padEnd(34)} heritage=${c.hasHeritage} partDirective=${c.hasPartDirective}  ${c.sexp.slice(0, 110)}`)
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE CORPUS HALF — the construct sites in the WHOLE admitted population.
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
let trees = 0
let errorTrees = 0
let heritageClauses = 0
let implementsTokens = 0
let withTokens = 0
let partTokens = 0
const heritageShapes = new Map<string, number>()
const extendsCallClauses = new Map<string, number>()
let extendsCallClausesTotal = 0
let extendsIdentifierClauses = 0
let mixinNamedClauses = 0
let extendMixins = 0
const extendMixinArgs = new Map<string, number>()
const partExamples: { file: string; text: string; sexp: string }[] = []
for (const abs of population) {
  let text: string
  try {
    text = readFileSync(abs, "utf8")
  } catch {
    continue
  }
  const t = gateParser.parse(text)
  if (!t) continue
  trees++
  const root = t.rootNode
  if (/\(ERROR/.test(root.toString())) errorTrees++
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()
    if (n.type === "class_heritage") {
      heritageClauses++
      const named = n.namedChildren.map((c: any) => c.type)
      const key = named.join("+")
      heritageShapes.set(key, (heritageShapes.get(key) ?? 0) + 1)
      if (named.length === 1 && named[0] === "call_expression") {
        extendsCallClausesTotal++
        // THE MIXIN-IDIOM SHAPE: `class C extends f(...)` — the target of the heritage is a CALL.
        // Counted as a NAMED OBSERVATION, not as a mixin: the grammar does not say `f` is a mixin.
        const callText = String(n.namedChildren[0].text).slice(0, 60)
        extendsCallClauses.set(callText, (extendsCallClauses.get(callText) ?? 0) + 1)
      } else if (named.length === 1 && named[0] === "identifier") {
        extendsIdentifierClauses++
      } else if (named.some((t: string) => /mixin/i.test(t))) {
        mixinNamedClauses++
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c.isNamed) continue
        const txt = String(c.text)
        if (txt === "implements") implementsTokens++
        if (txt === "with") withTokens++
      }
    }
    if (n.type === "import_statement" || n.type === "expression_statement" || n.type === "lexical_declaration") {
      // A `part` DIRECTIVE is a bare keyword at statement level. THE FIRST MEASUREMENT OF THIS WAS
      // WRONG AND SAID "8 statement-level `part ...` tokens" — every one of the 8 was an ASSIGNMENT
      // to a variable NAMED `part` (`part = part.toLowerCase();`), which is an identifier, not a
      // directive. So the counter now asks the question the construct actually is: does the statement
      // START with the token `part` and is it NOT an assignment whose left side is that identifier?
      const first = n.namedChild(0)
      if (first && first.type !== "assignment_expression") {
        const txt = String(n.text).trim()
        if (/^part\b/.test(txt)) {
          partTokens++
          if (partExamples.length < 10) partExamples.push({ file: abs, text: txt.slice(0, 120), sexp: String(n).slice(0, 160) })
        }
      }
    }
    // THE MIXIN IDIOM, NAMED — a method call whose receiver is extended with a mixin. This is NOT a
    // grammar construct (the counterfactual above shows the grammar has no mixin clause), so it is
    // counted and REPORTED, never emitted: an analyzer that emitted `mixes_in` for it would be
    // applying a NAMING CONVENTION to a method call, which the programme's C2 forbids.
    if (n.type === "call_expression") {
      const fn = n.namedChild(0)
      if (fn && fn.type === "member_expression") {
        const prop = fn.namedChild(fn.namedChildCount - 1)
        if (prop && String(prop.text) === "extend") {
          extendMixins++
          const arg = n.namedChild(1)
          const argText = arg ? String(arg.text).replace(/\s+/g, " ").slice(0, 50) : "(none)"
          extendMixinArgs.set(argText, (extendMixinArgs.get(argText) ?? 0) + 1)
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  t.delete?.()
}
console.log(`\nCORPUS HALF over ${trees} admitted files (${errorTrees} contain an ERROR node)`)
console.log(`  class_heritage clauses: ${heritageClauses}`)
console.log(`    shapes: ${JSON.stringify([...heritageShapes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12))}`)
console.log(`  \`implements\` tokens under a heritage: ${implementsTokens}`)
console.log(`  \`with\` tokens under a heritage: ${withTokens}`)
console.log(`  heritage clauses whose target is a CALL (the mixin-idiom shape): ${extendsCallClausesTotal}`)
console.log(`    the most frequent: ${JSON.stringify([...extendsCallClauses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12))}`)
console.log(`  heritage clauses whose target is an IDENTIFIER: ${extendsIdentifierClauses}`)
console.log(`  statement-level \`part ...\` DIRECTIVES: ${partTokens}`)
if (partExamples.length) console.log(`    ${JSON.stringify(partExamples, null, 2)}`)
console.log(`  the MIXIN IDIOM (\`X.extend(M)\` — a METHOD CALL, not a grammar clause): ${extendMixins}`)
console.log(`    the most frequent first arguments: ${JSON.stringify([...extendMixinArgs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10))}`)

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE VERDICT — one row per excluded type, each with BOTH halves and a FALSIFIER.
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const corpusHalf: Record<string, number> = {
  implements: implementsTokens,
  mixes_in: withTokens,
  part_of: partTokens,
}
const rulings = VOCABULARIES.map((v) => {
  const hits = gateInv.named.filter((n) => v.words.some((w) => n.includes(w)))
  const ctrlInv = inventories[v.positiveControl.wasm]
  const cf = counterfactuals.filter((c) => c.of === v.type)
  return {
    type: v.type,
    label: v.label,
    evidence: "grammar-absence",
    grammarHalf: {
      wasm: GATE_WASM,
      sha256: gateInv.sha256,
      bytes: gateInv.bytes,
      namedNodeTypes: gateInv.namedCount,
      nodeTypeIds: gateInv.nodeTypeCount,
      namedDigest: gateInv.namedDigest,
      matchingNodeTypes: hits.length,
      matching: hits,
      /** THE VOCABULARY THIS TYPE'S ABSENCE IS MEASURED AGAINST — so a reader can re-run the scan
       *  with the same words, and so the citation in the block names the WORDS, not a list of all
       *  three types' words at once. */
      vocabulary: v.words,
      vocabularyText: v.words.join(", "),
      positiveControl: {
        wasm: v.positiveControl.wasm,
        nodeType: v.positiveControl.mustContain,
        present: ctrlInv.named.includes(v.positiveControl.mustContain),
        note: "the same scan fires on a grammar that HAS the construct, so the absence above is a measurement",
      },
      counterfactuals: cf,
    },
    corpusHalf: {
      population: `${population.length} admitted js/jsx/mjs/cjs files over ${pop.repos} repos (the gate's own discovery rule)`,
      corpusRoot: CR,
      constructSites: corpusHalf[v.type],
      unit: "the construct's own token in the grammar's own node",
    },
    falsifier:
      v.type === "implements"
        ? "a named node type matching /implement/ appears in the gate's grammar inventory, OR a corpus class_heritage carries an `implements` token, OR the gate's TABLE 1 shows a non-zero `implements` row for javascript"
        : v.type === "mixes_in"
          ? "a named node type matching /mixin/ appears in the gate's grammar inventory, OR a corpus class_heritage carries a `with` token, OR the gate's TABLE 1 shows a non-zero `mixes_in` row for javascript"
          : "a named node type matching /part/ appears in the gate's grammar inventory, OR a corpus statement carries a `part` directive token, OR the gate's TABLE 1 shows a non-zero `part_of` row for javascript",
  }
})

const out = {
  generated: new Date().toISOString(),
  lane: "javascript",
  instrument: "script/m14/javascript-grammar-ruling.ts",
  populationRule:
    "the gate's own discoverFiles (incoming-gate.ts:454), copied rule-for-rule: git-tracked files only, symlinked corpus roots followed, extensions js/mjs/cjs/jsx, 1 MB cap",
  corpusRoot: CR,
  population: { admitted: population.length, repos: pop.repos, absent: pop.absent, overCap: pop.overCap, overCapLargest: pop.overCapLargest, capped: MAX_FILES > 0 },
  grammars: {
    populationInstrument: { wasm: GATE_WASM, sha256: gateInv.sha256, bytes: gateInv.bytes, namedNodeTypes: gateInv.namedCount, nodeTypeIds: gateInv.nodeTypeCount, namedDigest: gateInv.namedDigest },
    fixtureInstrument: { wasm: FIXTURE_WASM, sha256: fixInv.sha256, bytes: fixInv.bytes, namedNodeTypes: fixInv.namedCount, nodeTypeIds: fixInv.nodeTypeCount, namedDigest: fixInv.namedDigest },
    controls: [
      { wasm: TS_WASM, sha256: tsInv.sha256, namedNodeTypes: tsInv.namedCount, namedDigest: tsInv.namedDigest },
      { wasm: DART_WASM, sha256: dartInv.sha256, namedNodeTypes: dartInv.namedCount, namedDigest: dartInv.namedDigest },
    ],
    finding:
      gateInv.sha256 === fixInv.sha256
        ? "the two javascript grammars are byte-identical"
        : `THE TWO JAVASCRIPT GRAMMARS ARE DIFFERENT BUILDS — the population instrument (incoming-gate.ts) loads ${GATE_WASM} and the fixture instrument (run-fixtures.ts) loads ${FIXTURE_WASM}; only ${onlyInGate.length} named types differ, and the difference is RECORDED so a reader can see it`,
    onlyInPopulationGrammar: onlyInGate,
    onlyInFixtureGrammar: onlyInFixture,
  },
  corpusHalfTotals: { classHeritageClauses: heritageClauses, implementsTokens, withTokens, partTokens, partExamples, extendsCallClauses: extendsCallClausesTotal, extendsIdentifierClauses, mixinNamedClauses, extendMixinCalls: extendMixins, extendMixinArgs: [...extendMixinArgs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20), heritageShapes: [...heritageShapes.entries()].sort((a, b) => b[1] - a[1]), topMixinIdiomCalls: [...extendsCallClauses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20) },
  rulings,
}
mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n")
console.log(`\nwrote ${OUT}`)
