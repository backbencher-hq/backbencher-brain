// script/m55/t5-fixture.ts — M55.T5 fixture, authored BEFORE the assertions
// that read it (the F7 fixture-first rule).
//
// The issue (#775) names four symbols whose tier story must be one story:
//
//   Store (class)      contains (stored structural) + contains (derived, 1.0)
//                      + uses (stored `indexed` — an UNCLAIMED label)
//   put (method)       calls (in, no class) + calls (out, sub-floor) +
//                      imports (unclaimed stored label) + references +
//                      a stored cross-language calls row
//   items (field)      contains (derived) + references (sub-floor) +
//                      uses (unclaimed stored label)
//   push (external)    calls (sub-floor) + imports (unclaimed stored label) —
//                      stored as `target_external` with NO symbol row, which
//                      is what the indexer writes for `ext:` targets
//
// plus the declared-unknown case the deliverable names: `untouched` (a method
// with no stored relationships at all) must report the declared `unknown` and
// an empty tier list — never a guessed tier.
//
// The rows are analyzer-shaped: the metadata JSON is exactly what
// `classifyEvidenceTier` in src/ast/real-*-analyzer.ts writes, including the
// legacy `indexed` label. The authored expectations below are the tier story
// under the ONE rule (src/lsp/evidence_tier.ts): the legend's five tiers, in
// the legend's order, with the primary being the first of that list.
//
// Authored BEFORE the fix: the pre-T5 behavior for these rows is exactly what
// the T5 step-zero wire probe recorded on the demo project — Store would have
// reported `["indexed","structural"]` with `indexed` as its primary (the
// alphabetical sort), and the two methods of a class could disagree. The
// gate's M2 mutant reintroduces that rule and MUST fail, which is this
// fixture's RED proof against the current build.

import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import path from "node:path"
import { hashFileContent } from "../../src/brain/freshness.ts"

export const T5_SOURCES: Record<string, string> = {
  "src/store.ts": `// The tier fixture: one class, one method, one field, one external target,
// one method with no stored relationships (the declared-unknown case).
export class Store {
  private items: string[] = []

  put(key: string, value: string): void {
    this.items.push(key)
  }

  untouched(): void {
  }

  get size(): number {
    return this.items.length
  }
}

export function main(): void {
  const s = new Store()
  s.put("k", "v")
}
`,
  "src/vendor.ts": `// A second file so the cross-language/provenance queries have a real peer.
export function vendorCall(x: string): string {
  return x
}
`,
  "package.json": `{
  "name": "bb-m55-t5-fixture",
  "private": true,
  "version": "0.0.0"
}
`,
}

export interface T5Symbol {
  id: string
  file: string
  name: string
  type: string
  qualified: string | null
  line: number
  span: number
  returnType: string | null
  parameters: string | null
}

export const T5_SYMBOLS: T5Symbol[] = [
  { id: "s-store", file: "src/store.ts", name: "Store", type: "class", qualified: "store.Store", line: 3, span: 14, returnType: null, parameters: null },
  { id: "s-items", file: "src/store.ts", name: "items", type: "field", qualified: "Store.items", line: 4, span: 1, returnType: "string[]", parameters: null },
  {
    id: "s-put",
    file: "src/store.ts",
    name: "put",
    type: "method",
    qualified: "Store.put",
    line: 6,
    span: 3,
    returnType: "void",
    parameters: '[{"name":"key","type":"string","isOptional":false},{"name":"value","type":"string","isOptional":false}]',
  },
  { id: "s-untouched", file: "src/store.ts", name: "untouched", type: "method", qualified: "Store.untouched", line: 10, span: 2, returnType: "void", parameters: "[]" },
  { id: "s-size", file: "src/store.ts", name: "size", type: "method", qualified: "Store.size", line: 13, span: 3, returnType: "number", parameters: "[]" },
  { id: "s-main", file: "src/store.ts", name: "main", type: "function", qualified: "main", line: 18, span: 4, returnType: "void", parameters: "[]" },
  { id: "s-vendor-call", file: "src/vendor.ts", name: "vendorCall", type: "function", qualified: "vendorCall", line: 2, span: 3, returnType: "string", parameters: '[{"name":"x","type":"string","isOptional":false}]' },
]

