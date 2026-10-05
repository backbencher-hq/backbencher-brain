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
 * Instrument B, the lane's OWN `countOnTree` from `protobuf-ruled.ts`, run over both
 * grammars' trees.
 *
 * The split that matters here is between a hit that is the CONSTRUCT and a hit that is
 * the probe REFUSING to report on a tree it recognises as foreign: `guardWrongGrammar`
 * pushes a `WRONG GRAMMAR — …` line and returns, and the gate counts every line in
 * `hits` as one occurrence of the construct and grades it FALSIFIED. So a hit carrying
 * that marker is counted separately from a construct hit, because grading a refusal as
 * a construction is the whole defect.
 */
const bRows = PROTOBUF_RULED.filter((r) => r.instrument === "B:parse-tree-count" && r.countOnTree).map((r) => {
  const under = (g: Gram) => {
    const p = g.b.find((x) => x.type === r.type)!
    const refusals = p.hits.filter((h) => h.includes("WRONG GRAMMAR"))
    return {
      occurrences: p.hits.length,
      files: p.files.size,
      wrongGrammarRefusals: refusals.length,
      constructOccurrences: p.hits.length - refusals.length,
      firstHit: p.hits[0] ?? null,
    }
  }
  const bash = under(sh)
  const protobuf = under(pb)
  return {
    type: r.type,
    arbiterGrammarBash: bash.occurrences > 0 ? "FALSIFIED" : "clean",
    correctGrammarProtobuf: protobuf.occurrences > 0 ? "FALSIFIED" : "clean",
    flipsBecauseOfWiring: bash.occurrences > 0 !== protobuf.occurrences > 0,
    bash,
    protobuf,
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
console.log("INSTRUMENT B — this lane's OWN countOnTree, run over each grammar's trees")
console.log("type          arbiter(bash)   correct(protobuf)   flips   bash hits / files / refusals / constructs   protobuf hits")
for (const r of bRows) {
  console.log(
    `${r.type.padEnd(13)} ${r.arbiterGrammarBash.padEnd(14)} ${r.correctGrammarProtobuf.padEnd(18)} ${(r.flipsBecauseOfWiring ? "YES" : "no").padEnd(6)} ` +
      `${String(r.bash.occurrences).padStart(3)} / ${String(r.bash.files).padStart(3)} / ${String(r.bash.wrongGrammarRefusals).padStart(3)} / ${String(r.bash.constructOccurrences).padStart(3)}`.padEnd(34) +
      `${r.protobuf.occurrences} / ${r.protobuf.files} files / ${r.protobuf.constructOccurrences} constructs`,
  )
  if (r.bash.firstHit) console.log(`${"".padEnd(13)} bash first hit: ${r.bash.firstHit.slice(0, 150)}`)
}
console.log("")
console.log(`instrument B flipped by the wiring: ${bRows.filter((r) => r.flipsBecauseOfWiring).map((r) => r.type).join(", ") || "none"}`)
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
console.log("           that lane's source. Both of this lane's FALSIFIED verdicts come from it.")
console.log("  also     a `?? \"tree-sitter-bash.wasm\"` default that fires for an UNREGISTERED")
console.log("           lane should fail loudly, as the gate's own instantiates row tries to do")
console.log("           (\"WRONG GRAMMAR — this probe was handed a tree whose root node is")
console.log("           `program`, not `source_file`\"). That complaint is correct and is filed")
console.log("           against the corpus file; it is a wiring defect, so the check belongs")
console.log("           where the grammar is chosen.")
console.log("")
console.log(`wrote ${OUT}`)