// #924 kotlin: WHICH edge/symbol publishes the raw chain text, and with what
// metadata — so the fix is pinned at the PUBLICATION level, not only in the
// probe's classification.
//
// Read-only. Run in a replica: bun script/m14/tmp/c924-kt-edge-dump.ts
import * as fs from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../src/ast/engine"

const SNIPPET = [
  "class T {",
  "  fun `test char column read and write`() {",
  "    assertEquals(1, dest.selectAll().where { dest.id eq 1 }.single()[dest.id].value)",
  "  }",
  "}",
].join("\n")

const NEEDLES = ["`test char column read and write`", "test char column read and write", "dest.selectAll().where", "getMap(f)"]

const dir = "/tmp/c924-edge-dump"
fs.mkdirSync(dir, { recursive: true })
const file = path.join(dir, "snippet.kt")
fs.writeFileSync(file, SNIPPET)

const res: any = await parseFile(file, SNIPPET)
const hit = (s: string) => NEEDLES.some((n) => s.includes(n))

console.log("=== symbols ===")
for (const s of res.symbols ?? []) {
  if (hit(String(s.name ?? ""))) console.log(JSON.stringify({ name: s.name, id: s.id, kind: s.kind }))
}
console.log("=== relationships ===")
for (const r of res.relationships ?? []) {
  if (hit(String(r.source ?? "")) || hit(String(r.target ?? ""))) {
    console.log(JSON.stringify({ type: r.type, source: r.source, target: r.target }))
  }
}
