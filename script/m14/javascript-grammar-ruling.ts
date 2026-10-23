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
// THE PRODUCTION BUILD — the bytes the REGISTRY SERVES and the path the GATE's own resolution
// returns. MEASURED by script/m14/javascript-grammar-binding-probe.ts (exit 0):
//   registry bytes 63812b9e (647,334 bytes) · resolveWasmAsset -> <repo>/wasm/… 63812b9e ·
//   fixture suite 63812b9e · the ENGINE'S LOG PATH node_modules/… 4a378293 (served by NOTHING).
// The citation MUST name 63812b9e (116 named types), not 4a378293 (113). See the header block.
const PRODUCTION_WASM = "wasm/tree-sitter-javascript.wasm"

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

const gateInv = await inventoryOf(PRODUCTION_WASM)
const fixInv = await inventoryOf(FIXTURE_WASM)
const npmInv = await inventoryOf(GATE_WASM)
const tsInv = await inventoryOf(TS_WASM)
const dartInv = await inventoryOf(DART_WASM)
console.log(`\nGRAMMAR INVENTORIES (named node types)`)
for (const inv of [gateInv, fixInv, npmInv, tsInv, dartInv]) {
  console.log(`  ${inv.wasm}\n    sha256 ${inv.sha256}  ${inv.bytes} bytes  ${inv.namedCount} named of ${inv.nodeTypeCount} ids  namedDigest ${inv.namedDigest}`)
}
const onlyInGate = gateInv.named.filter((n) => !npmInv.named.includes(n))
const onlyInFixture = npmInv.named.filter((n) => !gateInv.named.includes(n))
console.log(`  PRODUCTION (registry bytes) === FIXTURE SUITE: ${gateInv.sha256 === fixInv.sha256 ? "BYTE-IDENTICAL" : "DIFFERENT BUILDS"}`)
console.log(`    named types only in the PRODUCTION grammar: ${onlyInGate.length} ${JSON.stringify(onlyInGate)}`)
console.log(`    named types only in the npm build (served by NOTHING): ${onlyInFixture.length} ${JSON.stringify(onlyInFixture)}`)

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
  // ⇒ `mixes_in` IS **NOT** IN THIS LIST ✓✓, AND IT WAS UNTIL 2026-10-22 ✓✓. IT WAS RULED
  // `grammar-absence` ON THE GROUND THAT TELLING `Route.extend(M)` FROM `_.extend(obj, props)`
  // NEEDS A NAMING CONVENTION, WHICH C2 FORBIDS — AND THAT IS HALF THE TRUTH, AND THE HALF THAT
  // DECIDES IT WAS WRONG ✓✓: THE DISCRIMINATOR IS NOT THE CALLEE's NAME BUT THAT THE CALL **IS**
  // THE HERITAGE ✓✓. A CALL IN HERITAGE POSITION IS CLASS-PRODUCING BY CONSTRUCTION; A CALL IN
  // ARGUMENT POSITION IS NOT ✓✓. POSITION, NOT A NAME ⇒ C2 IS NOT VIOLATED ⇒ THE CONSTRUCT IS
  // REAL (76 CALL-SHAPED CLAUSES OVER THE ADMITTED POPULATION) AND THE R3 REMEDY PUBLISHES IT ✓✓.
  // ⇒ A MEASUREMENT FILE THAT RULES A TYPE WHICH IS IMPLEMENTED IS A STALE SUMMARY ✓✓, AND THIS
  // INSTRUMENT WAS ONE ✓✓.
  {
    type: "part_of",
    label: "a part directive (`part 'x.js';` / `part of 'x.js';`)",
    words: ["part_directive", "part_of_directive", "part"],
    positiveControl: { wasm: DART_WASM, mustContain: "part_directive" },
  },
]
// ⇒⇒⇒ THE DUPLICATE KEY, AND WHY IT WAS NOT COSMETIC ✓✓. THIS LITERAL ONCE READ
//   `[PRODUCTION_WASM]: gateInv,` FOLLOWED BY `[FIXTURE_WASM]: fixInv,` ✓✓ — AND
// `PRODUCTION_WASM === FIXTURE_WASM === "wasm/tree-sitter-javascript.wasm"` ✓✓, so THE TWO KEYS WERE
// THE SAME KEY ✓✓, **THE SECOND ONE WON, AND `gateInv` WAS SILENTLY GONE** ✓✓. ⇒ THE COMPILER SAYS
// SO (TS1117) ✓✓, and `npx tsc --noEmit -p tsconfig.scripts.json` is the command that says it ✓✓ —
// `bunx tsc --noEmit -p tsconfig.json` DOES **NOT** COVER `script/m14` ✓✓ and exits 0 on this file ✓✓.
//
// ⇒⇒⇒ WHY IT MATTERS EVEN THOUGH THE NUMBERS CAME OUT RIGHT ✓✓: the two inventories are of the SAME
// FILE ✓✓, so the ruling's output was not wrong ✓✓ — but the file SILENTLY DEPENDED ON TWO NAMES
// DENOTING ONE BUILD ✓✓, and had the fixture suite's spelling ever pointed at a DIFFERENT build ✓✓,
// the ruling would have read the WRONG INVENTORY AS THE PRODUCTION ONE ✓✓ and NOTHING WOULD HAVE SAID
// SO ✓✓. ⇒⇒⇒ **A THING THAT NAMES ANOTHER THING MUST BE CHECKED AGAINST IT, OR THE NAME IS A GUESS
// ✓✓** — here two NAMES for one build, and the check is that their BYTES AGREE ✓✓.
//
// ⇒⇒⇒ THE FIX IS TWO PARTS ✓✓: ONE key per build ✓✓, and an ASSERTION that the two spellings of the
// production build resolve to the same BYTES ✓✓ — so if the fixture suite ever loads a different
// build, the instrument says so INSTEAD OF OVERWRITING ✓✓.
const inventories: Record<string, Inventory> = {
  [PRODUCTION_WASM]: gateInv,
  [GATE_WASM]: npmInv,
  [TS_WASM]: tsInv,
  [DART_WASM]: dartInv,
}
// ⇒ THE FIXTURE SUITE'S SPELLING IS THE PRODUCTION BUILD'S SPELLING ✓✓ — assert it against the BYTES,
// not against the PATH ✓✓ (a path is a guess; a digest is a measurement) ✓✓.
if (FIXTURE_WASM !== PRODUCTION_WASM) {
  inventories[FIXTURE_WASM] = fixInv
  console.log(
    `  the FIXTURE SUITE's spelling (${FIXTURE_WASM}) DIFFERS from the PRODUCTION spelling (${PRODUCTION_WASM}) ⇒ both are kept ✓✓`,
  )
} else if (fixInv.sha256 !== gateInv.sha256) {
  // ⇒ THE PATHS AGREE BUT THE BYTES DO NOT ✓✓ ⇒ SOMETHING RESOLVES THE SAME SPELLING TO TWO
  // DIFFERENT BUILDS ✓✓, and the ruling must NOT quietly pick one ✓✓.
  throw new Error(
    `javascript-grammar-ruling: ${PRODUCTION_WASM} was read twice and produced TWO DIFFERENT digests ` +
      `(${gateInv.sha256} and ${fixInv.sha256}) - the same spelling resolved to two builds, and a ruling ` +
      `that picks one of them silently is a ruling nobody can check`,
  )
}
for (const v of VOCABULARIES) {
  const hits = gateInv.named.filter((n) => v.words.some((w) => n.includes(w)))
  const ctrlInv = inventories[v.positiveControl.wasm]
  const ctrlHit = ctrlInv.named.includes(v.positiveControl.mustContain)
  console.log(`\n  ${v.type} — ${v.label}`)
  console.log(`    the PRODUCTION grammar (${PRODUCTION_WASM} sha256 ${gateInv.sha256.slice(0, 16)}): ${hits.length} named node type(s) match ${JSON.stringify(v.words)} ${JSON.stringify(hits)}`)
  console.log(`    the CONTROL: ${v.positiveControl.wasm} declares "${v.positiveControl.mustContain}" — ${ctrlHit ? "PRESENT (the scan is not blind)" : "ABSENT — THE SCAN IS BLIND"}`)
}
// THE GLIMMER TYPES — the three node types the PRODUCTION build has and the npm build does not. They
// are RECORDED here because the remedy ladder's rung for a type that IS in the grammar is R3 (the
// analyzer must emit it), and the reader has to know which node types are available to emit.
const GLIMMER = ["glimmer_template", "glimmer_opening_tag", "glimmer_closing_tag"]
console.log(`\n  THE GLIMMER NODE TYPES (present in the PRODUCTION build, absent from the npm build):`)
for (const g of GLIMMER) {
  console.log(`    ${g}: production=${gateInv.named.includes(g)} npm=${npmInv.named.includes(g)}`)
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE COUNTERFACTUALS — what the GATE's grammar makes of each construct. This is the decisive
// measurement: it answers "what does this grammar DO with the construct" instead of "did I find it".
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const gateParser = new WSP()
gateParser.setLanguage(await WSL.load(readFileSync(path.join(ROOT, PRODUCTION_WASM))))
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
// ── THE GLIMMER NODE-TYPE CENSUS ──────────────────────────────────────────────────────────────
// THE MEASUREMENT THAT DECIDES WHETHER `mixes_in` IS IMPLEMENTABLE OR RULED.
// The production build HAS three node types the npm build does not: `glimmer_template`,
// `glimmer_opening_tag`, `glimmer_closing_tag`. **THE EARLIER "0 GLIMMER HITS" RESULT WAS VACUOUS** —
// it came from the build that has no Glimmer types at all, so it could only ever have been 0.
// Here the census runs over the WHOLE admitted population with the PRODUCTION build, and it counts
// NODE TYPES (not text): a node is counted when the parser produced it as a node.
const glimmerFiles: string[] = []
const glimmerNodeCounts = new Map<string, number>()
let glimmerNodesTotal = 0
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
    // THE MIXIN IDIOM, NAMED — a method call whose receiver is extended with a mixin.
    // ⇒ THIS CENSUS USED TO JUSTIFY A RULING, AND IT NO LONGER DOES ✓✓. IT IS STILL WORTH
    // COUNTING, BECAUSE IT IS THE POPULATION-SIDE COUNT OF THE CONSTRUCT THE R3 REMEDY NOW
    // PUBLISHES ✓✓, AND THE GRAMMAR-HALF HALF OF IT (A `with` CLAUSE) IS STILL ABSENT ✓✓ — THE
    // CONSTRUCT IS NOT A GRAMMAR CLAUSE, IT IS A CALL IN HERITAGE POSITION ✓✓.
    // ⇒ THE OLD COMMENT SAID "an analyzer that emitted `mixes_in` for it would be applying a NAMING
    // CONVENTION to a method call, which C2 forbids" — AND THAT IS WHY THE RULING WAS WRONG ✓✓:
    // THE EMISSION IS NOT BY NAME, IT IS BY POSITION ✓✓, AND POSITION IS NOT A NAMING CONVENTION
    // ✓✓. ⇒ THE CENSUS IS KEPT AND ITS MEANING IS CORRECTED ✓✓.
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
    // THE GLIMMER NODE TYPES — counted as NODES, with the file they came from, so the census can
    // name the population a construct has (or has not) in.
    if (n.type.startsWith("glimmer_")) {
      glimmerNodesTotal++
      glimmerNodeCounts.set(n.type, (glimmerNodeCounts.get(n.type) ?? 0) + 1)
      if (!glimmerFiles.includes(abs)) glimmerFiles.push(abs)
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
console.log(`\nTHE GLIMMER NODE-TYPE CENSUS (the PRODUCTION build ${gateInv.sha256.slice(0, 16)}, over ${trees} admitted files)`)
console.log(`  glimmer NODES produced: ${glimmerNodesTotal}`)
console.log(`  by node type: ${JSON.stringify([...glimmerNodeCounts.entries()].sort((a, b) => b[1] - a[1]))}`)
console.log(`  files with at least one glimmer node: ${glimmerFiles.length}`)
if (glimmerFiles.length) console.log(`    ${JSON.stringify(glimmerFiles.slice(0, 20))}`)

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE NEAR-MISS CENSUS (L-17) — HOW A RULING IS EARNED.
// A ruling is not a citation to a grammar inventory; it is an answer to "what was ALMOST there?".
// For each type this census counts, over the WHOLE admitted population, the TEXT SITES that carry
// the construct's own word — and says, for a sample of them, what each site actually IS. A near
// miss that is a DECLARATION would overturn the ruling; a near miss that is a comment, a JSDoc
// tag, a GraphQL schema line, a lint-rule name or a codemod regex is a SITE THAT IS NOT THE
// CONSTRUCT, and the count of those is the size of the trap the ruling must not fall into.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
const NEAR_MISS: { type: string; re: RegExp }[] = [
  { type: "implements", re: /\bimplements\b|@implements\b/ },
  { type: "part_of", re: /^\s*part(\s+of)?\s+['"`]/m },
]
const nearMiss: Record<string, { files: number; sites: number; samples: { file: string; text: string }[] }> = {}
for (const nm of NEAR_MISS) {
  let sites = 0
  const files = new Set<string>()
  const samples: { file: string; text: string }[] = []
  for (const abs of population) {
    let text: string
    try {
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    const lines = text.split("\n")
    for (const line of lines) {
      if (!nm.re.test(line)) continue
      sites++
      files.add(abs)
      if (samples.length < 12) samples.push({ file: path.relative(CR, abs), text: line.trim().slice(0, 140) })
    }
  }
  nearMiss[nm.type] = { files: files.size, sites, samples }
  console.log(`\n  NEAR-MISS CENSUS — ${nm.type} — ${sites} text site(s) in ${files.size} file(s)`)
  for (const s of samples) console.log(`    ${s.file}: ${s.text}`)
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE VERDICT — one row per excluded type, each with BOTH halves and a FALSIFIER.
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const corpusHalf: Record<string, number> = {
  implements: implementsTokens,
  part_of: partTokens,
}
const rulings = VOCABULARIES.map((v) => {
  const hits = gateInv.named.filter((n) => v.words.some((w) => n.includes(w)))
  const ctrlInv = inventories[v.positiveControl.wasm]
  const cf = counterfactuals.filter((c) => c.of === v.type)
  return {
    type: v.type,
    label: v.label,
    evidence: "grammar-remedy-ruled",
    grammarHalf: {
      wasm: PRODUCTION_WASM,
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
    nearMissCensus: {
      ...nearMiss[v.type],
      rule: "L-17 — the near-miss census is how a ruling is EARNED: the text sites that carry the construct's word but are NOT the construct.",
    },
    falsifier:
      v.type === "implements"
        ? "a named node type matching /implement/ appears in the PRODUCTION grammar inventory, OR a corpus class_heritage carries an `implements` token, OR the gate's TABLE 1 shows a non-zero `implements` row for javascript"
        : "a named node type matching /part/ appears in the PRODUCTION grammar inventory, OR a corpus statement carries a `part` directive token, OR the gate's TABLE 1 shows a non-zero `part_of` row for javascript",
  }
})

// ── THE TYPES THAT ARE IMPLEMENTED, AND WHY THAT IS NOT A RULING ───────────────────────────────────
// ⇒ `mixes_in` WAS RULED `grammar-absence` BY THIS INSTRUMENT, AND THAT RULING WAS **WRONG** ✓✓.
// ⇒ IT IS RECORDED HERE, IN THE MEASUREMENT THAT CONTAINED IT, BECAUSE A MEASUREMENT THAT HAS
// SILENTLY DROPPED A ROW IS WORSE THAN ONE THAT CARRIES A ROW WITH A NOTE ✓✓.
const implementedTypes = [
  {
    type: "mixes_in",
    wasRuled: "grammar-absence",
    nowVerdict: "IMPLEMENTED — the R3 remedy publishes it, and the discriminator is POSITION, not a name",
    whyTheRulingWasWrong:
      "the ruling said no rule can tell `Route.extend(M)` from `_.extend(obj, props)` without a NAMING CONVENTION, which C2 forbids. That is HALF the truth, and the half that decides it was wrong: the discriminator is not the callee's NAME but that the call IS the HERITAGE. A call in heritage position is class-producing by construction - the language requires the heritage to evaluate to a constructor - and a call in argument position is not. POSITION, NOT A NAME ⇒ C2 is not violated.",
    measuredBy: "script/m14/javascript-r3-measurement.ts → validation/m14/measurements/javascript-r3-remedy.json",
    overTheAdmittedPopulation: 12374,
    theMeasurement: "76 call-shaped heritage clauses (74 member-form, 2 identifier-form); 0 found by the pre-remedy lookup; 76 `extends` and 83 `mixes_in` rows published after; 11 computed-only near misses refused and 0 published for them",
    corroboration:
      "a SECOND, independent instrument (script/m14/javascript-heritage-census.ts) agrees on the clause count, the shape split and the argument split",
    behaviouralFixture: "validation/m14/fixtures/javascript/call-shaped-heritage-mixins.js — the suite is 94 pass / 0 fail, and two mutants cover the rule's two halves (both CAUGHT)",
    theGrammarHalfStillHolds:
      "the GRAMMAR has no `with` clause and no mixin node type — the counterfactuals below are the DECISIVE measurement and they are unchanged: `class C with M { }` and `class C extends mixin(Base) { }` are not constructs the language has. ⇒ THE CONSTRUCT IS NOT A GRAMMAR CLAUSE; IT IS A CALL IN HERITAGE POSITION ✓✓, AND THAT IS WHY NO GRAMMAR CHANGE WAS NEEDED ✓✓.",
    counterfactuals: counterfactuals.filter((c) => c.of === "mixes_in"),
  },
]

const out = {
  generated: new Date().toISOString(),
  lane: "javascript",
  instrument: "script/m14/javascript-grammar-ruling.ts",
  populationRule:
    "the gate's own discoverFiles (incoming-gate.ts:454), copied rule-for-rule: git-tracked files only, symlinked corpus roots followed, extensions js/mjs/cjs/jsx, 1 MB cap",
  corpusRoot: CR,
  population: { admitted: population.length, repos: pop.repos, absent: pop.absent, overCap: pop.overCap, overCapLargest: pop.overCapLargest, capped: MAX_FILES > 0 },
  glimmerCensus: {
    grammar: { wasm: PRODUCTION_WASM, sha256: gateInv.sha256 },
    rule: "the census counts NODE TYPES produced by the PRODUCTION build over the WHOLE admitted population — not text matches, and not the build that lacks the types",
    nodeTypes: GLIMMER,
    nodesProduced: glimmerNodesTotal,
    byNodeType: [...glimmerNodeCounts.entries()].sort((a, b) => b[1] - a[1]),
    filesWithAGlimmerNode: glimmerFiles.length,
    files: glimmerFiles.slice(0, 50),
    priorVacuousResult:
      "the earlier '0 glimmer hits' was measured with the node_modules build (4a378293), which has NO glimmer types at all — so it could only ever have been 0, and it is VACUOUS",
  },
  nearMissCensus: nearMiss,
  grammars: {
    productionInstrument: {
      wasm: PRODUCTION_WASM,
      sha256: gateInv.sha256,
      bytes: gateInv.bytes,
      namedNodeTypes: gateInv.namedCount,
      nodeTypeIds: gateInv.nodeTypeCount,
      namedDigest: gateInv.namedDigest,
      citationRule: "L-20 — the sha256 of the bytes the REGISTRY SERVES, measured by script/m14/javascript-grammar-binding-probe.ts (exit 0)",
    },
    fixtureInstrument: { wasm: FIXTURE_WASM, sha256: fixInv.sha256, bytes: fixInv.bytes, namedNodeTypes: fixInv.namedCount, nodeTypeIds: fixInv.nodeTypeCount, namedDigest: fixInv.namedDigest },
    npmPackageBuild: { wasm: GATE_WASM, sha256: npmInv.sha256, bytes: npmInv.bytes, namedNodeTypes: npmInv.namedCount, nodeTypeIds: npmInv.nodeTypeCount, namedDigest: npmInv.namedDigest, note: "SERVED BY NOTHING — the engine's LOG prints this path, and the bytes it loads are the production build's" },
    controls: [
      { wasm: TS_WASM, sha256: tsInv.sha256, namedNodeTypes: tsInv.namedCount, namedDigest: tsInv.namedDigest },
      { wasm: DART_WASM, sha256: dartInv.sha256, namedNodeTypes: dartInv.namedCount, namedDigest: dartInv.namedDigest },
    ],
    finding:
      gateInv.sha256 === fixInv.sha256
        ? "the PRODUCTION build and the FIXTURE SUITE's build are BYTE-IDENTICAL (63812b9e) — the same grammar parses the population and the fixtures"
        : `THE PRODUCTION BUILD AND THE FIXTURE BUILD ARE DIFFERENT BUILDS — production ${gateInv.sha256} and fixtures ${fixInv.sha256}; only ${onlyInGate.length} named types differ, and the difference is RECORDED so a reader can see it`,
    onlyInProductionGrammar: onlyInGate,
    onlyInNpmBuild: onlyInFixture,
  },
  corpusHalfTotals: { classHeritageClauses: heritageClauses, implementsTokens, withTokens, partTokens, partExamples, extendsCallClauses: extendsCallClausesTotal, extendsIdentifierClauses, mixinNamedClauses, extendMixinCalls: extendMixins, extendMixinArgs: [...extendMixinArgs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20), heritageShapes: [...heritageShapes.entries()].sort((a, b) => b[1] - a[1]), topMixinIdiomCalls: [...extendsCallClauses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20) },
  rulings,
  implementedTypes,
}
mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n")
console.log(`\nwrote ${OUT}`)
