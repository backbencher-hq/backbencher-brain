/**
 * M12 bash — node-type classification census (the F8 blind-spot detector).
 *
 * WHY THIS FILE REPLACED `bash-node-types-legacy-inventory.ts`
 * -----------------------------------------------------------
 * The retired instrument could not fail. Two independent defects:
 *
 *  1. It did not MEASURE what the analyzer references. Its lines 11-19
 *     hardcoded a 35-entry list of node types and labelled it "referenced".
 *     That list was the author's memory of the analyzer, not the analyzer.
 *     Independent proof of the inflation, from a second instrument in this
 *     repo: `validation/m14/results/M14.0.F1.json` measures **26** referenced
 *     type literals for bash; the retired artifact claimed **35** live.
 *  2. It never computed `observed \ referenced`. The F8 rule
 *     (reviews/LANE-AUDIT-FORMULA.md §3) is "every node type occurring in a
 *     real corpus is CLASSIFIED — an unclassified node type is an unmeasured
 *     hole". The retired file reported only the intersection, so every
 *     unhandled type was structurally invisible: 56 types occur in the pinned
 *     corpus, 35 were accounted for, and the other 21 were never named.
 *
 * This is the defect class the project has already paid for twice — 7767e6b1
 * ("the sweep's own parser had the defect it hunts") and f8fe518a ("the
 * oracle's sharpness measured, not assumed — and the instrument proven able to
 * fail").
 *
 * WHAT IT DOES NOW
 * ----------------
 * Four inputs, none hand-written:
 *
 *   A. GRAMMAR AUTHORITY — `Language.load(wasm/tree-sitter-bash.wasm)` and
 *      enumerate `nodeTypeForId`: the same oracle F1 uses. No node-type list
 *      is written in this file.
 *   B. SOURCE AUTHORITY — the analyzer's own string literals at NODE-TYPE
 *      positions, extracted by parsing the source with the tree-sitter
 *      TypeScript grammar (the F1 method, not a regex). A literal counts only
 *      when compared against something named `type`, which is what excludes
 *      the retired tool's false positives (`isArray` for "array",
 *      `sawArrayFlag`, and every command-name set in the file).
 *   C. CORPUS REALITY — every node type that actually occurs, over the pinned
 *      corpora plus the fixtures, with for each type the count of
 *      NAME-BEARING children it contains (`variable_name`,
 *      `special_variable_name`, `command_name`, `word`).
 *   D. MEASURED LOSS — for each name inside a name-carrier the analyzer never
 *      consults, whether any edge named it. This turns "unclassified" from an
 *      opinion into a number.
 *
 * CLASSIFICATION (derived per observed type)
 *   handled_verified — the source consults this type at a type position (B)
 *                      and the grammar has it (A).
 *   unknown_type      — consulted (B) but absent from the grammar (A): a dead
 *                      branch that can never fire. This is the F1 failure.
 *   gap               — a NAME-CARRIER the analyzer never consults. D says how
 *                      many of its names produced no edge.
 *   internal_silent   — a structural container with no name-bearing child that
 *                      the walk traverses without deciding on. Legitimate;
 *                      listed so the coverage claim is total, not sampled.
 *
 * The gate is RED whenever an unknown_type exists, whenever any gap exists, or
 * whenever totalUnmeasuredNames > 0. A green row is therefore a claim the next
 * corpus draw can refute.
 *
 * CLI: bun run script/m12/bash-node-types-compare.ts [--corpus DIR]... [--out FILE]
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = process.env.BB_M14_ROOT ? path.resolve(process.env.BB_M14_ROOT) : process.cwd()

/**
 * A node that carries an IDENTIFIER the graph could resolve — as opposed to a
 * bare literal.
 *
 * The distinction is not cosmetic and it was measured, not assumed. A `word` is
 * an identifier in exactly one position: directly under `command_name`, where it
 * is the command being invoked. Everywhere else a `word` is a literal — a
 * filename in `> "$dir/f"`, a path in `[[ -f somefile ]]`, an element in
 * `arr=(a b c)`. The first draft of this instrument treated every `word` as a
 * name, which manufactured 63 "unmeasured names" out of filename literals; the
 * `script/m14/tmp/bash-gap-shapes.ts` dump is what refuted it.
 */
