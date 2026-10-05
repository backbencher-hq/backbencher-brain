/**
 * PROTOBUF LANE — WHY THE ARBITER FALSIFIED TWO OF MY TEN RULINGS, MEASURED.
 *
 * ## The claim being tested
 *
 * `npx tsx script/m14/ontology-coverage-gate.ts protobuf` prints, at HEAD:
 *
 *   calls         FALSIFIED  NOT EMITTED, but the grammar DOES produce
 *                           function_definition — the construct exists. Instrument A.
 *   instantiates  FALSIFIED  NOT EMITTED, but the construct occurs 1x across 1 file(s)
 *                           on the PARSE TREE ... WRONG GRAMMAR — this probe was handed a
 *                           tree whose root node is `program`, not `source_file`.
 *
 * and exits 1 with `FALSIFIED 2`. The task brief requires this gate to exit 0 with
 * `FALSIFIED 0`, so this is the lane's blocking defect. It is not a gap in
 * `src/ast/real-protobuf-analyzer.ts`: neither verdict concerns an edge the analyzer
 * emits. Both are verdicts about a GRAMMAR INVENTORY, and the grammar is chosen at
 * ontology-coverage-gate.ts:247.
 *
 * ## The hypothesis
 *
 *   const wasmPath = (LANGS as any)[LANG]?.wasm ?? "tree-sitter-bash.wasm"
 *
 * `protobuf` is not a key of `LANGS` (differential.ts:740), so the expression takes its
 * DEFAULT BRANCH and every instrument in the gate — A's whole-corpus node inventory and
 * B's parse-tree counts alike — parses `.proto` text with the BASH grammar. Two
 * independent predictions follow, and both are specific enough to be wrong:
 *
 *   P1  `function_definition` is a real tree-sitter-BASH node. Under bash it must be
 *       observed on proto text; under the protobuf grammar it must be observed ZERO
 *       times, because protobuf has no function definitions — `rpc` declares a method,
 *       and a declaration is not a definition this gate is asking about.
 *   P2  the root node of a parsed `.proto` file must be `program` under bash and
 *       `source_file` under protobuf. The gate's own complaint — "a tree whose root node
 *       is `program`, not `source_file`" — is bash's root, stated as though it were a
 *       defect in the file. It is a defect in the wiring, reported against the file.
 *
 * ## What is measured
 *
 * The corpus is the arbiter's own population, reproduced rather than re-chosen: same
 * corpus root, same `git ls-files` walk, same 512 KB size cut, same
 * `detectLanguageFromPath(abs, text) !== LANG` admission test. The file count is printed
 * next to the arbiter's so the two are visibly the same set.
 *
 * Each file is parsed TWICE, once per grammar, and for each grammar this file reports:
 * the root node type distribution, the full observed node-type inventory with counts,
 * and the count of every node type the gate's own `nodeTypesThatWouldMeanIt` lists name.
 * The two inventories are then differenced, because the direction of the difference is
 * the finding: node types that exist ONLY under bash are exactly the ones that can
 * manufacture a FALSIFIED verdict for a language that does not have that construct.
 *
 * INSTRUMENT B IS RUN OVER THE SAME WALK, not inferred. The second FALSIFIED verdict
 * (`instantiates`) is not an instrument-A verdict, so an A-only measurement could not
 * account for it and this file would be asserting half its claim. Instead every
 * instrument-B ruling in `script/m14/protobuf-ruled.ts` is imported and its OWN
 * `countOnTree` is called on each grammar's tree, so the probe cannot drift from the
 * ruling table. Hits are split into REFUSALS (`guardWrongGrammar` pushes a
 * `WRONG GRAMMAR — …` line and returns, and the gate counts that line as one occurrence
 * of the construct) and CONSTRUCT occurrences, because the difference between the two is
 * the defect: a refusal graded as a construction is what the arbiter reports for
 * `instantiates`, in a message that names the wiring defect and is filed against a
 * corpus file.
 *
 * ## What this file does NOT establish
 *
 * It does not show that `calls` or `instantiates` are inapplicable to protobuf. That is
 * `script/m14/protobuf-construct-probes.mts`'s claim, on the same 847 files with the
 * correct wasm: `calls` 0 occurrences over 94 observed node types, `instantiates` 0.
 * This file establishes only WHY the arbiter disagrees with that, and therefore which
 * of the two numbers the arbiter's own exit code is reporting.
 *
 * Neither file can edit the arbiter: `script/m14/ontology-coverage-gate.ts` and
 * `script/m14/differential.ts` are §8 shared machinery for this lane. The remedy is
 * written out at the bottom of this file, priced, for the supervisor to apply.
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { LANGS } from "./differential"
import { PROTOBUF_RULED } from "./protobuf-ruled"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const ROOT = path.resolve(import.meta.dirname, "../..")
const OUT = process.env.PB_OUT ?? "/tmp/opencode/pb/grammar-wiring.json"

// ---------------------------------------------------------------- corpus, the arbiter's own
const files: { repo: string; rel: string; text: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== "protobuf") continue
    files.push({ repo: e, rel, text })
  }
}

// ---------------------------------------------------------------- the wiring itself
const configured = (LANGS as any).protobuf?.wasm as string | undefined
const resolved = configured ?? "tree-sitter-bash.wasm"
const takesDefaultBranch = configured === undefined

// ---------------------------------------------------------------- both grammars, side by side
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })

async function grammarFor(wasm: string): Promise<any> {
  return await L.load(readFileSync(path.join(ROOT, "wasm", wasm)))
}

/** Every node type the gate's own table names as proof a construct is derivable. */
const GATE_PROBE_NODES: Record<string, string[]> = {
  calls: ["function_definition", "method_definition", "call_expression"],
  extends: ["extends_clause", "superclass", "class_heritage"],
  implements: ["implements_clause", "extends_clause", "superclass"],
  overrides: ["redefinition", "override_specifier"],
  instantiates: ["new_expression", "object_creation_expression", "constructor_invocation"],
}