export interface T5Row {
  id: string
  /** null when the row targets an external symbol (target_external instead) */
  source: string | null
  target: string | null
  targetExternal?: string
  type: string
  confidence: number
  /** the stored metadata.evidenceClass, exactly as an analyzer writes it */
  cls: string | null
  crossLanguage?: boolean
  bridge?: string
}

export const T5_ROWS: T5Row[] = [
  // Store (class): containment evidence, one stored and one derived, plus a
  // `uses` row whose stored label is the UNCLAIMED `indexed`.
  { id: "t5-r1", source: "s-store", target: "s-put", type: "contains", confidence: 1.0, cls: "structural" },
  { id: "t5-r2", source: "s-store", target: "s-items", type: "contains", confidence: 1.0, cls: null },
  { id: "t5-r7", source: "s-store", target: "s-items", type: "uses", confidence: 0.8, cls: "indexed" },
  { id: "t5-r8", source: "s-main", target: "s-store", type: "instantiates", confidence: 0.95, cls: "structural" },
  // put (method): the defect surface — the same class's two methods must not
  // get different stories just because one has an `imports` row.
  { id: "t5-r3", source: "s-main", target: "s-put", type: "calls", confidence: 0.95, cls: null },
  { id: "t5-r4", source: "s-put", target: null, targetExternal: "push", type: "calls", confidence: 0.4, cls: null },
  { id: "t5-r5", source: "s-put", target: null, targetExternal: "push", type: "imports", confidence: 0.9, cls: "indexed" },
  { id: "t5-r6", source: "s-put", target: "s-items", type: "references", confidence: 0.6, cls: null },
  {
    id: "t5-r9",
    source: "s-put",
    target: "s-vendor-call",
    type: "calls",
    confidence: 0.92,
    cls: "usage_contextual",
    crossLanguage: true,
    bridge: "kotlin-ts interop",
  },
  // untouched (method): NO rows — the declared-unknown case.
]

/**
 * The authored tier for EVERY stored row — the per-row ground truth the three
 * surfaces (owner, core mirror, legend) are compared against. Written here,
 * not derived in the gate, so a rule change has to change this table too.
 */
export const T5_ROW_TIER: Record<string, string> = {
  "t5-r1": "structural", // contains, stored structural
  "t5-r2": "structural", // contains, derived at 1.0
  "t5-r3": "structural", // calls, derived at 0.95
  "t5-r4": "inferred", // calls at 0.4 — below the 0.7 floor
  "t5-r5": "import_based", // imports, stored label is the UNCLAIMED `indexed`
  "t5-r6": "usage_contextual", // references, derived
  "t5-r7": "usage_contextual", // uses, stored label is the UNCLAIMED `indexed`
  "t5-r8": "structural", // instantiates, stored structural
  "t5-r9": "usage_contextual", // calls, stored usage_contextual (stored class wins)
}

/**
 * The authored tier story, per pinned symbol.
 *
 * Hover's tier collection reads rows where the symbol is either end; the
 * external target `push` has no symbol row (that is the indexer's shape for
 * `ext:` targets), so its story is asserted through its own stored rows and
 * through the surfaces that render it (the hub's external row).
 */
export interface T5Expect {
  tiers: string[]
  primary: string
}

export const T5_EXPECT: Record<string, T5Expect> = {
  // contains(structural) + contains(derived) + uses(unclaimed -> usage_contextual)
  "s-store": { tiers: ["structural", "usage_contextual"], primary: "structural" },
  // contains(structural) + calls(structural) + calls(sub-floor -> inferred)
  // + imports(unclaimed -> import_based) + references -> usage_contextual
  // + cross-language calls(stored usage_contextual)
  "s-put": { tiers: ["structural", "import_based", "usage_contextual", "inferred"], primary: "structural" },
  // contains(derived -> structural) + references -> usage_contextual
  // + uses(unclaimed -> usage_contextual)
  "s-items": { tiers: ["structural", "usage_contextual"], primary: "structural" },
  // the external target: imports(unclaimed -> import_based) + calls(sub-floor -> inferred)
  "ext:push": { tiers: ["import_based", "inferred"], primary: "import_based" },
  // the declared-unknown case: no rows at all
  "s-untouched": { tiers: [], primary: "unknown" },
}

/** The rows whose symbol is `id` — either end of the edge (the hover's rule). */
export function rowsForSymbol(id: string): T5Row[] {
  return T5_ROWS.filter((r) => r.source === id || r.target === id)
}

