// verify-index.ts — Phase 3 acceptance: full end-to-end index of a fixture
// project, then assert the resulting DB has NO garbage symbols.
//
//   bun run script/verify-index.ts      (and npx tsx under Node)
import { ASTEngine } from "../src/ast/engine"
import { indexProjectParallel } from "../src/ast/parallel-indexer"
import { BrainDatabase } from "../src/brain/database"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"

let failures = 0
function check(label: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ok: ${label}`)
  else {
    failures++
    console.log(`  FAIL: ${label} ${detail}`)
  }
}
console.log(`runtime: ${process.version} (${typeof Bun !== "undefined" ? "bun" : "node"})`)

// ── fixture project ──────────────────────────────────────────────────────
const root = mkdtempSync(path.join(tmpdir(), "bb-index-fixture-"))
const pid = "verify-fixture"
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(
  path.join(root, "src", "math.ts"),
  `export function add(a: number, b: number): number {
  return a + b
}

export class Calculator {
  private total = 0
  add(n: number): void {
    this.total += n
  }
  get value(): number {
    return this.total
  }
}
`,
)
writeFileSync(
  path.join(root, "src", "notes.py"),
  `import os

def create_note(title: str) -> dict:
    return {"title": title}

class NoteBook:
    def __init__(self):
        self.notes = []

    def add(self, note: dict) -> None:
        self.notes.append(note)
`,
)
writeFileSync(path.join(root, "README.md"), `# Fixture project\n\nNothing to see here.\n`)
writeFileSync(path.join(root, "src", "data.json"), `{"a": 1, "b": [1, 2, 3]}\n`)
// #816 regression fixture: a manifest key named `name` competes with a member
// the TypeScript file DECLARES. Before the fix the resolver (a bare
// `WHERE name = ? LIMIT 1`, no ORDER BY) returned the package.json key, so
// `greet --uses--> name` and `Greeter --contains--> name` both pointed into the
// manifest and were stamped is_cross_language=1 / bridge `name-resolution`.
writeFileSync(path.join(root, "package.json"), `{\n  "name": "verify-fixture",\n  "version": "1.0.0"\n}\n`)
writeFileSync(
  path.join(root, "src", "greeter.ts"),
  `export class Greeter {\n  private name = "x"\n  greet(): string {\n    return this.name\n  }\n}\n`,
)

// ── index ────────────────────────────────────────────────────────────────
console.log("indexing fixture project...")
const result = await indexProjectParallel(pid, root, {})
console.log(`  indexed: files=${result?.totalFiles ?? "?"} symbols=${JSON.stringify(result).slice(0, 60)}`)

// ── assert DB contents ───────────────────────────────────────────────────
const dbPath = BrainDatabase.getDbPath(pid)
const raw = BrainDatabase.openByPath(dbPath, { readonly: true })

const files = (raw.prepare("SELECT COUNT(*) c FROM brain_file").get() as any).c
const symbols = raw.prepare("SELECT COUNT(*) c FROM brain_symbol").all() as any[]
const symCount = symbols[0]?.c ?? 0
console.log(`  db: files=${files} symbols=${symCount}`)
check("db has files", files >= 3, `got ${files}`)
check("db has symbols", symCount > 0, `got ${symCount}`)

// 1. NO phantom junk
const phantoms = raw
  .prepare(`SELECT name, COUNT(*) c FROM brain_symbol WHERE name IN ('this','window','document','console','process','global','__dirname','__filename','constructor') GROUP BY name`)
  .all() as any[]
check("no phantom symbols in index", phantoms.length === 0, `got ${phantoms.map((p) => `${p.name}=${p.c}`).join(",")}`)

// 2. NO line-0 rows
const zero = (raw.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE line_start < 1").get() as any).c
check("no line-0 symbols", zero === 0, `got ${zero}`)

// 3. NO artifact names (paths, object_N, numeric)
const artifacts = raw
  .prepare(`SELECT COUNT(*) c FROM brain_symbol WHERE name LIKE '/%/%' OR name GLOB 'object_[0-9]*' OR name GLOB '[0-9.+-]*' OR name IN ('this','global','super','arguments')`)
  .get() as any
check("no artifact names", artifacts.c === 0, `got ${artifacts.c}`)

// 4. real symbols present with correct 1-based lines
const addFn = raw.prepare("SELECT name, line_start, symbol_type FROM brain_symbol WHERE name = 'add' AND symbol_type = 'function'").get() as any
check("ts add() present at line 1", addFn != null && addFn.line_start === 1, JSON.stringify(addFn))
const calc = raw.prepare("SELECT name, line_start, symbol_type FROM brain_symbol WHERE name = 'Calculator' AND symbol_type = 'class'").get() as any
check("ts Calculator at line 5", calc != null && calc.line_start === 5, JSON.stringify(calc))
const noteBook = raw.prepare("SELECT name, line_start, symbol_type FROM brain_symbol WHERE name = 'NoteBook' AND symbol_type = 'class'").get() as any
check("py NoteBook at line 6", noteBook != null && noteBook.line_start === 6, JSON.stringify(noteBook))

// 5. #816 regression: name resolution must prefer the NEAREST candidate and
//    must never fabricate a cross-language edge into a manifest key. Proven
//    load-bearing by reverting the resolver's ORDER BY: the unordered
//    `LIMIT 1` picks package.json's `name` in this exact fixture and both
//    assertions below fail (see the #816 note in src/ast/parallel-indexer.ts).
const greetUses = raw
  .prepare(`SELECT target_symbol_id FROM brain_relationship WHERE source_symbol_id LIKE '%src/greeter.ts:greet:%' AND relationship_type = 'uses'`)
  .all() as any[]
check(
  "#816 greet's member read resolves inside its own file",
  greetUses.length === 1 && String(greetUses[0].target_symbol_id).includes("src/greeter.ts:name"),
  JSON.stringify(greetUses),
)
const greetContains = raw
  .prepare(`SELECT target_symbol_id FROM brain_relationship WHERE source_symbol_id LIKE '%src/greeter.ts:Greeter:%' AND relationship_type = 'contains' AND target_symbol_id LIKE '%name%'`)
  .all() as any[]
check(
  "#816 Greeter contains its own member, not a manifest key",
  greetContains.length === 1 && String(greetContains[0].target_symbol_id).includes("src/greeter.ts:name"),
  JSON.stringify(greetContains),
)
const manifestXlang = raw
  .prepare(`SELECT COUNT(*) c FROM brain_relationship WHERE is_cross_language = 1 AND target_symbol_id LIKE '%package.json%'`)
  .get() as any
check("#816 no cross-language edge fabricated into a manifest", manifestXlang.c === 0, `got ${manifestXlang.c}`)

// 6. no junk names like $, ./, object_
const junk = raw.prepare("SELECT name FROM brain_symbol WHERE name NOT LIKE 'add' AND name NOT LIKE 'Calculator' AND name NOT LIKE 'value' AND name NOT LIKE 'create_note' AND name NOT LIKE 'NoteBook' AND name NOT LIKE 'notes' AND name NOT LIKE 'total'").all() as any[]
console.log(`  (other symbols: ${junk.map((j) => j.name).join(", ")})`)

rmSync(root, { recursive: true, force: true })
rmSync(path.dirname(dbPath), { recursive: true, force: true })
console.log(failures === 0 ? "\nINDEX VERIFY: ALL PASS" : `\nINDEX VERIFY: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