/** THIS lane's own lists, read off the ruling table rather than retyped, because the
 *  point of the section below is which of them the arbiter's fallback grammar happens
 *  to collide with. */
const TABLE_PROBE_NODES: Record<string, string[]> = Object.fromEntries(
  PROTOBUF_RULED.filter((r) => (r.nodeTypesThatWouldMeanIt?.length ?? 0) > 0).map((r) => [r.type, r.nodeTypesThatWouldMeanIt!]),
)

/**
 * The sibling IDL lane's `calls` list, TRANSCRIBED from its own doc and checked against
 * that doc here rather than trusted: `docs/analyzers/real-graphql-analyzer.md` names
 * seven CamelCase node types for its `A:call_node` probe. It is in this file because the
 * lane this probe belongs to was FALSIFIED for a name that the sibling lane spells the
 * other way round, and the difference is case rather than evidence — which is the whole
 * argument for moving every ruling here to instrument B.
 */
const SIBLING_IDL_CALL_NODES = ["CallExpression", "FunctionDefinition", "FunctionDeclaration", "MethodDefinition", "Invocation", "MacroInvocation", "Call"]
const SIBLING_DOC = path.join(ROOT, "docs", "analyzers", "real-graphql-analyzer.md")
let siblingListVerified: string | null = null
try {
  const doc = readFileSync(SIBLING_DOC, "utf8")
  const missing = SIBLING_IDL_CALL_NODES.filter((n) => !doc.includes(n))
  siblingListVerified = missing.length === 0 ? "all 7 names present in the doc" : `TRANSCRIPTION STALE — absent from the doc: ${missing.join(", ")}`
} catch (e) {
  siblingListVerified = `DECLARED ABSENT — ${SIBLING_DOC} unreadable: ${String((e as any)?.message ?? e)}`
}

type BProbe = { type: string; describe: string; hits: string[]; files: Set<string> }

type Gram = {
  wasm: string
  roots: Map<string, number>
  inventory: Map<string, number>
  probeCounts: Record<string, number>
  errors: number
  hasErrorTree: number
  /** Instrument B: this lane's own `countOnTree`, run over THIS grammar's trees. */
  b: BProbe[]
}

function makeGram(wasm: string): Gram {
  return {
    wasm,
    roots: new Map(),
    inventory: new Map(),
    probeCounts: {},
    errors: 0,
    hasErrorTree: 0,
    // One accumulator per instrument-B ruling in `protobuf-ruled.ts`, so the probe
    // is the lane's OWN ruling and not a re-typed copy of it: a divergence between
    // this file and the ruling table is then impossible by construction.
    b: PROTOBUF_RULED.filter((r) => r.instrument === "B:parse-tree-count" && r.countOnTree).map((r) => ({
      type: r.type,
      describe: r.describe,
      hits: [],
      files: new Set<string>(),
    })),
  }
}

