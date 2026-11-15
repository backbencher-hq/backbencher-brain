// M59.A7 zig fixture measurement: what the PRODUCTION entry actually emits for
// the new fixture (symbols + every relationship with its line), so the
// expectation is authored from measurement and then hand-checked against source.
import fs from "node:fs"
import path from "node:path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const FILE = path.join(ROOT, "validation/m14/fixtures/zig/callsite-lines-825.zig")
const eng: any = await import(path.join(ROOT, "src/ast/engine.ts"))
const content = fs.readFileSync(FILE, "utf8")
const res = await eng.ASTEngine.parseFile(FILE, content)
console.log(`errors: ${(res.errors ?? []).length}`)
console.log("symbols:")
for (const s of res.symbols ?? []) console.log(`  ${s.kind} ${s.name} owner=${s.ownerName ?? "-"}`)
console.log("relationships:")
for (const r of res.relationships ?? []) {
  const line = r.line_number === undefined ? "NO-LINE" : r.line_number
  console.log(`  ${r.type} ${r.source} -> ${r.target}  line=${line}  conf=${r.confidence}`)
}
const lined = (res.relationships ?? []).filter((r: any) => typeof r.line_number === "number").length
console.log(`\nlined ${lined}/${(res.relationships ?? []).length}`)
// and what each claimed line actually contains (the Tier-A source check)
const lines = content.split("\n")
for (const r of res.relationships ?? []) {
  if (typeof r.line_number !== "number") continue
  const text = (lines[r.line_number - 1] ?? "").trim()
  const leaf = String(r.target).split(".").pop()
  const hit = text.includes(leaf)
  console.log(`${hit ? "ok  " : "MISS"} line ${r.line_number} for ${r.type} -> ${r.target} :: ${text}`)
}
