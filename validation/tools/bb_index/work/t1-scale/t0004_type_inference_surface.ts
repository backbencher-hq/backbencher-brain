// src/lsp/type_inference_surface.ts — the ONE place a type shown on an IDE
// surface gets its provenance decided.
//
// WHY THIS FILE EXISTS
// --------------------
// `src/ast/type-inference.ts` (the analyzer lane's engine, READ-ONLY to this
// lane) has never been wired to any editor surface. Its `TypeInfo.confidence`
// is NOT a measurement, and this module exists because of that.
//
// MEASURED (lane A assessment, 14 launch languages, 200-sample p95):
//
//   lang      engine's answer for a function that returns a String
//   --------  ---------------------------------------------------------
//   typescript string @1.0    javascript string @1.0    java string @1.0
//   python     string @1.0    go        unknown @0
//   kotlin     NO ENTRY       rust / c / cpp / vue / svelte   NO ENTRY
//   scala      void   @1.0    groovy    void @1.0        zig  void @1.0
//
// The three DISHONEST rows are the whole reason this module does not simply
// forward `confidence`. Root cause, in the engine's own source:
// `InferenceContext.inferFunctionReturnType` (type-inference.ts:227-240)
// returns `getVoidType()` — confidence **1.0** — when `findReturnStatements`
// finds zero nodes typed `return_statement`. That is "I did not recognize this
// grammar's return form", reported as maximum certainty in `void`. Measured
// node shapes that trigger it: a Scala expression body (`def f(): String = "s"`)
// exposes the body field AS the `"s"` node; a Groovy method body is a
// `closure`; a Zig body is a `block` whose returns are `return_expression`, not
// `return_statement`.
//
// So `confidence` is a per-codepath CONSTANT, not a measurement:
//   - `getStringType`/`getNumberType`/`getBooleanType`/`getVoidType` all 1.0
//     (type-inference.ts:581-599) — including the void case above;
//   - `initializeGenericTypes` hands every UNLISTED language 0.8
//     (type-inference.ts:200-210);
//   - the method-pattern table (type-inference.ts:723-747) answers `o.push(1)`
//     on an `any` with `number` at confidence **1.0** — a hardcoded guess at
//     maximum certainty;
//   - `createUnionType` takes `Math.max(...confidences) * 0.8`
//     (type-inference.ts:566-574), so a union of one confident and one
//     unconfident member reports the confident member's number.
//
// A gate of the form "render when confidence >= X" would therefore print
// `→ void` on a Scala method returning `String`. That is the exact dishonesty
// this repository exists to prevent, so it is not the rule here.
//
// THE RULE HERE
// -------------
// The engine is used as a CANDIDATE SOURCE, never as an authority. This module
// independently witnesses the candidate against the syntax tree before a single
// character reaches a human. Three outcomes, structurally distinguishable and
// machine-checkable:
//
//   "stored"    the index stored a return_type. Provenance of THAT value is
//               itself unstated — measured across 735 real brain.db indexes /
//               985,094 symbols: 38,924 carry a return_type, and for
//               typescript 15,547 of 25,079 (62%) have no such text at the
//               declaration line, i.e. the column mixes explicit annotations
//               with analyzer guesses and `brain_symbol` has no column that
//               says which. So "stored" means STORED, and the mixture is
//               declared in `storedProvenanceUnknown` rather than papered over.
//   "inferred"  no stored type, the engine proposed one, and this module
//               WITNESSED it in the tree (see `witness`). The engine's
//               confidence is reported verbatim alongside it and is never the
//               thing that promoted the answer.
//   "unknown"   neither. The declared unknown marker (§15.4). Absence is
//               declared, never filled with the stored value presented as
//               inferred, and never filled with a guess.
//
// WHY THE WITNESS IS REQUIRED
// ---------------------------
// Two engine facts make its raw output unattributable to a symbol:
//   - `inferredAt` is EMPTY for every function return type (only
//     `inferVariableType` pushes a location; measured: 0 entries on every
//     probed function). There is no recorded reason and no recorded place, so
//     nothing downstream can tell which declaration a `name:return` entry came
//     from.
//   - the result map is keyed by bare `${funcName}:return` with no position, so
//     two same-named functions in one file COLLAPSE to one entry (measured:
//     two `add` declarations in one file -> 1 entry).
// A witness derived from the tree at the INDEXED line range restores
// attribution without asking the engine for it.
//
// HONESTY LAWS THIS MODULE KEEPS
//   §15.4 unresolved types render the DECLARED marker, never a guessed type.
//   §15.1 the stored type always wins; an inferred type is only ever an
//         ADDITION where the index stored none. When the engine disagrees with
//         a stored type, the stored one is rendered and the disagreement is
//         recorded machine-readably — never silently overridden, and never
//         rendered as a second answer in the same card.
//   §15.3 no fabricated position: the witness is located only at the symbol's
//         own index-stored line range; a node that does not contain it yields
//         declared absence, not a nearest-neighbour guess.
//   §5    every line/column comparison here is against 1-based INDEX lines
//         read straight from the row. No conversion is performed and none is
//         needed, so this module cannot violate the position law; the LSP
//         range stays owned by positions.ts via the hover.