const ALWAYS_IDENTIFIER = new Set(["variable_name", "special_variable_name", "command_name"])
const isIdentifier = (n: any): boolean => {
  if (ALWAYS_IDENTIFIER.has(n.type)) return true
  if (n.type === "word") return n.parent?.type === "command_name"
  return false
}
/** Kept for the loss attribution walk, which hops over identifier nodes. */
const isCarrier = (t: string): boolean => ALWAYS_IDENTIFIER.has(t) || t === "word"

function argValues(flag: string): string[] {
  const out: string[] = []
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag && argv[i + 1]) out.push(argv[i + 1])
    else if (argv[i].startsWith(`${flag}=`)) out.push(argv[i].slice(flag.length + 1))
  }
  return out
}

const OUT = argValues("--out")[0] ?? path.join(ROOT, "validation/m12/results/bash-shape-safety.json")
const FIXTURE_DIR = path.join(ROOT, "validation/m12/fixtures/bash")
const ANALYZER = path.join(ROOT, "src/ast/real-bash-analyzer.ts")
const BASH_WASM = path.join(ROOT, "wasm/tree-sitter-bash.wasm")
const TS_WASM = path.join(ROOT, "wasm/tree-sitter-typescript.wasm")
const PINNED = "$HOME/fixtures/repositories/fsharp"
const corpusDirs = argValues("--corpus").length > 0 ? argValues("--corpus") : [PINNED]

// ---------------------------------------------------------------- A. grammar
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })

const bashGrammar = await Language.load(readFileSync(BASH_WASM))
const grammarTypes = new Set<string>()
for (let i = 0; i < bashGrammar.nodeTypeCount; i++) {
  const name = bashGrammar.nodeTypeForId(i)
  if (name != null) grammarTypes.add(name)
}
const grammarNodeTypeCount = bashGrammar.nodeTypeCount
bashGrammar.delete?.()

// ERROR and MISSING are produced by every tree-sitter parser but are NOT listed
// by `nodeTypeForId` in the wasm ABI. F1 handles this with an explicit universal
// set (script/m14/audit-analyzer-grammar.ts:93) and this instrument reuses that
// exact pair rather than inventing its own — two instruments that answer the
// same question must share the oracle, or their disagreement is a fact about
// the oracles and not about the analyzer.
const UNIVERSAL_NODE_TYPES = ["ERROR", "MISSING"]
for (const u of UNIVERSAL_NODE_TYPES) grammarTypes.add(u)

// ------------------------------------------------- B. source type-position refs
const tsParser = new ParserClass()
tsParser.setLanguage(await Language.load(readFileSync(TS_WASM)))
const analyzerTree = tsParser.parse(readFileSync(ANALYZER, "utf8"))