/** The rows whose external target is `name` (`target_symbol_id` is NULL for
 *  these — the indexer's shape for `ext:` targets). */
export function rowsForExternal(name: string): T5Row[] {
  return T5_ROWS.filter((r) => r.targetExternal === name)
}

export function writeT5Workspace(dir: string): void {
  for (const [rel, body] of Object.entries(T5_SOURCES)) {
    const abs = path.join(dir, rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, body)
  }
}

/** The 0-based character index of `name` in the symbol's own line. */
export function nameColumn(symbol: T5Symbol): number {
  const lineText = T5_SOURCES[symbol.file]!.split("\n")[symbol.line - 1]!
  return lineText.indexOf(symbol.name)
}

/**
 * The REAL symbol id shape the indexer writes (`<projectId>:<relPath>:<name>:<n>`
 * — verified against every brain.db on this machine). The fixture's symbolic
 * ids are mapped through this at seed time, because the graph engine's member
 * cascade is keyed on `owner_symbol_id` matching the owner's own id prefix:
 * a fixture with made-up ids would silently produce an empty hub (which is
 * exactly how the first version of this gate found the convention).
 */
export function t5SymbolIds(projectId: string): Record<string, string> {
  const seen = new Map<string, number>()
  const out: Record<string, string> = {}
  for (const s of T5_SYMBOLS) {
    const key = `${s.file}:${s.name}`
    const n = seen.get(key) ?? 0
    seen.set(key, n + 1)
    out[s.id] = `${projectId}:${s.file}:${s.name}:${n}`
  }
  return out
}

/** Members are owned by the class: the engine's cascade walks owner_symbol_id. */
const MEMBER_OF: Record<string, string> = {
  "s-items": "s-store",
  "s-put": "s-store",
  "s-untouched": "s-store",
  "s-size": "s-store",
}

async function insertAll(raw: any, projectId: string, dir: string): Promise<void> {
  const files = Object.keys(T5_SOURCES)
  const ids = t5SymbolIds(projectId)
  const insFile = raw.prepare("INSERT INTO brain_file (id, project_id, path, relative_path, language, file_hash) VALUES (?,?,?,?,?,?)")
  for (const [i, rel] of files.entries()) {
    // The REAL content hash (the indexer's own function): a placeholder hash
    // would make every fixture file read as `stale` on the hover path, and the
    // provenance assertions would be measuring the fixture, not the rule.
    const abs = path.join(dir, rel)
    insFile.run(`f${i}`, projectId, abs, rel, rel.endsWith(".ts") ? "typescript" : "json", hashFileContent(readFileSync(abs)))
  }
  const insSym = raw.prepare(
    `INSERT INTO brain_symbol (id, project_id, file_id, name, symbol_type, qualified_name, line_start, line_end,
       byte_start, byte_end, return_type, parameters, visibility, gravity_score, owner_symbol_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  for (const s of T5_SYMBOLS) {
    const lines = T5_SOURCES[s.file]!.split("\n")
    const lineText = lines[s.line - 1]!
    const at = Math.max(0, lineText.indexOf(s.name))
    const bs = Buffer.byteLength(lineText.slice(0, at), "utf8") + 1
    const be = bs + Buffer.byteLength(s.name, "utf8")
    const ownerSym = MEMBER_OF[s.id]
    insSym.run(
      ids[s.id]!,
      projectId,
      `f${files.indexOf(s.file)}`,
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
  const insRel = raw.prepare(
    `INSERT INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, target_external,
       relationship_type, confidence, is_cross_language, bridge_mechanism, metadata)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  )
  for (const r of T5_ROWS) {
    insRel.run(
      r.id,
      projectId,
      r.source === null ? null : ids[r.source]!,
      r.target === null ? null : ids[r.target]!,
      r.targetExternal ?? null,
      r.type,
      r.confidence,
      r.crossLanguage ? 1 : 0,
      r.bridge ?? null,
      r.cls === null ? null : JSON.stringify({ evidenceClass: r.cls }),
    )
  }
}

/** Seed the real index for `ws` into `dataDir`; returns the project id the
 *  server derives from the workspace root. */
export async function seedT5Db(ws: string, dataDir: string): Promise<{ projectId: string; raw: any }> {
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