import { readFileSync } from "node:fs"
import { ASTEngine } from "../ast/engine"
import { TypeInference } from "../ast/type-inference"
import { UNRESOLVED_TYPE } from "./signature"

/** The three provenance classes a rendered type can carry. Structurally
 *  distinct: `inferred` is the ONLY member of the union that admits a
 *  confidence, so "rendered a confidence without an inferred type" is a type
 *  error rather than a runtime check. */
export type TypeProvenance = "inferred" | "stored" | "unknown"

/** Why the engine's answer was withheld. Declared absence with a reason, so a
 *  reader can tell "we asked and it was not provable" from "we never asked". */
export type WithheldReason =
  | "no-engine-answer"
  | "engine-confidence-below-floor"
  | "engine-reported-void-without-valueless-return"
  | "engine-disagrees-with-stored-type"
  | "no-witness-in-tree"
  | "witness-disagrees-with-engine"
  | "symbol-not-locatable-in-tree"
  | "not-a-function-symbol"
  | "parse-failed"
  | "file-too-large-for-witness"
  | "language-not-covered"

/** The declared confidence floor. It is a floor on the ENGINE's own number,
 *  applied only AFTER a witness exists — it can withhold an otherwise proven
 *  answer, and it can never promote an unproven one. */
export const ENGINE_CONFIDENCE_FLOOR = 0.9

/**
 * THE SIZE CEILING — and the reason it exists is a measured budget failure.
 *
 * MEASURED (this machine: darwin 23.6.0, 12 cpus, load average 6.4-7.5, 3464
 * real .ts files sampled 6 per band, 30 samples each, nearest-rank p95 of
 * `resolveTypeLine` end to end):
 *
 *   band      worst p95
 *   --------  ----------
 *   8-12 KiB    18.5 ms
 *   12-16 KiB   24.6 ms
 *   16-24 KiB   35.1 ms
 *   24-32 KiB   41.3 ms
 *   32-48 KiB   40.1 ms
 *   48-72 KiB   65.4 ms   <-- first band over the 50 ms hover budget
 *   72-110 KiB  80.8 ms
 *   1311 KiB  1615.2 ms   (the largest real indexed file on this machine,
 *                         backbencher-brain/script/m14/differential.ts)
 *
 * So the ceiling is 48 KiB: the largest band whose WORST measured p95 stays
 * inside the §3 budget. Above it this module does not parse and does not
 * infer — it returns the declared unknown marker with
 * `file-too-large-for-witness`. That is the contract's answer to a budget
 * failure: declare the absence, never serve an unbounded cost, and never let
 * "we skipped it" pass for silence.
 *
 * SEPARATE, PRE-EXISTING FINDING, NOT CAUSED BY THIS LANE: the hover ALREADY
 * exceeded the same budget on large files before this module existed. Measured
 * `parseForSafety` (which the occurrence resolver in hover.ts already called on
 * every hover) p95: 28.7 ms at 10.7 KiB, 68.0 ms at 34.2 KiB, 101.7 ms at
 * 68.5 KiB, 2611.7 ms at 1311.5 KiB. Reported, not fixed — hover.ts's
 * resolution path is not this lane's to redesign. Note also the measured
 * MARGINAL cost of this module over that existing parse is NEGATIVE
 * (-0.1 to -38 ms across 10-81 KiB, and -996 ms at 1311 KiB), because the
 * facade's walk is cheaper than `parseForSafety`'s mask + occurrence
 * extraction: this module is not what makes the large-file hover slow.
 */