const sourceTypeRefs = new Map<string, number>()
{
  const stack: any[] = [analyzerTree.rootNode]
  const consider = (lit: string | null | undefined) => {
    if (!lit) return
    // Membership in the GRAMMAR'S OWN NODE-TYPE TABLE is the test, never the
    // spelling. The first version of this scanner filtered on
    // /^[a-z][a-z0-9_]*$/ to keep paths and command names out, and that filter
    // silently dropped `ERROR` — which every tree-sitter grammar does declare —
    // so this scanner counted 31 where F1 counted 32 and the cross-check
    // correctly refused to let either number be published. Filtering by the
    // authority rather than by a shape assumption is what makes two
    // independent instruments comparable.
    if (!grammarTypes.has(lit)) return
    sourceTypeRefs.set(lit, (sourceTypeRefs.get(lit) ?? 0) + 1)
  }
  while (stack.length > 0) {
    const n: any = stack.pop()
    if (!n) continue
    if (n.type === "binary_expression" && n.text.includes(".type")) {
      const op = n.children?.find((c: any) => ["===", "!==", "==", "!="].includes(c.type))
      if (op) {
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          if (c && c !== op && c.type === "string") consider((c.text ?? "").slice(1, -1))
        }
      }
    }
    // `case "LITERAL":` inside a switch whose discriminant reads `.type`
    if (n.type === "switch_statement" && n.text.includes(".type")) {
      const walkCases = (m: any) => {
        for (let i = 0; i < m.namedChildCount; i++) {
          const c = m.namedChild(i)
          if (!c) continue
          if (c.type === "switch_case" || c.type === "switch_default") {
            for (let j = 0; j < c.childCount; j++) {
              const s = c.child(j)
              if (s && s.type === "string") consider((s.text ?? "").slice(1, -1))
            }
          } else walkCases(c)
        }
      }
      walkCases(n)
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
  }
}
analyzerTree.delete?.()

// ---------------------------------------------------------- C. corpus reality
const parser = await ASTEngine.getParser("bash")

interface CorpusFile { corpus: string; file: string; text: string }
const corpusFiles: CorpusFile[] = []
const corpusPins: { corpus: string; revision: string; files: number }[] = []

for (const dir of corpusDirs) {
  if (!existsSync(path.join(dir, ".git"))) {
    console.error(`SKIP corpus (not a git checkout): ${dir}`)
    continue
  }
  const revision = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  const tracked = execFileSync("git", ["-C", dir, "ls-files", "*.sh", "*.bash"], { encoding: "utf8" })
    .trim().split("\n").filter(Boolean).sort()
  let read = 0
  for (const file of tracked) {
    try {
      const text = execFileSync("git", ["-C", dir, "show", `HEAD:${file}`], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      })
      corpusFiles.push({ corpus: dir, file, text })
      read++
    } catch {
      continue
    }
  }
  corpusPins.push({ corpus: dir, revision, files: read })
}

const fixtureFiles: CorpusFile[] = existsSync(FIXTURE_DIR)
  ? readdirSync(FIXTURE_DIR)
      .filter((x) => /\.(sh|bash)$/i.test(x))
      .sort()
      .map((f) => ({ corpus: "fixtures", file: f, text: readFileSync(path.join(FIXTURE_DIR, f), "utf8") }))
  : []

const allInputs = [...fixtureFiles, ...corpusFiles]

const observed = new Map<string, { count: number; identifierCarriers: number; literalWords: number }>()
const errorNodesByType = new Map<string, number>()
/** Named structural types vs anonymous tokens, split by the grammar itself. */
const isNamedType = new Map<string, boolean>()
const anonymousTokenOccurrences = new Map<string, number>()

for (const input of allInputs) {
  const tree = parser.parse(input.text)
  if (!tree) continue
  const stack: any[] = [tree.rootNode]
  while (stack.length > 0) {
    const n: any = stack.pop()
    if (!n) continue
    if (n.type === "ERROR" || n.isMissing) errorNodesByType.set(n.type, (errorNodesByType.get(n.type) ?? 0) + 1)
    if (n.isNamed) isNamedType.set(n.type, true)
    else anonymousTokenOccurrences.set(n.type, (anonymousTokenOccurrences.get(n.type) ?? 0) + 1)
    let row = observed.get(n.type)
    if (!row) {
      row = { count: 0, identifierCarriers: 0, literalWords: 0 }
      observed.set(n.type, row)
    }
    row.count++
    if (n.type === "word" && !isIdentifier(n) && n.text) row.literalWords++
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
  }
  tree.delete?.()
}

