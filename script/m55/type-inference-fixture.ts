// script/m55/type-inference-fixture.ts — the M55.T6 fixture, authored BEFORE
// the assertions that read it (the F7 fixture-first rule).
//
// The fixture is built from the LANE A ASSESSMENT, which is the only reason
// this file's expectations look the way they do. Every row here was chosen
// because it is a case where a naive `confidence >= X` gate would LIE:
//
//   inferred-certain   a TS function whose body the tree proves returns a
//                      string literal. The one case where a type may be
//                      rendered as inferred.
//   inferred-void      a TS function with a valueless `return` — void is
//                      HONEST here because the tree witnesses the absence of
//                      a value.
//   void-without-value-the-engine-misread   a SCALA expression body
//                      (`def f(): String = "s"`). Measured: the engine answers
//                      `void` at confidence **1.0**. The fixture pins that
//                      number, so if the engine ever stops lying the gate's
//                      expectation fails loudly instead of silently passing.
//   stored-and-unmarked   a method whose type IS in the index — the `stored`
//                      class, and the measured case that the column carries no
//                      marker of explicit-vs-inferred.
//   unresolvable       a function returning an IDENTIFIER: the engine answers
//                      `unknown`, and the facade must render the declared
//                      marker, never a guess.
//   matched-but-no-entry  a KOTLIN function. Measured: the engine's detector
//                      DOES match kotlin's `function_declaration`, then returns
//                      nothing because `getFunctionBody` finds no body field.
//                      A distinct declared absence from "no coverage", and the
//                      gate proves the facade tells them apart.
//   no-coverage        a SVELTE file. MEASURED across all 14 launch
//                      languages: only vue and svelte match ZERO of the
//                      engine's declared node types (the SFC grammar does not
//                      expose the embedded script's declarations as top-level
//                      nodes). Every other launch language matches at least one,
//                      which is why this case is svelte and not rust.
//   not-callable       a class, which has no return type to report.
//
// NOTE ON LINE NUMBERS: every `line`/`span` below was taken from the source
// string it names, not estimated. An earlier draft of this fixture was off by
// one on three symbols and the facade correctly declared them
// `symbol-not-locatable-in-tree` — which is the rule working, but it makes a
// bad fixture indistinguishable from a bad implementation.

import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import path from "node:path"
import { hashFileContent } from "../../src/brain/freshness.ts"

export const T6_SOURCES: Record<string, string> = {
  "src/inferred.ts": `// A function whose return type is PROVABLE from the tree.
export function literalString() {
  return "hello"
}

// void is honest here: the tree shows a return with no value.
export function returnsNothing() {
  return
}
`,
  "src/stored.ts": `// The stored class: the index has a type for this method.
export class Store {
  put(key: string): void {
    return
  }
}
`,
  "src/unresolvable.ts": `// The engine cannot resolve this: it answers \`unknown\`.
export function mystery(a: unknown) {
  return a
}

// THE PATTERN-TABLE CASE. The engine answers \`string\` at confidence 1.0 —
// not by reading the tree, but from the hardcoded method table at
// type-inference.ts:723-747, because the receiver's type was never resolved.
// The tree sees a call_expression, which is NOT a literal, so nothing can
// corroborate it and the facade must withhold it. Measured engine answer
// pinned in the expectation: \`string@1.0\` via the pattern table.
export function viaPatternTable() {
  return "s".toUpperCase()
}
`,
  "src/scala/Scaler.scala": `class Scaler {
  def scaled(): String = "s"
}
`,
  "src/kotlin/Kt.kt": `class Kt {
  fun greet(): String {
    return "s"
  }
}
`,
  "src/svelte/Panel.svelte": `<script lang="ts">
function f(): string {
  return "s"
}
</script>
`,
}

export interface T6Symbol {
  id: string
  file: string
  name: string
  type: string
  qualified: string | null
  line: number
  span: number
  /** the value the index stores, or null for a declared stored-absence */
  returnType: string | null
  parameters: string | null
  /** the authored expectation for the facade's provenance class */
  expect: {
    provenance: "inferred" | "stored" | "unknown"
    /** the exact text the facade must render; for `unknown` this is the
     *  declared marker, asserted against signature.ts's own constant */
    text: string
    /** the authored withheld reason, null when nothing was withheld */
    withheld: string | null
    /** for `inferred`: the engine confidence the fixture asserts. Written
     *  here so an engine change that alters confidence FAILS the gate rather
     *  than quietly changing what a human reads. */
    confidence?: number
    /** human-readable note recorded in evidence, never asserted */
    note: string
  }
}

/**
 * A source file deliberately over the facade's declared 48 KiB ceiling.
 *
 * Built deterministically (no randomness, no timestamps) so the evidence
 * regenerates byte-identically. It is padded with comment lines rather than
 * code on purpose: the ceiling is about the BYTES the facade must parse, so the
 * padding must be real file content, not a lie about size.
 *
 * LESSON RECORDED HERE (it cost a real mutant run): this symbol's line was first
 * authored as 2 when the source puts it on line 1, and the CEILING HID the
 * error — the honest facade returns `file-too-large-for-witness` before it ever
 * consults the tree, so a wrong fixture line read as a passing fixture. The M8
 * mutant, which removes the ceiling and does parse, is what found it. A guard
 * that short-circuits ahead of the code under test will mask a broken fixture;
 * only the mutant that removes the guard finds out.
 */
