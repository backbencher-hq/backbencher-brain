// script/m55/t3-fixture.ts — M55.T3 (issue #772) fixture, authored BEFORE the
// assertions that read it (the F7 fixture-first rule).
//
// The T3 defect ("four surfaces, four numbers") cannot be proved with a toy
// row set: it needs the exact row shapes the analyzers store. This fixture
// seeds a REAL sqlite index (the same schema the indexer writes) with one
// symbol of each kind the vocabulary must classify:
//
//   greet        called by `main` (another file), by `describe` (a third
//                file) and TWICE by `greetAll` (same location — the dedup
//                case); contained by its class `Greeter` (a DECLARATION, not
//                a usage); it also references `prefix` (its own callee, which
//                must never appear in ITS usages); it carries a self-loop row
//                (an analyzer artifact) and a row whose other end is indexed
//                with NULL coordinates (unresolvable — not renderable).
//   greetAll     ZERO callers, one callee (`greet`) and an owning class: the
//                acceptance-3 case — it must read "0 usages" and render NO
//                usages list, never its class declaration or its callee.
//   Greeter      its members are declared by `contains` rows (never usages of
//                it); it is instantiated by `main` and referenced by
//                `describe` (two usage sites), and exported by a file-level
//                row with no source symbol (not a site).
//
// The workspace sources exist on disk because the gate verifies every
// rendered file:line against the source BYTES (acceptance 4), and because the
// hover resolves positions and returns the definition range through the P1
// owner.
//
// The seed writes byte columns exactly as the analyzers do (1-based line,
// 1-based byte column per line, end exclusive) — computed from the sources
// above, never hand-picked.

import { createHash } from "node:crypto"
import { mkdirSync, realpathSync, writeFileSync } from "node:fs"
import path from "node:path"

export const T3_SOURCES: Record<string, string> = {
  "src/greeter.ts": `// The declared class: its members are declared by \`contains\` rows, which are
// not usages of the members and not usages of the class.
export class Greeter {
  private prefix: string

  constructor(prefix: string) {
    this.prefix = prefix
  }

  greet(name: string): string {
    return \`\${this.prefix}, \${name}!\`
  }

  greetAll(names: string[]): string[] {
    return names.map((n) => this.greet(n))
  }
}
`,
  "src/app.ts": `// Call site 1 (cross-file) for greet, and the only instantiation of Greeter.
import { Greeter } from "./greeter.js"

export function main(): string {
  const g = new Greeter("hi")
  return g.greet("world")
}
`,
  "src/report.ts": `// Call site 2 for greet (a third file) and a second reference to Greeter.
import { Greeter } from "./greeter.js"

export function describe(g: Greeter): string {
  return g.greet("there")
}
`,
  "package.json": `{
  "name": "bb-m55-t3-fixture",
  "private": true,
  "version": "0.0.0"
}
`,
}

/** One stored symbol: 1-based declaration line + the span the index stores. */
interface T3Symbol {
  id: string
  file: string
  name: string
  type: string
  qualified: string | null
  line: number
  span: number
  /** the byte column offset of the name within its line (0-based) */
  colInLine: number
  /** when set, the row is stored with NULL coordinates (unresolvable) */
  unresolvable?: boolean
}

export const T3_SYMBOLS: T3Symbol[] = [
  { id: "s-greeter", file: "src/greeter.ts", name: "Greeter", type: "class", qualified: "greeter.Greeter", line: 3, span: 14, colInLine: 13 },
  { id: "s-prefix", file: "src/greeter.ts", name: "prefix", type: "field", qualified: "Greeter.prefix", line: 4, span: 1, colInLine: 10 },
  { id: "s-greet", file: "src/greeter.ts", name: "greet", type: "method", qualified: "Greeter.greet", line: 10, span: 3, colInLine: 2 },
  { id: "s-greet-all", file: "src/greeter.ts", name: "greetAll", type: "method", qualified: "Greeter.greetAll", line: 14, span: 3, colInLine: 2 },
  { id: "s-main", file: "src/app.ts", name: "main", type: "function", qualified: "main", line: 4, span: 4, colInLine: 16 },
  { id: "s-describe", file: "src/report.ts", name: "describe", type: "function", qualified: "describe", line: 4, span: 3, colInLine: 16 },
  // Indexed with no resolvable location: a usage row pointing here must not
  // render (nothing unclickable, §12.1) and must not be counted.
  { id: "s-ghost", file: "src/app.ts", name: "ghost", type: "function", qualified: null, line: 1, span: 1, colInLine: 0, unresolvable: true },
]

export interface T3Row {
  id: string
  source: string | null
  target: string | null
  type: string
  confidence: number
}