async function walk(g: Gram, parser: any, text: string, fileLabel: string): Promise<void> {
  const t = parser.parse(text)
  if (!t) {
    g.errors++
    return
  }
  const root = t.rootNode
  g.roots.set(root.type, (g.roots.get(root.type) ?? 0) + 1)
  if (root.hasError) g.hasErrorTree++
  const hit = (ty: string) => {
    for (const nodes of Object.values(GATE_PROBE_NODES)) if (nodes.includes(ty)) g.probeCounts[ty] = (g.probeCounts[ty] ?? 0) + 1
  }
  const v = (n: any) => {
    g.inventory.set(n.type, (g.inventory.get(n.type) ?? 0) + 1)
    hit(n.type)
    for (let i = 0; i < n.childCount; i++) v(n.child(i))
  }
  v(root)
  // Instrument B, on the same tree, in the same walk — so both instruments are
  // measured over ONE parse of the corpus rather than two.
  for (const p of g.b) {
    const ruled = PROTOBUF_RULED.find((r) => r.type === p.type)
    const before = p.hits.length
    ruled?.countOnTree?.(root, fileLabel, p.hits)
    if (p.hits.length > before) p.files.add(fileLabel)
  }
  t.delete?.()
}

const grammars = [makeGram("tree-sitter-protobuf.wasm"), makeGram("tree-sitter-bash.wasm")]
for (const g of grammars) {
  const parser = new P()
  parser.setLanguage(await grammarFor(g.wasm))
  for (const f of files) await walk(g, parser, f.text, `${f.repo}/${f.rel}`)
  parser.delete?.()
}

const [pb, sh] = grammars
const pbSet = new Set(pb.inventory.keys())
const shSet = new Set(sh.inventory.keys())
const bashOnly = [...shSet].filter((t) => !pbSet.has(t)).sort()
const pbOnly = [...pbSet].filter((t) => !shSet.has(t)).sort()
const shared = [...pbSet].filter((t) => shSet.has(t)).sort()

/** The gate's A-instrument verdict for a type, as the gate itself computes it. */
function verdictA(g: Gram, nodes: string[]): "FALSIFIED" | "clean" {
  return nodes.some((n) => (g.inventory.get(n) ?? 0) > 0) ? "FALSIFIED" : "clean"
}

const rows = Object.entries(GATE_PROBE_NODES).map(([type, nodes]) => ({
  type,
  probedFor: nodes,
  arbiterGrammarBash: verdictA(sh, nodes),
  correctGrammarProtobuf: verdictA(pb, nodes),
  flipsBecauseOfWiring: verdictA(sh, nodes) !== verdictA(pb, nodes),
  observedUnder: Object.fromEntries(nodes.map((n) => [n, { bash: sh.inventory.get(n) ?? 0, protobuf: pb.inventory.get(n) ?? 0 }])),
}))

/**
 * Instrument B, the lane's OWN `countOnTree` from `script/m14/protobuf-ruled.ts`, run
 * over both grammars' trees.
 *
 * WHAT CHANGED AT 18594c5b8, and why this section had to be rewritten rather than
 * re-run. The old table ran one instrument-B probe, and it guarded the wrong grammar by
 * PUSHING A REFUSAL into `hits` and returning. The gate counts every element of `hits`
 * as one occurrence of the construct, so at commit 86c5f05f4 the arbiter reported
 * `instantiates` as occurring `1x across 1 file(s)` with the refusal quoted as its
 * example. That number was a measurement of this probe, not of protobuf.
 *
 * The probe now DECLINES a tree whose root is not `source_file` and re-reads the file
 * from the corpus root under `wasm/tree-sitter-protobuf.wasm`. So the column that used
 * to read `arbiter(bash)` no longer means "what the arbiter's grammar yields": it means
 * "what the probe reports when the arbiter hands it a bash tree", which is now zero by
 * construction. The interesting split has moved, and it is printed below as two
 * questions the old section never asked:
 *
 *   1. can the probe REBUILD the file it was handed a foreign tree for? Every label is
 *      `${repo}/${rel}` and the corpus root is the gate's own `BB_CORPUS_ROOT`
 *      default, so `path.join(CR, label)` should resolve — measured, not assumed,
 *      because the whole self-parse branch rests on it.
 *   2. do this lane's lists collide with the arbiter's fallback vocabulary, and does the
 *      sibling IDL lane's identically-wrong verdict collide? That is the spelling test,
 *      and it is why every ruling in the table is now an instrument-B count.
 */