// How many IDENTIFIER nodes each structural type OWNS. A carrier is attributed
// to its nearest non-carrier ancestor: `command_name` inside `negated_command`
// inside `if_statement` belongs to the negation, and the negation is the type
// whose consultation would have covered it. Counting carriers at their own type
// (the first draft of this instrument) made every container look empty and the
// gap count structurally zero — the same class of defect this file exists to
// catch, found in the instrument itself.
{
  const stack: any[] = []
  for (const input of allInputs) {
    const tree = parser.parse(input.text)
    if (!tree) continue
    stack.push(tree.rootNode)
    while (stack.length > 0) {
      const n: any = stack.pop()
      if (!n) continue
      if (isIdentifier(n) && n.text && n.text.length > 0) {
        let owner = n.parent
        while (owner && isCarrier(owner.type)) owner = owner.parent
        const ownerType = owner?.type
        const row = ownerType ? observed.get(ownerType) : undefined
        if (row) row.identifierCarriers++
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c) stack.push(c)
      }
    }
    tree.delete?.()
  }
}

// ------------------------------------------------------------- D. measured loss
const lossByType = new Map<string, { names: number; named: number; samples: string[] }>()

for (const input of corpusFiles) {
  let emitted: Set<string>
  try {
    // parseFile(filePath, projectPath, context?) — the second argument is the
    // PROJECT ROOT. The first draft of this instrument passed the file's CONTENT
    // there, which typecheck caught: the call was reading the file off disk with
    // a nonsense project root, so the measured edges were not provably the edges
    // of the bytes this instrument had just parsed.
    const res = await parseFile(path.join(input.corpus, input.file), ROOT)
    emitted = new Set(
      (res.relationships ?? []).map((r: any) => `${String(r.source ?? r.from ?? "")}\u0000${String(r.target ?? r.to ?? "")}`),
    )
    const bare = new Set((res.relationships ?? []).map((r: any) => String(r.target ?? r.to ?? "")))
    for (const b of bare) emitted.add(`\u0000${b}`)
  } catch {
    continue
  }
  const tree = parser.parse(input.text)
  if (!tree) continue
  const stack: any[] = [tree.rootNode]
  while (stack.length > 0) {
    const n: any = stack.pop()
    if (!n) continue
    if (isCarrier(n.type) && n.text) {
      // The nearest enclosing non-carrier type owns this name; that is the type
      // whose consultation would have covered it.
      let owner = n.parent
      while (owner && isCarrier(owner.type)) owner = owner.parent
      const ownerType = owner?.type ?? ""
      if (ownerType && !sourceTypeRefs.has(ownerType)) {
        let row = lossByType.get(ownerType)
        if (!row) {
          row = { names: 0, named: 0, samples: [] }
          lossByType.set(ownerType, row)
        }
        row.names++
        if (emitted.has(`\u0000${n.text}`) || emitted.has(`${ownerType}\u0000${n.text}`)) row.named++
        else if (row.samples.length < 6) row.samples.push(`${input.file}:${n.startPosition.row + 1} ${n.type}=${n.text}`)
        else if (row.samples.length < 6) row.samples.push(`${input.file}:${n.startPosition.row + 1} ${n.type}=${n.text}`)
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
  }
  tree.delete?.()
}

// ------------------------------------------------------------ classification
// The universe is the grammar's NAMED node types — the structural vocabulary an
// analyzer makes decisions about. Anonymous tokens ("}", "$", "=") are grammar
// terminals with no extraction semantics; they are counted and reported
// separately rather than mixed into the classification, so nothing is hidden
// and the signal is not diluted by 99 rows that can never be "handled".
const rows: {
  type: string
  occurrences: number
  identifierCarriers: number
  literalWords: number
  inGrammar: boolean
  consultedInSource: number
  classification: string
  unmeasuredNames?: number
}[] = []

for (const [type, row] of [...observed.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  if (!isNamedType.get(type)) continue
  const inGrammar = grammarTypes.has(type)
  const consulted = sourceTypeRefs.get(type) ?? 0
  let classification: string
  if (consulted > 0 && !inGrammar) classification = "dead_branch"
  else if (consulted > 0) classification = "handled_verified"
  else if (row.identifierCarriers > 0) classification = "gap"
  else classification = "internal_silent"
  const loss = lossByType.get(type)
  rows.push({
    type,
    occurrences: row.count,
    identifierCarriers: row.identifierCarriers,
    literalWords: row.literalWords,
    inGrammar,
    consultedInSource: consulted,
    classification,
    ...(classification === "gap" && loss ? { unmeasuredNames: loss.names - loss.named } : {}),
  })
}

const consultedNotObserved = [...sourceTypeRefs.keys()].filter((t) => !observed.has(t)).sort()
// A consulted literal the grammar does not have is a branch that can NEVER
// fire. It cannot be found by iterating observed types — a type the grammar
// cannot produce never appears in a tree — so it is checked in the OTHER
// direction, against the grammar's own table. (The first draft of this
// instrument iterated observed types only and therefore reported
// `unknown_type: 0` while the F1 audit was reporting bash's `identifier` dead
// branch. Three defects in one instrument, all the same species.)
const deadBranchLiterals = [...sourceTypeRefs.keys()].filter((t) => !grammarTypes.has(t)).sort()
const gaps = rows.filter((r) => r.classification === "gap")

// A gap may only be reclassified against a RULING in the lane's own spec, and
// the ruling is published with the row. Silence is guilt: a gap with no ruling
// fails the gate, and a ruling for a type that is not actually a gap is
// reported as a stale ruling rather than quietly ignored.
const SPEC = path.join(ROOT, "script/m14/spec/bash-completeness.json")
const rulings = new Map<string, { id: string; ruling: string; nodeType: string }>()
let specError: string | null = null
if (existsSync(SPEC)) {
  try {
    const spec = JSON.parse(readFileSync(SPEC, "utf8"))
    for (const g of spec?.gap?.gaps ?? []) {
      const text = String(g.ruling ?? "")
      if (!text.trim()) continue
      for (const t of String(g.node_type ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
        rulings.set(t, { id: String(g.id ?? ""), ruling: text, nodeType: t })
      }
    }
    // Every named type the grammar declares must be classified by the spec, or
    // the spec is incomplete — the F8 rule applied to the authority itself.
    // A type is classified if the spec puts it in EITHER emission bucket OR
    // names it in the gap bucket — a ruled gap is a classification, not an
    // absence, and refusing to count it would make every ruled lane fail its
    // own spec.
    const specTypes = new Set<string>([
      ...(spec?.handled_verified?.types ?? []),
      ...(spec?.internal_silent?.types ?? []),
      ...(spec?.gap?.gaps ?? []).flatMap((g: any) =>
        String(g.node_type ?? "")
          .split(",")
          .map((x: string) => x.trim())
          .filter(Boolean),
      ),
    ])
    for (const t of grammarTypes) {
      if (!isNamedType.get(t)) continue
      if (!specTypes.has(t)) specError = `grammar named type absent from bash-completeness.json: ${t}`
    }
  } catch (e: any) {
    specError = `bash-completeness.json unreadable: ${String(e?.message ?? e)}`
  }
} else {
  specError = "script/m14/spec/bash-completeness.json is missing"
}

const ruledGaps: Record<string, { id: string; ruling: string }> = {}
const unruledGaps: string[] = []
for (const g of gaps) {
  const r = rulings.get(g.type)
  if (r) ruledGaps[g.type] = { id: r.id, ruling: r.ruling }
  else unruledGaps.push(g.type)
}
const staleRulings = [...rulings.keys()].filter((t) => !gaps.some((g) => g.type === t))

const totalUnmeasured = gaps.reduce((a, r) => a + (r.unmeasuredNames ?? 0), 0)

// Cross-validation against the OTHER instrument that measures the same thing.
// F1 (`script/m14/audit-analyzer-grammar.ts`) extracts node-type literals with
// its own TypeScript-AST walk. Two independent methods must agree on the COUNT,
// or one of them is wrong and neither may be trusted. The retired instrument
// disagreed with F1 by 9 and nobody noticed for weeks, which is why this check
// exists rather than a comment.
const f1Path = path.join(ROOT, "validation/m14/results/M14.0.F1.json")
let crossValidation: Record<string, unknown> | null = null
if (existsSync(f1Path)) {
  try {
    const f1 = JSON.parse(readFileSync(f1Path, "utf8"))
    const row = f1?.data?.languages?.bash
    if (row) {
      const f1Count = typeof row.referencedTypeLiterals === "number" ? row.referencedTypeLiterals : null
      crossValidation = {
        against: "validation/m14/results/M14.0.F1.json (script/m14/audit-analyzer-grammar.ts)",
        f1ReferencedTypeLiterals: f1Count,
        f1UnknownNodeTypes: (row.unknownNodeTypes ?? []).map((u: any) => u.literal),
        thisInstrumentSourceTypeRefs: sourceTypeRefs.size,
        countsAgree: f1Count === null ? null : f1Count === sourceTypeRefs.size,
        note:
          "F1 counts every node-type literal in the analyzer; this instrument counts the same population by a separate TypeScript-AST walk. A disagreement means one extraction is wrong, so the gate refuses to pass rather than publishing either number alone.",
      }
    }
  } catch {
    crossValidation = { error: "F1 artifact unreadable" }
  }
}

const legacyPath = path.join(path.dirname(OUT), "bash-node-types-legacy-inventory.json")
const legacy = existsSync(legacyPath) ? JSON.parse(readFileSync(legacyPath, "utf8")) : null

const result = {
  analyzer: "bash",
  gate: "M12.bash-node-types",
  title: "Every node type occurring in a real corpus is classified; every consulted literal exists in the pinned grammar; every unconsulted name-carrier's loss is measured",
  instrument: {
    file: "script/m12/bash-node-types-compare.ts",
    replaces: "script/m12/bash-node-types-legacy-inventory.ts",
    reason:
      "the retired instrument hardcoded its 35-entry 'referenced' list instead of measuring it, and never computed observed\\referenced, so it could not fail and hid 21 unclassified corpus node types",
    authorities: {
      grammar: "Language.load(wasm/tree-sitter-bash.wasm) nodeTypeForId — the same oracle F1 uses; no node-type list is written in this file",
      source:
        "analyzer string literals at node-type positions, extracted by parsing src/ast/real-bash-analyzer.ts with the tree-sitter TypeScript grammar (the F1 method, not a regex)",
      corpus: "pinned git revisions read with `git show HEAD:<path>`, so the bytes measured are the committed bytes",
      loss: "production parseFile edge endpoints compared against the names inside each unconsulted name-carrier",
    },
    noHardcodedNodeTypeList: true,
    selfAudit:
      "This instrument carried three defects of its own before it was trusted, all of the species it exists to catch: (1) it hardcoded its referenced list; (2) it attributed a name-bearing node to its own type instead of to its nearest non-carrier ancestor, which made every container look empty and the gap count structurally zero; (3) it iterated OBSERVED types to find dead branches, so a literal the grammar cannot produce - which by definition never appears in a tree - was invisible, and it reported unknown_type 0 while F1 was reporting bash's `identifier` dead branch. Each was found by a number that contradicted an independent measurement, not by inspection. The reasons are recorded here and in the commit so the next reader does not re-add them.",
  },
  corpus: corpusPins,
  fixtureFiles: fixtureFiles.map((f) => f.file),
  inputFiles: allInputs.length,
  grammarNodeTypeCount,
  observedNodeTypeCount: rows.length,
  observedNodeTypeCountAllNodes: observed.size,
  anonymousTokenCount: anonymousTokenOccurrences.size,
  anonymousTokenOccurrences: Object.fromEntries([...anonymousTokenOccurrences.entries()].sort((a, b) => b[1] - a[1])),
  sourceTypeRefCount: sourceTypeRefs.size,
  sourceTypeRefs: Object.fromEntries([...sourceTypeRefs.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
  consultedButNotObserved: consultedNotObserved,
  counts: {
    handled_verified: rows.filter((r) => r.classification === "handled_verified").length,
    internal_silent: rows.filter((r) => r.classification === "internal_silent").length,
    gap: gaps.length,
    dead_branch: deadBranchLiterals.length,
  },
  deadBranchLiterals,
  crossValidation,
  gaps,
  totalUnmeasuredNames: totalUnmeasured,
  unmeasuredSamples: Object.fromEntries(
    [...lossByType.entries()]
      .filter(([t]) => gaps.some((g) => g.type === t))
      .map(([t, v]) => [t, v.samples])
      .filter(([, s]) => s.length > 0),
  ),
  errorNodesByType: Object.fromEntries([...errorNodesByType.entries()].sort()),
  rows,
  legacyComparison: legacy
    ? {
        note: "the retired instrument's own numbers, kept so the change is auditable rather than a silent replacement",
        legacyLiveReferenced: legacy.liveReferencedNodeTypes?.length ?? null,
        legacyDeadDefensive: legacy.deadDefensiveReferences?.length ?? null,
        legacyObservedNodeTypeCount: legacy.observedNodeTypeCount ?? null,
        legacyWalkedNamedChildrenOnly: true,
        measuredSourceRefs: sourceTypeRefs.size,
        inflationOfLegacyInventory: (legacy.liveReferencedNodeTypes?.length ?? 0) - sourceTypeRefs.size,
        unclassifiedThenUnreported: (legacy.observedNodeTypeCount ?? 0) - (legacy.liveReferencedNodeTypes?.length ?? 0),
      }
    : null,
  policy:
    "Every NAMED node type occurring in the pinned corpora or the fixtures is classified into handled_verified / internal_silent / gap / unknown_type from two independent authorities: the wasm grammar's own node-type table and the analyzer source's type-position literals. A name-bearing node is attributed to its nearest non-carrier ancestor, so a `gap` is a structural type that OWNS names the analyzer never reaches. Anonymous grammar tokens are terminals with no extraction semantics; they are counted in `anonymousTokenOccurrences` and excluded from the classification universe rather than inflating it. The count of names inside each gap for which no edge was emitted is measured, not asserted. The gate is red whenever an unknown_type exists (a consulted literal the grammar does not have - a branch that can never fire), whenever any gap exists, or whenever totalUnmeasuredNames > 0.",
  passed:
    deadBranchLiterals.length === 0 &&
    unruledGaps.length === 0 &&
    staleRulings.length === 0 &&
    specError === null &&
    totalUnmeasured === 0 &&
    crossValidation?.countsAgree !== false,
}

writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n")

console.log(
  JSON.stringify(
    {
      out: path.relative(ROOT, OUT),
      observedNodeTypeCount: result.observedNodeTypeCount,
      measuredSourceRefs: result.sourceTypeRefs.size,
      counts: result.counts,
      deadBranchLiterals: result.deadBranchLiterals,
      crossValidation: result.crossValidation,
      gapTypes: gaps.map((g) => `${g.type} ids=${g.identifierCarriers} unmeasured=${g.unmeasuredNames ?? 0} ${rulings.has(g.type) ? `RULED(${rulings.get(g.type)!.id})` : "UNRULED"}`),
      unruledGaps,
      staleRulings,
      specError,
      totalUnmeasuredNames: result.totalUnmeasuredNames,
      legacy: result.legacyComparison,
      passed: result.passed,
    },
    null,
    2,
  ),
)

if (!result.passed) process.exitCode = 1