const BIG_PADDING = `// padding line to push this file past the declared witness ceiling\n`.repeat(900)
export const BIG_SOURCE = `export function overCeiling() {
  return "s"
}
${BIG_PADDING}`
T6_SOURCES["src/big.ts"] = BIG_SOURCE

export const T6_SYMBOLS: T6Symbol[] = [
  {
    id: "t6-literal",
    file: "src/inferred.ts",
    name: "literalString",
    type: "function",
    qualified: "literalString",
    line: 2,
    span: 3,
    returnType: null, // the index stored NOTHING — this is the inferred case
    parameters: "[]",
    expect: {
      provenance: "inferred",
      text: "string",
      confidence: 1.0,
      withheld: null,
      note: "the engine's answer and the tree's return literal agree; this is the one class that may render a type",
    },
  },
  {
    id: "t6-void",
    file: "src/inferred.ts",
    name: "returnsNothing",
    type: "function",
    qualified: "returnsNothing",
    line: 7,
    span: 3,
    returnType: null,
    parameters: "[]",
    expect: {
      provenance: "inferred",
      text: "void",
      confidence: 1.0,
      withheld: null,
      note: "void is honest because the tree WITNESSES a valueless return — the engine's void answer is not trusted on its own anywhere",
    },
  },
  {
    id: "t6-stored",
    file: "src/stored.ts",
    name: "put",
    type: "method",
    qualified: "Store.put",
    line: 3,
    span: 3,
    returnType: "void",
    parameters: '[{"name":"key","type":"string"}]',
    expect: {
      provenance: "stored",
      text: "void",
      withheld: null,
      note: "a stored type always wins over an inferred one (§15.1); the column carries no explicit/inferred marker, which is declared on the wire",
    },
  },
  {
    id: "t6-unresolvable",
    file: "src/unresolvable.ts",
    name: "mystery",
    type: "function",
    qualified: "mystery",
    line: 2,
    span: 3,
    returnType: null,
    parameters: '[{"name":"a"}]',
    expect: {
      provenance: "unknown",
      text: "unknown",
      withheld: "no-witness-in-tree",
      note: "the engine proposes `unknown`, which is outside the provable subset; the facade renders the DECLARED marker, never a guess",
    },
  },
  {
    id: "t6-pattern-table",
    file: "src/unresolvable.ts",
    name: "viaPatternTable",
    type: "function",
    qualified: "viaPatternTable",
    line: 12,
    span: 3,
    returnType: null,
    parameters: "[]",
    expect: {
      provenance: "unknown",
      text: "unknown",
      withheld: "witness-disagrees-with-engine",
      note: "THE SECOND DISHONEST CLASS, and the subtler one: the engine's answer here (`string`, confidence 1.0) is CORRECT, but it came from the hardcoded method-pattern table, not from the tree. The return expression is a call_expression — no literal to corroborate — so rendering it as `inferred` would claim a witness that does not exist",
    },
  },
  {
    id: "t6-scala",
    file: "src/scala/Scaler.scala",
    name: "scaled",
    type: "method",
    qualified: "Scaler.scaled",
    line: 2,
    span: 1,
    returnType: null,
    parameters: "[]",
    expect: {
      provenance: "unknown",
      text: "unknown",
      withheld: "engine-reported-void-without-valueless-return",
      note: "THE DISHONEST ROW. The engine answers void@1.0 for a scala expression body; the tree shows no valueless return, so void is withheld and the declared marker renders",
    },
  },
  {
    id: "t6-kotlin",
    file: "src/kotlin/Kt.kt",
    name: "greet",
    type: "method",
    qualified: "Kt.greet",
    line: 2,
    span: 3,
    returnType: null,
    parameters: "[]",
    expect: {
      provenance: "unknown",
      text: "unknown",
      withheld: "no-engine-answer",
      note: "MEASURED: kotlin's `function_declaration` IS matched by the engine's detector, then no entry is produced because `getFunctionBody` finds no body field. Coverage without an answer — a different declared absence from rust's",
    },
  },
  {
    id: "t6-svelte",
    file: "src/svelte/Panel.svelte",
    name: "f",
    type: "function",
    qualified: "f",
    line: 2,
    span: 3,
    returnType: null,
    parameters: "[]",
    expect: {
      provenance: "unknown",
      text: "unknown",
      withheld: "language-not-covered",
      note: "MEASURED: svelte is one of only two launch languages (with vue) where the engine matches ZERO of its declared node types. The absence is DECLARED as no coverage, never rendered as an empty type",
    },
  },
  {
    id: "t6-over-ceiling",
    file: "src/big.ts",
    name: "overCeiling",
    type: "function",
    qualified: "overCeiling",
    line: 1,
    span: 3,
    returnType: null,
    parameters: "[]",
    expect: {
      provenance: "unknown",
      text: "unknown",
      withheld: "file-too-large-for-witness",
      note: "THE BUDGET CASE. This file is over the declared 48 KiB ceiling. Measured: the facade's p95 crosses the 50 ms hover budget above that size (48-72 KiB band worst p95 65.4 ms; a real 1311 KiB indexed file measured 1615 ms). The facade declares the absence instead of serving an unbounded cost",
    },
  },
  {
    id: "t6-not-callable",
    file: "src/stored.ts",
    name: "Store",
    type: "class",
    qualified: "Store",
    line: 2,
    span: 5,
    returnType: null,
    parameters: null,
    expect: {
      provenance: "unknown",
      text: "unknown",
      withheld: "not-a-function-symbol",
      note: "a class has no return type to report; declared absence, not a fabricated one",
    },
  },
]