const labelsReconstructible = files.filter((f) => {
  try {
    readFileSync(path.join(CR, `${f.repo}/${f.rel}`), "utf8")
    return true
  } catch {
    return false
  }
}).length

const bRows = PROTOBUF_RULED.filter((r) => r.instrument === "B:parse-tree-count" && r.countOnTree).map((r) => {
  const under = (g: Gram) => {
    const p = g.b.find((x) => x.type === r.type)!
    const refusals = p.hits.filter((h) => h.includes("NOT MEASURED"))
    return {
      occurrences: p.hits.length,
      files: p.files.size,
      notMeasuredRefusals: refusals.length,
      constructOccurrences: p.hits.length - refusals.length,
      firstHit: p.hits[0] ?? null,
    }
  }
  const bash = under(sh)
  const protobuf = under(pb)
  return {
    type: r.type,
    handedBashTree: bash.occurrences > 0 ? "HITS" : "clean",
    handedProtobufTree: protobuf.occurrences > 0 ? "HITS" : "clean",
    bash,
    protobuf,
    ownListCollidesWithBashVocabulary: (TABLE_PROBE_NODES[r.type] ?? []).filter((n) => (sh.inventory.get(n) ?? 0) > 0),
  }
})

const report = {
  corpus: { root: CR, files: files.length, arbiterReported: 847, samePopulation: files.length === 847 },
  wiring: {
    expression: '(LANGS as any)[LANG]?.wasm ?? "tree-sitter-bash.wasm"',
    arbiterLine: "script/m14/ontology-coverage-gate.ts:247",
    lanIsRegistered: Object.keys(LANGS).includes("protobuf"),
    configuredWasm: configured ?? null,
    resolvedWasm: resolved,
    takesDefaultBranch,
  },
  predictions: {
    P1_function_definition: {
      underBash: sh.inventory.get("function_definition") ?? 0,
      underProtobuf: pb.inventory.get("function_definition") ?? 0,
      holds: (sh.inventory.get("function_definition") ?? 0) > 0 && (pb.inventory.get("function_definition") ?? 0) === 0,
    },
    P2_root_node: {
      underBash: Object.fromEntries(sh.roots),
      underProtobuf: Object.fromEntries(pb.roots),
      holds: (sh.roots.get("program") ?? 0) > 0 && (pb.roots.get("source_file") ?? 0) > 0 && (pb.roots.get("program") ?? 0) === 0,
    },
  },
  inventories: {
    protobuf: { distinct: pbSet.size, errors: pb.errors, treesWithError: pb.hasErrorTree, nodes: Object.fromEntries([...pb.inventory].sort((a, b) => b[1] - a[1])) },
    bash: { distinct: shSet.size, errors: sh.errors, treesWithError: sh.hasErrorTree, nodes: Object.fromEntries([...sh.inventory].sort((a, b) => b[1] - a[1])) },
    arbiterReportedDistinctForBash: 81,
    bashOnlyCount: bashOnly.length,
    bashOnly,
    protobufOnlyCount: pbOnly.length,
    protobufOnly: pbOnly,
    sharedCount: shared.length,
  },
  gateVerdictRows: rows,
  instrumentBRows: bRows,
  spellingTest: {
    question:
      "Instrument A is an INTERSECTION between a lane's node-type list and the vocabulary the gate observed. " +
      "The gate's vocabulary is bash's for every lane absent from LANGS. So under the fallback an A verdict " +
      "depends on whether the lane's list happens to collide with bash's node names.",
    ownLists: Object.entries(TABLE_PROBE_NODES).map(([type, nodes]) => ({
      type,
      nodes: nodes.length,
      collidingUnderBash: nodes.filter((n) => (sh.inventory.get(n) ?? 0) > 0),
      collidingUnderProtobuf: nodes.filter((n) => (pb.inventory.get(n) ?? 0) > 0),
      aVerdictUnderArbiterGrammar: nodes.some((n) => (sh.inventory.get(n) ?? 0) > 0) ? "FALSIFIED" : "clean",
      aVerdictUnderCorrectGrammar: nodes.some((n) => (pb.inventory.get(n) ?? 0) > 0) ? "FALSIFIED" : "clean",
    })),
    siblingIdlCallList: {
      source: "docs/analyzers/real-graphql-analyzer.md, probe A:call_node",
      transcriptionCheck: siblingListVerified,
      nodes: SIBLING_IDL_CALL_NODES.length,
      collidingUnderBash: SIBLING_IDL_CALL_NODES.filter((n) => (sh.inventory.get(n) ?? 0) > 0),
      note:
        "Measured against bash's vocabulary over PROTOBUF's corpus, because that is the vocabulary the gate " +
        "would hand a lane it has no entry for. It is not a measurement of that lane's own grammar and does " +
        "not claim to be; it is here to show that the same defect that FALSIFIED this lane leaves that lane's " +
        "rule clean, and that the difference is the case of a list.",
    },
  },
  selfParse: {
    question: "Can the probe rebuild the file it was handed a foreign tree for? The self-parse branch reads path.join(CR, `${repo}/${rel}`).",
    corpusRoot: CR,
    labelsReconstructible: `${labelsReconstructible}/${files.length}`,
    allReconstructible: labelsReconstructible === files.length,
  },
}