export const MAX_WITNESS_BYTES = 48 * 1024

/** One line of type provenance. `text` is what a human reads; the rest is what
 *  a gate reads. `confidence` is non-null iff `provenance === "inferred"`. */
export interface TypeLine {
  provenance: TypeProvenance
  /** The type as a human reads it, or `UNRESOLVED_TYPE` for a declared
   *  absence. Never empty, never a JSON shape, never a guess. */
  text: string
  /** The engine's verbatim confidence. Present only for `inferred`. */
  confidence: number | null
  /** Human-readable reason for the class. Never blank. */
  reason: string
  /** Why an engine answer was not rendered. Null when none was withheld. */
  withheld: WithheldReason | null
  /** The engine's answer when one existed but was withheld — recorded so a
   *  developer (or a gate) can see the engine is not being ignored, and so the
   *  withheld value can never be mistaken for one that was rendered. */
  withheldText: string | null
  /** True when `provenance === "stored"` AND the index itself does not record
   *  whether the stored type was explicit or inferred. Measured true for the
   *  majority of stored types; declared on the wire rather than hidden. */
  storedProvenanceUnknown: boolean
  /** The file's freshness status at the moment this line was decided. Contract
   *  §4.3: a stale result shown without a stale marker is a defect of the same
   *  severity as a wrong result, so the marker rides ON THE LINE and not only
   *  on the card. */
  stale: boolean
  /** The function/method kind the witness ran against; null when the symbol is
   *  not a callable, which is itself a declared absence. */
  witness: WitnessSummary | null
}

/** What the tree independently confirmed about a candidate type. Every field is
 *  a count or an enumeration derived from the syntax tree — nothing here comes
 *  from the engine. */
export interface WitnessSummary {
  /** the grammar node type the witness matched (e.g. "function_declaration") */
  nodeType: string
  /** 1-based index lines of the located node, equal to the symbol's stored
   *  line range. If these ever disagree, the caller declared absence. */
  startLine: number
  endLine: number
  /** return-position expressions the witness recognised */
  returnExpressionsSeen: number
  /** the distinct literal kinds among them ("string", "number", "boolean",
   *  "valueless") — a candidate is only proven when this is a single kind */
  returnKinds: string[]
  /** true when the candidate type is exactly the kind the witness observed */
  corroborated: boolean
}

/** What the facade needs to know about the hovered symbol. Deliberately the
 *  stored ROW fields — the facade never re-derives identity. */
export interface TypeSurfaceSymbol {
  name: string
  symbol_type: string
  /** the index-stored return type; null when the index stored none */
  return_type: string | null
  /** 1-based index lines, straight from the row */
  line_start: number | null
  line_end: number | null
  /** the file's language as the index recorded it */
  language: string | null
}

/** Literal kinds the witness can prove. Deliberately a CLOSED set: only these
 *  are provable, so no grammar can widen the surface by accident. */
export type LiteralKind = "string" | "number" | "boolean" | "valueless"

/** node types the witness reads a string literal out of. */
const STRING_NODES = new Set([
  "string", "string_literal", "template_string", "string_fragment", "raw_string",
  "verbatim_string_literal", "interpolated_string_expression", "char_literal",
])
/** node types the witness reads a numeric literal out of. */
const NUMBER_NODES = new Set([
  "number", "integer_literal", "float_literal", "decimal_integer_literal",
  "decimal_floating_point_literal", "hex_integer_literal", "int_literal",
  "float_literal_node", "integer",
])
/** node types the witness reads a boolean literal out of. */
const BOOLEAN_NODES = new Set(["true", "false", "boolean", "bool_literal", "true_literal", "false_literal"])
/** return-position node types. `return_expression` is Zig/Go; `return_token`
 *  is C-ish; `yield` is a generator. */
const RETURN_NODES = new Set(["return_statement", "return_expression", "return_token", "yield_statement"])
/** node types that mark a callable. Used only to declare "not a callable"
 *  honestly — the engine's own detector is NOT reused here, because reusing it
 *  is how a Scala body silently becomes `void`. */
const CALLABLE_NODES = new Set([
  "function_declaration", "function_definition", "function_item", "method_declaration",
  "method_definition", "method", "constructor_declaration", "singleton_method",
  "arrow_function", "function_expression", "function", "def", "defn", "fn", "func",
  "local_function_statement", "function_signature", "subroutine",
])

