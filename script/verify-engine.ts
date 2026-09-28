// verify-engine.ts — Phase 2 acceptance test.
// Proves the ported engine parses real code identically under Bun and Node:
//   bun run script/verify-engine.ts
//   npx tsx script/verify-engine.ts
import { ASTEngine } from "../src/ast/engine"

let failures = 0
function check(label: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ok: ${label}`)
  else {
    failures++
    console.log(`  FAIL: ${label} ${detail}`)
  }
}

console.log(`runtime: ${process.version} (${typeof Bun !== "undefined" ? "bun" : "node"})`)

const TS_FIXTURE = `import { z } from "zod"

export interface User {
  id: number
  name: string
}

export class UserService {
  private users: User[] = []

  async findUser(id: number): Promise<User | undefined> {
    return this.users.find((u) => u.id === id)
  }

  addUser(user: User): void {
    this.users.push(user)
  }
}

export function createUser(name: string): User {
  return { id: 1, name }
}

const schema = z.object({ name: z.string() })
export default schema
`

const PY_FIXTURE = `import os
from typing import List, Optional

class Database:
    def __init__(self, path: str):
        self.path = path
        self.conn = None

    def connect(self) -> None:
        self.conn = os.path.join(self.path, "db.sqlite")

def create_database(path: str) -> Database:
    return Database(path)

CONFIG = {"env": "test"}
`

const DART_FIXTURE = `class Counter {
  int _value = 0;

  void increment() {
    _value++;
  }

  int get value => _value;
}

void main() {
  final c = Counter();
  c.increment();
}
`

const fixtures: Array<[string, string, string]> = [
  ["/tmp/bbcore-fixture/user.ts", "typescript", TS_FIXTURE],
  ["/tmp/bbcore-fixture/db.py", "python", PY_FIXTURE],
  ["/tmp/bbcore-fixture/counter.dart", "dart", DART_FIXTURE],
]

for (const [filePath, expectedLang, content] of fixtures) {
  const parsed = await ASTEngine.parseFile(filePath, content)
  check(`${expectedLang}: parse succeeds`, parsed.success !== false, JSON.stringify(parsed).slice(0, 200))
  check(`${expectedLang}: language detected`, (parsed.language || "").toLowerCase() === expectedLang, `got ${parsed.language}`)
  const symbols = parsed.symbols || []
  check(`${expectedLang}: symbols non-empty`, symbols.length > 0, `got ${symbols.length}`)
  console.log(`  ${expectedLang} symbols: ${symbols.slice(0, 8).map((s: any) => `${s.name}:${s.kind}`).join(", ")}`)
}

// TypeScript symbol spot-checks
const ts = await ASTEngine.parseFile("/tmp/bbcore-fixture/user.ts", TS_FIXTURE)
const tsNames = new Set((ts.symbols || []).map((s: any) => s.name))
for (const expect of ["UserService", "findUser", "addUser", "createUser", "User", "schema"]) {
  check(`ts has symbol ${expect}`, tsNames.has(expect), `names=[${[...tsNames].join(",")}]`)
}

// Phase 3 regression: NO phantom junk — the fixture references none of these.
const PHANTOM = ["this", "window", "document", "console", "process", "global", "__dirname", "__filename"]
const phantomHits = (ts.symbols || []).filter((s: any) => PHANTOM.includes(s.name))
check("ts has no phantom globals (this/window/console/...)", phantomHits.length === 0, `got ${phantomHits.map((s: any) => s.name).join(",")}`)
const zeroLine = (ts.symbols || []).filter((s: any) => (s.range?.startLine ?? 0) < 1)
check("ts has no line-0 symbols (phantom constructors)", zeroLine.length === 0, `got ${zeroLine.map((s: any) => s.name).join(",")}`)
const constructorOnly = (ts.symbols || []).filter((s: any) => s.name === "constructor")
check("ts has no injected constructors", constructorOnly.length === 0, `got ${constructorOnly.length}`)

// Phase 3 regression: exact line numbers (tree-sitter rows are 0-indexed;
// the index convention is 1-based). Fixture lines:
//   UserService @8, findUser @11, addUser @15, createUser @20, schema @24
const lineOf = (name: string) => (ts.symbols as any[]).find((s) => s.name === name)?.range?.startLine
check("ts line: UserService @8", lineOf("UserService") === 8, `got ${lineOf("UserService")}`)
check("ts line: findUser @11", lineOf("findUser") === 11, `got ${lineOf("findUser")}`)
check("ts line: addUser @15", lineOf("addUser") === 15, `got ${lineOf("addUser")}`)
check("ts line: createUser @20", lineOf("createUser") === 20, `got ${lineOf("createUser")}`)
check("ts line: schema @24", lineOf("schema") === 24, `got ${lineOf("schema")}`)

// line numbers must be sane (≥1, within file)
for (const s of (ts.symbols || []) as any[]) {
  if (s.line_start < 1) {
    failures++
    console.log(`  FAIL: ts symbol ${s.name} has line_start ${s.line_start}`)
  }
}

// relationships: class -> method ownership
const rels = (ts.relationships || []).map((r: any) => `${r.type}:${r.source_name || ""}->${r.target_name || ""}`)
console.log(`  ts relationships: ${rels.slice(0, 6).join(", ")}`)

console.log(failures === 0 ? "\nENGINE VERIFY: ALL PASS" : `\nENGINE VERIFY: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