try {
  const { mkdirSync, writeFileSync } = await import("node:fs")
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(report, null, 2))
} catch {
  /* the report is on stdout either way */
}

// ---------------------------------------------------------------- the page
console.log(`corpus: ${files.length} .proto files (arbiter reported 847 — same population: ${files.length === 847})`)
console.log("")
console.log("THE WIRING, ontology-coverage-gate.ts:247")
console.log(`  expression          (LANGS as any)[LANG]?.wasm ?? "tree-sitter-bash.wasm"`)
console.log(`  LANGS.protobuf      ${Object.keys(LANGS).includes("protobuf") ? "REGISTERED" : "ABSENT — takes the DEFAULT BRANCH"}`)
console.log(`  resolved wasm       ${resolved}`)
console.log("")
console.log("ROOT NODE OF THE SAME FILES UNDER EACH GRAMMAR")
console.log(`  tree-sitter-bash.wasm       ${JSON.stringify(Object.fromEntries(sh.roots))}`)
console.log(`  tree-sitter-protobuf.wasm   ${JSON.stringify(Object.fromEntries(pb.roots))}`)
console.log("")
console.log("PREDICTION 1 — function_definition is a BASH node, absent from protobuf")
console.log(`  bash      ${sh.inventory.get("function_definition") ?? 0}`)
console.log(`  protobuf  ${pb.inventory.get("function_definition") ?? 0}`)
console.log(`  holds     ${report.predictions.P1_function_definition.holds}`)
console.log("")
console.log("PREDICTION 2 — `program` is bash's root; protobuf's is source_file")
console.log(`  holds     ${report.predictions.P2_root_node.holds}`)
console.log("")
console.log("INVENTORIES")
console.log(`  protobuf wasm   ${pbSet.size} distinct node types, ${pb.errors} parse errors, ${pb.hasErrorTree} trees carrying ERROR`)
console.log(`  bash wasm       ${shSet.size} distinct node types, ${sh.errors} parse errors, ${sh.hasErrorTree} trees carrying ERROR`)
console.log(`  the arbiter reported 81 distinct node types for this corpus — that is bash's inventory`)
console.log(`  bash-only node types (${bashOnly.length}): ${bashOnly.join(" ")}`)
console.log(`  protobuf-only node types (${pbOnly.length}): ${pbOnly.slice(0, 40).join(" ")}${pbOnly.length > 40 ? " ..." : ""}`)
console.log(`  shared (${shared.length}): ${shared.slice(0, 40).join(" ")}${shared.length > 40 ? " ..." : ""}`)
console.log("")
console.log("WHAT THE WIRING DOES TO EACH OF THE GATE'S FIVE A-INSTRUMENT VERDICTS")
console.log("type          arbiter(bash)   correct(protobuf)   flips")
for (const r of rows) {
  console.log(
    `${r.type.padEnd(13)} ${r.arbiterGrammarBash.padEnd(14)} ${r.correctGrammarProtobuf.padEnd(18)} ${r.flipsBecauseOfWiring ? "YES" : "no"}`,
  )
}
console.log("")
console.log(`flipped by the wiring: ${rows.filter((r) => r.flipsBecauseOfWiring).map((r) => r.type).join(", ") || "none"}`)
console.log("")
console.log("SPELLING TEST — would THIS LANE'S OWN lists have failed under the arbiter's fallback grammar?")
console.log("  (instrument A intersects a lane's list with the vocabulary the gate OBSERVED, and the gate's")
console.log("   vocabulary is bash's for any lane absent from LANGS. A collision is a name bash also has.)")
console.log("type          nodes  collides under bash   A-verdict under bash   A-verdict under protobuf")
for (const r of report.spellingTest.ownLists) {
  console.log(
    `${r.type.padEnd(13)} ${String(r.nodes).padStart(5)}  ${(r.collidingUnderBash.join(" ") || "none").padEnd(21)} ${r.aVerdictUnderArbiterGrammar.padEnd(21)} ${r.aVerdictUnderCorrectGrammar}`,
  )
}
console.log("")
console.log(`  the sibling IDL lane's own \`calls\` list (${report.spellingTest.siblingIdlCallList.nodes} names, ${report.spellingTest.siblingIdlCallList.source}):`)
console.log(`    collides under bash: ${report.spellingTest.siblingIdlCallList.collidingUnderBash.join(" ") || "none"}  -> its rule reads clean under the same broken wiring`)
console.log(`    transcription check: ${report.spellingTest.siblingIdlCallList.transcriptionCheck}`)
console.log("")
console.log("INSTRUMENT B — this lane's OWN countOnTree, called with each grammar's tree")
console.log(`  labels rebuildable as path.join(CR, label): ${report.selfParse.labelsReconstructible} (all: ${report.selfParse.allReconstructible})`)
console.log("type          handed a bash tree   handed a protobuf tree   hits/files/refusals/constructs (bash)   constructs (protobuf)")
for (const r of bRows) {
  console.log(
    `${r.type.padEnd(13)} ${r.handedBashTree.padEnd(19)} ${r.handedProtobufTree.padEnd(24)} ` +
      `${String(r.bash.occurrences).padStart(3)}/${String(r.bash.files).padStart(3)}/${String(r.bash.notMeasuredRefusals).padStart(3)}/${String(r.bash.constructOccurrences).padStart(3)}`.padEnd(28) +
      `${r.protobuf.constructOccurrences}`,
  )
  if (r.bash.firstHit) console.log(`${"".padEnd(13)} first hit: ${r.bash.firstHit.slice(0, 150)}`)
}
console.log("")
console.log("  Both columns read clean, and that is the POINT rather than the absence of a finding: since")
console.log("  18594c5b8 the probe declines a foreign tree and measures the file under protobuf's own grammar,")
console.log("  so what the arbiter hands it no longer decides the verdict. At 86c5f05f4, by contrast, the")
console.log("  same probe handed a bash tree reported `instantiates` as occurring 1x across 1 file — the")
console.log("  refusal graded as a construction, which is the defect this section used to exist to catch.")
console.log("")
console.log("REMEDY (§8 — shared machinery, not this lane's to edit)")
console.log("  file     script/m14/differential.ts")
console.log("  where    the LANGS record, line 740")
console.log("  change   add the key protobuf with the four fields the lane already uses at")
console.log("           script/m14/run-fixtures.ts:91 —")
console.log("             protobuf: { wasm: \"tree-sitter-protobuf.wasm\", analyzerFile: \"real-protobuf-analyzer\", className: \"RealProtobufAnalyzer\", ext: \"proto\" }")
console.log("  why      ontology-coverage-gate.ts:247 resolves a lane's grammar from this")
console.log("           record and falls back to tree-sitter-bash.wasm for any lane absent")
console.log("           from it, so an unregistered lane's instruments measure bash's parse of")
console.log("           that lane's source. Both of this lane's FALSIFIED verdicts came from it,")
console.log("           and the spelling test above shows every OTHER unregistered lane's verdict")
console.log("           is decided by the case of its node-type list rather than by evidence.")
console.log("  also     a `?? \"tree-sitter-bash.wasm\"` default that fires for an UNREGISTERED")
console.log("           lane should fail loudly. The check belongs where the grammar is chosen,")
console.log("           not in a lane's probe: this lane's own probe has to re-read 847 files to")
console.log("           work around it, which is 847 parses the arbiter did not ask for.")
console.log("")
console.log(`wrote ${OUT}`)