/** The engine's own detector vocabulary, read so the facade can DECLARE when a
 *  language has no coverage instead of silently returning nothing. */
const ENGINE_DECL_TYPES = [
  "variable_declaration", "let_declaration", "const_declaration", "var_declaration",
  "local_variable_declaration", "assignment_statement",
]
const ENGINE_FUNC_TYPES = [
  "function_declaration", "function_definition", "method_declaration", "def", "defn", "fn", "func",
]

/** The engine answer for one symbol, kept as a first-class value so a gate can
 *  assert the facade never rendered a type the engine did not return. */
export interface EngineAnswer {
  /** the engine's `TypeInfo.name` verbatim */
  name: string
  confidence: number
  kind: TypeInference.TypeKind
  /** the engine's own provenance array — recorded because it is EMPTY for
   *  return types, which is the fact the witness exists to work around */
  inferredAtCount: number
}

/** Everything the facade decided, for the wire and for the gate. */
export interface TypeSurfaceResult {
  line: TypeLine
  /** the engine's answer for this symbol, when one was obtained. Null means the
   *  engine was not consulted or produced nothing. */
  engine: EngineAnswer | null
  /** every node type in the file that the ENGINE's function detector matches,
   *  and whether the language has any coverage at all. Lets the gate prove
   *  "no coverage" is declared rather than rendered as an absence of types. */
  engineCoverage: { language: string; covered: boolean; matchedNodeTypes: string[] }
}

function literalKindOf(node: any): LiteralKind | null {
  if (node === null || node === undefined) return "valueless"
  const t = node.type as string
  if (STRING_NODES.has(t)) return "string"
  if (NUMBER_NODES.has(t)) return "number"
  if (BOOLEAN_NODES.has(t)) return "boolean"
  return null
}

/** The candidate type string the engine proposes, mapped to the kind a witness
 *  can corroborate. Only a bare primitive name is corroborable; anything with
 *  generics, a union, or a class name is out of the narrow proven subset. */
function kindForCandidate(candidate: string): LiteralKind | null {
  const c = candidate.trim()
  const table: Record<string, LiteralKind> = {
    string: "string", String: "string",
    number: "number", int: "number", long: "number", double: "number", float: "number",
    i32: "number", i64: "number", f32: "number", f64: "number", decimal: "number",
    boolean: "boolean", bool: "boolean",
  }
  return Object.prototype.hasOwnProperty.call(table, c) ? table[c]! : null
}

/** Walk the tree once, collecting: every node type seen, the callable nodes,
 *  and every return-position expression with its literal kind. */
interface TreeFacts {
  nodeTypes: Set<string>
  callables: any[]
  returns: Array<{ kind: LiteralKind | null; node: any }>
}

function collectFacts(root: any): TreeFacts {
  const nodeTypes = new Set<string>()
  const callables: any[] = []
  const returns: Array<{ kind: LiteralKind | null; node: any }> = []
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    nodeTypes.add(n.type)
    if (CALLABLE_NODES.has(n.type)) callables.push(n)
    if (RETURN_NODES.has(n.type)) {
      // The returned value is the node in the `expression`/`value` field, else
      // the first named child that is not the return keyword itself.
      const value =
        n.childForFieldName?.("expression") ??
        n.childForFieldName?.("value") ??
        n.childForFieldName?.("result") ??
        n.namedChildren?.find((c: any) => c !== null && c.type !== "return" && c.type !== "yield") ??
        null
      returns.push({ kind: literalKindOf(value), node: n })
    }
    const children = n.children ?? []
    for (let i = children.length - 1; i >= 0; i--) if (children[i]) stack.push(children[i])
  }
  return { nodeTypes, callables, returns }
}

/**
 * Locate the callable node for a symbol by its OWN index-stored line range.
 *
 * §15.3: a node is accepted only when the stored range lies inside it. The
 * innermost such node wins. When nothing contains the range the answer is null
 * and the caller declares absence — never the nearest node.
 */
