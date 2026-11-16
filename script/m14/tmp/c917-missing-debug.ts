// Debug: does the analyzer's post-fix output contain `uses -> cmpp_stream`, and
// what does the lane-style comparison see?
import fs from "node:fs"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const { parseFile } = await import(path.resolve("src/ast/engine.ts"))

const REPO = "<corpus-root>/bb_tests/repositories/sqlite"
const relPath = "ext/wasm/libcmpp.c"
const content = fs.readFileSync(path.join(REPO, relPath), "utf8")
const result: any = await parseFile(relPath, content, { language: "c" } as any)

const hits = (result.relationships ?? []).filter(
  (r: any) => String(r.target ?? "") === "cmpp_stream" || String(r.target ?? "").includes("cmpp_stream"),
)
console.log("total rels:", result.relationships?.length)
console.log("cmpp_stream rels:", hits.length)
for (const h of hits.slice(0, 8)) {
  console.log("  ", JSON.stringify({ type: h.type, relationshipType: h.relationshipType, source: h.source, target: h.target, line: h.line_number }))
}
const labels = new Map<string, number>()
for (const r of result.relationships ?? []) {
  const l = String(r.type ?? "")
  labels.set(l, (labels.get(l) ?? 0) + 1)
}
console.log("label histogram:", [...labels.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12))
