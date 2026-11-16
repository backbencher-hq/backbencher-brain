import { readFileSync, writeFileSync } from "node:fs"
import { parseFile } from "<corpus-root>/mcp/backbencher-brain/src/ast/pool-worker"
const f = "<corpus-root>/bb_tests/repositories/svelte/packages/svelte/tests/runtime-runes/samples/error-boundary-5/main.svelte"
const r = await parseFile(f, "<corpus-root>/bb_tests/repositories/svelte")
for (const rel of r.relationships ?? []) {
  if (["log", "retry", "shift", "pop", "onclick"].includes(rel.target)) console.log(JSON.stringify({ from: rel.source, to: rel.target, line: rel.line_number, ctx: rel.metadata?.context, conf: rel.confidence }))
}