/** The stored rows, in the analyzer vocabulary (`calls`, plural). */
export const T3_ROWS: T3Row[] = [
  { id: "r1", source: "s-main", target: "s-greet", type: "calls", confidence: 0.9 },
  { id: "r2", source: "s-describe", target: "s-greet", type: "calls", confidence: 0.9 },
  // The declaration: greet is DECLARED by Greeter — never a usage of greet.
  { id: "r3", source: "s-greeter", target: "s-greet", type: "contains", confidence: 1 },
  // Two rows, ONE location: the usage-site dedup case (the count must equal
  // the rendered rows, and the SQL double must dedup identically).
  { id: "r4", source: "s-greet-all", target: "s-greet", type: "calls", confidence: 0.9 },
  { id: "r5", source: "s-greet-all", target: "s-greet", type: "calls", confidence: 0.9 },
  // greetAll's own declaration (again: not a usage of greetAll).
  { id: "r6", source: "s-greeter", target: "s-greet-all", type: "contains", confidence: 1 },
  // Greeter's usage sites.
  { id: "r7", source: "s-describe", target: "s-greeter", type: "references", confidence: 0.95 },
  { id: "r8", source: "s-main", target: "s-greeter", type: "instantiates", confidence: 1 },
  // A file-level export: no source symbol, so no site can be built from it.
  { id: "r9", source: null, target: "s-greeter", type: "exports", confidence: 1 },
  // greet's own reference to its field: a callee-side row, never a usage of greet.
  { id: "r10", source: "s-greet", target: "s-prefix", type: "uses", confidence: 0.85 },
  // The other end is indexed with no resolvable coordinates: not renderable.
  { id: "r11", source: "s-ghost", target: "s-greet", type: "calls", confidence: 0.8 },
  // Self-loop artifact (both ends are the symbol): not a usage.
  { id: "r12", source: "s-greet", target: "s-greet", type: "calls", confidence: 0.6 },
]

export const T3_EXPECT = {
  /** The only symbols any surface may offer as usage sites of greet. */
  greetUsageSites: ["main", "describe", "greetAll"],
  /** greetAll has no callers at all (acceptance 3). */
  greetAllUsageSites: [] as string[],
  greeterUsageSites: ["main", "describe"],
  /** A name no analyzer stores. */
  absent: "t3_absent_symbol_zzz",
} as const

export function writeT3Workspace(dir: string): void {
  for (const [rel, body] of Object.entries(T3_SOURCES)) {
    const abs = path.join(dir, rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, body)
  }
}

/** Byte column (1-based, per-line convention) of `name`'s first byte on its
 *  line — computed from the source, never hand-picked. */
function byteColumn(symbol: T3Symbol): number {
  const lines = T3_SOURCES[symbol.file]!.split("\n")
  const line = lines[symbol.line - 1]!
  const at = line.indexOf(symbol.name)
  if (at === -1) throw new Error(`t3 fixture: "${symbol.name}" not on ${symbol.file}:${symbol.line}`)
  return Buffer.byteLength(line.slice(0, at), "utf8") + 1
}

/**
 * Seed the real index for `ws` into `dataDir` and return the project id the
 * server will derive from the workspace root. Uses the production database
 * (BrainDatabase) — the same schema, indexes and foreign keys the analyzers
 * write through, so the gate's queries run against the real thing.
 */
export async function seedT3Db(
  ws: string,
  dataDir: string,
): Promise<{ projectId: string; raw: any; cleanup: () => void }> {
  const projectId = createHash("sha1").update(realpathSync(ws)).digest("hex").substring(0, 40)
  mkdirSync(path.join(dataDir, "projects", projectId), { recursive: true })
  process.env.BB_DATA_DIR = dataDir
  const { BrainDatabase } = (await import(path.join(path.resolve(import.meta.dirname, "../.."), "src", "brain", "database.ts"))) as {
    BrainDatabase: { getRawInstance(projectId: string): Promise<unknown> }
  }
  const raw = (await BrainDatabase.getRawInstance(projectId)) as {
    prepare(sql: string): { run(...params: unknown[]): unknown }
  }

  const insFile = raw.prepare(
    "INSERT INTO brain_file (id, project_id, path, relative_path, language, file_hash) VALUES (?,?,?,?,?,?)",
  )
  for (const [i, rel] of Object.keys(T3_SOURCES).entries()) {
    insFile.run(`f${i}`, projectId, path.join(ws, rel), rel, rel.endsWith(".json") ? "json" : "typescript", `h${i}`)
  }
  const fileIdOf = (rel: string): string => `f${Object.keys(T3_SOURCES).indexOf(rel)}`

  const insSym = raw.prepare(
    `INSERT INTO brain_symbol (id, project_id, file_id, name, symbol_type, qualified_name, line_start, line_end, byte_start, byte_end, return_type, parameters, visibility, gravity_score)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  for (const s of T3_SYMBOLS) {
    const bs = s.unresolvable ? null : byteColumn(s)
    const be = bs === null ? null : bs + Buffer.byteLength(s.name, "utf8")
    insSym.run(
      s.id,
      projectId,
      fileIdOf(s.file),
      s.name,
      s.type,
      s.qualified,
      s.unresolvable ? null : s.line,
      s.unresolvable ? null : s.line + s.span - 1,
      bs,
      be,
      s.type === "class" ? null : "string",
      s.type === "method" || s.type === "function" ? "[]" : null,
      s.type === "field" ? "private" : "public",
      5,
    )
  }

  const insRel = raw.prepare(
    `INSERT INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence)
     VALUES (?,?,?,?,?,?)`,
  )
  for (const r of T3_ROWS) insRel.run(r.id, projectId, r.source, r.target, r.type, r.confidence)

  return {
    projectId,
    raw,
    cleanup: () => {
      // The caller owns the temp dirs; nothing else to release here.
    },
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("T3 fixture sources:", Object.keys(T3_SOURCES).join(", "))
}