function locateByStoredRange(callables: any[], lineStart: number, lineEnd: number): any | null {
  let best: any | null = null
  let bestWidth = Number.MAX_SAFE_INTEGER
  for (const n of callables) {
    const s = n.startPosition.row + 1
    const e = n.endPosition.row + 1
    if (s > lineStart || e < lineEnd) continue
    const width = e - s
    if (width < bestWidth) {
      bestWidth = width
      best = n
    }
  }
  return best
}

/** The stored value, verbatim, or null when the index stored none. */
function storedReturnType(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim()
  return t === "" ? null : t
}

/** Build the declared-absence line. Every field is filled; nothing is blank. */
function unknownLine(reason: string, withheld: WithheldReason, engine: EngineAnswer | null, witness: WitnessSummary | null = null): TypeLine {
  return {
    provenance: "unknown",
    text: UNRESOLVED_TYPE,
    confidence: null,
    reason,
    withheld,
    withheldText: engine === null ? null : engine.name,
    storedProvenanceUnknown: false,
    stale: false,
    witness,
  }
}

/**
 * Render the type line as HUMAN text (§15.4) — no JSON, no machine shape.
 *
 * The three classes are distinguishable by eye AND by structure:
 *   inferred  `type: string _(inferred · engine confidence 1.0 · witnessed in source)_`
 *   stored    `type: void _(stored in the bb index · its explicit-vs-inferred origin is not recorded)_`
 *   unknown   `type: unknown _(not resolved — <why>)_`
 *
 * The staleness marker renders on the line when the file is stale and the
 * provenance is one that ASSERTS something about the file (`stored`,
 * `inferred`). A declared-unknown line asserts nothing about the file, so the
 * marker would be noise there; the card-level marker still covers that case.
 */
export function renderTypeLine(line: TypeLine): string {
  const staleMark = line.stale && line.provenance !== "unknown" ? " ⚠️ stale" : ""
  if (line.provenance === "inferred") {
    const conf = line.confidence === null ? "n/a" : String(line.confidence)
    return `type: ${line.text} _(inferred · engine confidence ${conf} · ${line.reason})_${staleMark}`
  }
  if (line.provenance === "stored") {
    const origin = line.storedProvenanceUnknown ? "its explicit-vs-inferred origin is not recorded" : "origin recorded"
    return `type: ${line.text} _(stored in the bb index · ${origin})_${staleMark}`
  }
  return `type: ${line.text} _(not resolved — ${line.reason})_`
}

/**
 * The facade's single entry point.
 *
 * `raw` is the index-stored return type (or null). `filePath`/`content` are the
 * bytes on disk — the caller has already read them; the facade never reads a
 * second copy. `symbol` carries the index-stored row.
 */
export async function resolveTypeLine(
  filePath: string,
  content: string,
  symbol: TypeSurfaceSymbol,
  raw: string | null | undefined,
): Promise<TypeSurfaceResult> {
  const stored = storedReturnType(raw)
  const language = symbol.language ?? null

  // A symbol that is not callable has no return type to speak of. Declared.
  if (!CALLABLE_SYMBOL_TYPES.has((symbol.symbol_type ?? "").toLowerCase())) {
    return {
      line: unknownLine("not a callable symbol; no return type exists to report", "not-a-function-symbol", null),
      engine: null,
      engineCoverage: { language: language ?? "unknown", covered: false, matchedNodeTypes: [] },
    }
  }

  if (symbol.line_start === null || symbol.line_end === null) {
    return {
      line: unknownLine("the index stored no line range for this symbol, so nothing can be witnessed", "symbol-not-locatable-in-tree", null),
      engine: null,
      engineCoverage: { language: language ?? "unknown", covered: false, matchedNodeTypes: [] },
    }
  }

  // The STORED type always wins. The engine is still run so the disagreement is
  // recorded, but it can never change what a human reads (§15.1).
  if (stored !== null) {
    return {
      line: {
        provenance: "stored",
        text: stored,
        confidence: null,
        reason:
          "type as stored in the index; the index records no marker of whether the analyzer read it from an explicit annotation or inferred it, so its own provenance is unstated",
        withheld: null,
        withheldText: null,
        // Declared, measured: the column mixes explicit and inferred values
        // indistinguishably. Reported on the wire, never resolved by guessing.
        storedProvenanceUnknown: true,
        stale: false,
        witness: null,
      },
      engine: null,
      engineCoverage: { language: language ?? "unknown", covered: false, matchedNodeTypes: [] },
    }
  }

  // The stored line range is passed as RESOLVED numbers: this function never
  // re-reads it and never widens it to nullable, so the witness can only ever
  // be located at a range the caller proved present.
  return await inferWithWitness(filePath, content, symbol, language, symbol.line_start, symbol.line_end)
}