/** The REAL symbol id shape the indexer writes (`<projectId>:<relPath>:<name>:<n>`
 *  — the same convention t5-fixture.ts pins, verified against every brain.db on
 *  this machine). */
export function t6SymbolIds(projectId: string): Record<string, string> {
  const seen = new Map<string, number>()
  const out: Record<string, string> = {}
  for (const s of T6_SYMBOLS) {
    const key = `${s.file}:${s.name}`
    const n = seen.get(key) ?? 0
    seen.set(key, n + 1)
    out[s.id] = `${projectId}:${s.file}:${s.name}:${n}`
  }
  return out
}

const MEMBER_OF: Record<string, string> = {
  "t6-stored": "t6-not-callable",
}

export function writeT6Workspace(dir: string): void {
  for (const [rel, body] of Object.entries(T6_SOURCES)) {
    const abs = path.join(dir, rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, body)
  }
}

/** The language the INDEX records for each fixture file — note it is the
 *  index's spelling, not the facade's inference, which is what §15.1 requires:
 *  the facade decides provenance, the index decides language. */
function indexLanguage(rel: string): string {
  if (rel.endsWith(".ts")) return "typescript"
  if (rel === "src/big.ts") return "typescript"
  if (rel.endsWith(".scala")) return "scala"
  if (rel.endsWith(".kt")) return "kotlin"
  if (rel.endsWith(".svelte")) return "svelte"
  return "typescript"
}

async function insertAll(raw: any, projectId: string, dir: string): Promise<void> {
  const files = Object.keys(T6_SOURCES)
  const ids = t6SymbolIds(projectId)
  const insFile = raw.prepare("INSERT INTO brain_file (id, project_id, path, relative_path, language, file_hash) VALUES (?,?,?,?,?,?)")
  for (const [i, rel] of files.entries()) {
    // The indexer's OWN content hash: a placeholder would make every fixture
    // file read stale and the freshness assertions would measure the fixture
    // instead of the rule.
    const abs = path.join(dir, rel)
    insFile.run(`t6f${i}`, projectId, abs, rel, indexLanguage(rel), hashFileContent(readFileSync(abs)))
  }
  const insSym = raw.prepare(
    `INSERT INTO brain_symbol (id, project_id, file_id, name, symbol_type, qualified_name, line_start, line_end,
       byte_start, byte_end, return_type, parameters, visibility, gravity_score, owner_symbol_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  for (const s of T6_SYMBOLS) {
    const lines = T6_SOURCES[s.file]!.split("\n")
    const lineText = lines[s.line - 1]!
    const at = Math.max(0, lineText.indexOf(s.name))
    const bs = Buffer.byteLength(lineText.slice(0, at), "utf8") + 1
    const be = bs + Buffer.byteLength(s.name, "utf8")
    const ownerSym = MEMBER_OF[s.id]
    insSym.run(
      ids[s.id]!,
      projectId,
      `t6f${files.indexOf(s.file)}`,
      s.name,
      s.type,
      s.qualified,
      s.line,
      s.line + s.span - 1,
      bs,
      be,
      s.returnType,
      s.parameters,
      "public",
      5,
      ownerSym === undefined ? null : ids[ownerSym]!,
    )
  }
}

/** Seed the real index for `ws` into `dataDir`. */
export async function seedT6Db(ws: string, dataDir: string): Promise<{ projectId: string; raw: any }> {
  const projectId = createHash("sha1").update(realpathSync(ws)).digest("hex").substring(0, 40)
  mkdirSync(path.join(dataDir, "projects", projectId), { recursive: true })
  process.env.BB_DATA_DIR = dataDir
  const { BrainDatabase } = (await import(path.join(path.resolve(import.meta.dirname, "../.."), "src", "brain", "database.ts"))) as {
    BrainDatabase: { getRawInstance(projectId: string): Promise<unknown> }
  }
  const raw = await BrainDatabase.getRawInstance(projectId)
  await insertAll(raw, projectId, ws)
  return { projectId, raw }
}