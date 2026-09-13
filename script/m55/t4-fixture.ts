// script/m55/t4-fixture.ts — M55.T4 fixture, authored BEFORE the assertions
// that read it (the F7 fixture-first rule).
//
// The stored `parameters` column has exactly the shapes the analyzers write
// (verified across every brain.db on this machine: 148 rows, six key shapes —
// isOptional+name+type; defaultValue+isOptional+name; defaultValue+isOptional+
// name+type; name; name+type; isImplicit+name+type). The fixture carries one
// symbol per shape plus the cases the issue names:
//
//   size()            an EMPTY stored list        -> `()`
//   put(k, v, loud?)  a multi-param method with an optional flag
//   merge(other, note?)  generics, verbatim
//   mystery(raw)      NO stored type (the only unresolvable case the index
//                     actually produces) -> the declared unknown marker
//   render(count = 3) a stored DEFAULT value and no type
//   spread(...rest)   a REST parameter — declared by the flag AND, in the
//                     python file, by the stored name's own `*` marker (see
//                     the limitations in the evidence: no analyzer writes the
//                     flag today, so both declared forms are exercised)
//   Box (a class)     NOT callable: it must never render `()`
//
// Sources exist on disk because the hover resolves positions and the call
// hierarchy reads the file; the gate also asserts the wire's rendered text
// against these bytes.

import { createHash } from "node:crypto"
import { mkdirSync, realpathSync, writeFileSync } from "node:fs"
import path from "node:path"

export const T4_SOURCES: Record<string, string> = {
  "src/sig.ts": `// The TS signature fixture: one symbol per stored parameter shape.
export class Box<T> {
  private items: T[] = []

  size(): number {
    return this.items.length
  }

  put(key: string, value: T, loud?: boolean): void {
  }

  spread(...rest: number[]): number {
    return rest.length
  }

  merge(other: Box<T>, note?: string): Box<T> {
    return other
  }

  mystery(raw): void {
  }

  render(count = 3): void {
  }
}
`,
  "src/sig.py": `# The python notation case: an implicit receiver, a default value and a rest
# parameter stored by its own name marker.
class Calc:
    def total(self, count=3, *rest):
        return count
`,
  "package.json": `{
  "name": "bb-m55-t4-fixture",
  "private": true,
  "version": "0.0.0"
}
`,
}

interface T4Symbol {
  id: string
  file: string
  name: string
  type: string
  qualified: string | null
  line: number
  span: number
  returnType: string | null
  /** the stored column, exactly as an analyzer writes it */
  parameters: string | null
}

export const T4_SYMBOLS: T4Symbol[] = [
  { id: "s-box", file: "src/sig.ts", name: "Box", type: "class", qualified: "sig.Box", line: 2, span: 24, returnType: null, parameters: null },
  { id: "s-items", file: "src/sig.ts", name: "items", type: "field", qualified: "Box.items", line: 3, span: 1, returnType: "T[]", parameters: null },
  { id: "s-size", file: "src/sig.ts", name: "size", type: "method", qualified: "Box.size", line: 5, span: 3, returnType: "number", parameters: "[]" },
  {
    id: "s-put",
    file: "src/sig.ts",
    name: "put",
    type: "method",
    qualified: "Box.put",
    line: 9,
    span: 2,
    returnType: "void",
    parameters: '[{"name":"key","type":"string","isOptional":false},{"name":"value","type":"T","isOptional":false},{"name":"loud","type":"boolean","isOptional":true}]',
  },
  { id: "s-spread", file: "src/sig.ts", name: "spread", type: "method", qualified: "Box.spread", line: 12, span: 3, returnType: "number", parameters: '[{"name":"rest","type":"number[]","isRest":true}]' },
  {
    id: "s-merge",
    file: "src/sig.ts",
    name: "merge",
    type: "method",
    qualified: "Box.merge",
    line: 16,
    span: 3,
    returnType: "Box<T>",
    parameters: '[{"name":"other","type":"Box<T>"},{"name":"note","type":"string","isOptional":true}]',
  },
  { id: "s-mystery", file: "src/sig.ts", name: "mystery", type: "method", qualified: "Box.mystery", line: 20, span: 2, returnType: "void", parameters: '[{"name":"raw"}]' },
  { id: "s-render", file: "src/sig.ts", name: "render", type: "method", qualified: "Box.render", line: 23, span: 2, returnType: "void", parameters: '[{"name":"count","defaultValue":"3","isOptional":true}]' },
  { id: "s-calc", file: "src/sig.py", name: "Calc", type: "class", qualified: "Calc", line: 3, span: 3, returnType: null, parameters: null },
  { id: "s-total", file: "src/sig.py", name: "total", type: "method", qualified: "Calc.total", line: 4, span: 2, returnType: null, parameters: '[{"name":"self","isImplicit":true},{"name":"count","defaultValue":"3","isOptional":true},{"name":"*rest"}]' },
]

/** The rendered signature each fixture symbol must produce (TS/JS notation,
 *  python for the .py file) — authored before the renderer existed. */
export const T4_EXPECT: Record<string, string> = {
  "s-box": "public class Box",
  "s-items": "public field items → T[]",
  "s-calc": "public class Calc",
  "s-size": "public method size() → number",
  "s-put": "public method put(key: string, value: T, loud?: boolean) → void",
  "s-spread": "public method spread(...rest: number[]) → number",
  "s-merge": "public method merge(other: Box<T>, note?: string) → Box<T>",
  "s-mystery": "public method mystery(raw: unknown) → void",
  "s-render": "public method render(count: unknown = 3) → void",
  "s-total": "public method total(self, count: unknown = 3, *rest: unknown)",
}

export function writeT4Workspace(dir: string): void {
  for (const [rel, body] of Object.entries(T4_SOURCES)) {
    const abs = path.join(dir, rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, body)
  }
}

async function insertAll(raw: any, projectId: string, dir: string): Promise<void> {
  const insFile = raw.prepare("INSERT INTO brain_file (id, project_id, path, relative_path, language, file_hash) VALUES (?,?,?,?,?,?)")
  for (const [i, rel] of Object.keys(T4_SOURCES).entries()) {
    insFile.run(`f${i}`, projectId, path.join(dir, rel), rel, rel.endsWith(".py") ? "python" : rel.endsWith(".json") ? "json" : "typescript", `h${i}`)
  }
  const insSym = raw.prepare(
    `INSERT INTO brain_symbol (id, project_id, file_id, name, symbol_type, qualified_name, line_start, line_end,
       byte_start, byte_end, return_type, parameters, visibility, gravity_score)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  for (const s of T4_SYMBOLS) {
    const lines = T4_SOURCES[s.file]!.split("\n")
    const lineText = lines[s.line - 1]!
    const at = lineText.indexOf(s.name)
    const bs = Buffer.byteLength(lineText.slice(0, Math.max(0, at)), "utf8") + 1
    const be = bs + Buffer.byteLength(s.name, "utf8")
    insSym.run(
      s.id,
      projectId,
      `f${Object.keys(T4_SOURCES).indexOf(s.file)}`,
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
    )
  }
}

/** Seed the real index for `ws` into `dataDir`; returns the project id the
 *  server derives from the workspace root. */
export async function seedT4Db(ws: string, dataDir: string): Promise<{ projectId: string; raw: any }> {
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