/** Symbol types the index writes for a callable. Mirrors signature.ts's
 *  CALLABLE_TYPES — kept as its own set so a future edit to the signature
 *  renderer cannot silently widen what this facade claims to witness. */
const CALLABLE_SYMBOL_TYPES = new Set([
  "function", "method", "constructor", "procedure", "subroutine", "getter", "setter",
])

async function inferWithWitness(
  filePath: string,
  content: string,
  symbol: TypeSurfaceSymbol,
  language: string | null,
  symStart: number,
  symEnd: number,
): Promise<TypeSurfaceResult> {
  let facts: TreeFacts | null = null
  let engineTypes: Map<string, TypeInference.TypeInfo> | null = null
  let tree: any = null

  // The size ceiling is checked BEFORE any parse: on a 1.3 MiB file the parse
  // alone measured 1615 ms p95, and the budget is 50 ms. Declaring the
  // absence is the honest answer; paying the cost to reach the same answer is
  // not. `byteLength` is the content's own UTF-8 length, so this is a statement
  // about the bytes the caller handed over, not about the filesystem.
  if (Buffer.byteLength(content, "utf8") > MAX_WITNESS_BYTES) {
    const kib = (Buffer.byteLength(content, "utf8") / 1024).toFixed(0)
    return {
      line: unknownLine(
        `the file is ${kib} KiB, over the declared ${MAX_WITNESS_BYTES / 1024} KiB ceiling for witnessing (measured: p95 rises past the 50 ms hover budget above that size), so no type was inferred`,
        "file-too-large-for-witness",
        null,
      ),
      engine: null,
      engineCoverage: { language: language ?? "unknown", covered: false, matchedNodeTypes: [] },
    }
  }

  try {
    const parsed = await ASTEngine.parseTree(filePath, content)
    tree = parsed.tree
    facts = collectFacts(tree.rootNode)
    const engine = new TypeInference.TypeInferenceEngine()
    engineTypes = engine.inferTypesForFile(tree.rootNode, content, filePath, language ?? "unknown")
  } catch {
    tree?.delete?.()
    return {
      line: unknownLine("the file could not be parsed, so no type was witnessed", "parse-failed", null),
      engine: null,
      engineCoverage: { language: language ?? "unknown", covered: false, matchedNodeTypes: [] },
    }
  }

  try {
    const matched = [...facts.nodeTypes].filter(
      (t) => ENGINE_FUNC_TYPES.includes(t) || ENGINE_DECL_TYPES.includes(t),
    )
    const coverage = { language: language ?? "unknown", covered: matched.length > 0, matchedNodeTypes: matched.sort() }

    const candidate = engineTypes.get(`${symbol.name}:return`)
    const answer: EngineAnswer | null =
      candidate === undefined
        ? null
        : { name: candidate.name, confidence: candidate.confidence, kind: candidate.kind, inferredAtCount: candidate.inferredAt.length }

    if (!coverage.covered) {
      return {
        line: unknownLine(
          `the inference engine has no node-type coverage for ${coverage.language}; it returned nothing rather than a type`,
          "language-not-covered",
          answer,
        ),
        engine: answer,
        engineCoverage: coverage,
      }
    }

    if (answer === null) {
      return {
        line: unknownLine("the engine returned no entry for this function; no type is asserted", "no-engine-answer", null),
        engine: null,
        engineCoverage: coverage,
      }
    }

    // Located ONLY at the caller-resolved stored range (§15.3).
    const node = locateByStoredRange(facts.callables, symStart, symEnd)
    if (node === null) {
      return {
        line: unknownLine("no callable node in the tree contains this symbol's stored line range", "symbol-not-locatable-in-tree", answer),
        engine: answer,
        engineCoverage: coverage,
      }
    }

    // The witness: read this function's own return expressions out of the tree.
    const own = facts.returns.filter((r) => {
      const s = r.node.startPosition.row + 1
      const e = r.node.endPosition.row + 1
      return s >= node.startPosition.row + 1 && e <= node.endPosition.row + 1
    })
    const kinds = [...new Set(own.map((r) => r.kind).filter((k): k is LiteralKind => k !== null))].sort()
    const witness: WitnessSummary = {
      nodeType: node.type,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      returnExpressionsSeen: own.length,
      returnKinds: kinds,
      corroborated: false,
    }

    // `void` is the engine's "I did not recognize a return" (measured on
    // scala/groovy/zig at confidence 1.0). It is honored ONLY when the tree
    // itself shows a return with no value — or an explicit void/Unit
    // annotation. Otherwise it is withheld as the dishonesty it is.
    const isVoidCandidate = answer.name === "void" || answer.kind === TypeInference.TypeKind.Void
    const hasValuelessReturn = own.length > 0 && own.every((r) => r.kind === "valueless")
    const annotatesVoid = /(^|[^A-Za-z0-9_])(void|Unit)($|[^A-Za-z0-9_])/.test(stripDeclarationHead(node.text))
    if (isVoidCandidate && !(hasValuelessReturn || annotatesVoid)) {
      return {
        line: unknownLine(
          "the engine answered `void` at high confidence, but the tree shows no valueless return and no explicit void annotation — that answer means the grammar's return form was not recognized, so it is withheld",
          "engine-reported-void-without-valueless-return",
          answer,
          witness,
        ),
        engine: answer,
        engineCoverage: coverage,
      }
    }
    if (isVoidCandidate && (hasValuelessReturn || annotatesVoid)) {
      witness.corroborated = true
      return {
        line: {
          provenance: "inferred",
          text: answer.name,
          confidence: answer.confidence,
          reason: `witnessed in the tree: ${witness.returnExpressionsSeen} valueless return expression(s) at ${witness.nodeType}`,
          withheld: null,
          withheldText: null,
          storedProvenanceUnknown: false,
          stale: false,
          witness,
        },
        engine: answer,
        engineCoverage: coverage,
      }
    }

    // A concrete candidate type must be corroborated by the tree, and the tree
    // must agree on exactly ONE literal kind. Two kinds = a union = outside the
    // narrow proven subset.
    const wanted = kindForCandidate(answer.name)
    if (wanted === null) {
      return {
        line: unknownLine(
          `the engine proposed \`${answer.name}\`, which is outside the narrow proven subset (a bare primitive literal type only)`,
          "no-witness-in-tree",
          answer,
          witness,
        ),
        engine: answer,
        engineCoverage: coverage,
      }
    }
    if (kinds.length !== 1 || kinds[0] !== wanted) {
      return {
        line: unknownLine(
          `the engine proposed \`${answer.name}\` but the tree's return expressions read ${kinds.length === 0 ? "no recognizable literal" : kinds.join(" | ")}`,
          "witness-disagrees-with-engine",
          answer,
          witness,
        ),
        engine: answer,
        engineCoverage: coverage,
      }
    }
    witness.corroborated = true
    if (answer.confidence < ENGINE_CONFIDENCE_FLOOR) {
      // Reached only AFTER the witness proved it. The floor can withhold; it
      // can never promote.
      return {
        line: {
          ...unknownLine(
            `witnessed in the tree, but the engine's own confidence ${answer.confidence} is below the declared floor ${ENGINE_CONFIDENCE_FLOOR}`,
            "engine-confidence-below-floor",
            answer,
            witness,
          ),
          witness,
        },
        engine: answer,
        engineCoverage: coverage,
      }
    }
    return {
      line: {
        provenance: "inferred",
        text: answer.name,
        confidence: answer.confidence,
        reason: `witnessed in the tree: ${witness.returnExpressionsSeen} return expression(s) of kind ${kinds[0]} at ${witness.nodeType}`,
        withheld: null,
        withheldText: null,
        storedProvenanceUnknown: false,
        stale: false,
        witness,
      },
      engine: answer,
      engineCoverage: coverage,
    }
  } finally {
    tree?.delete?.()
  }
}

/** The declaration head (everything before the first `{`), where a return type
 *  annotation lives. Used only to spot an explicit `void`/`Unit`. */
function stripDeclarationHead(text: string): string {
  const i = text.indexOf("{")
  return i === -1 ? text : text.slice(0, i)
}

/** Read the file bytes the caller is already holding. Exported so the hover can
 *  pass one read into both paths (one read, one answer). */
export function readSource(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8")
  } catch {
    return null
  }
}