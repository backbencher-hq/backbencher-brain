import { writeFileSync } from "node:fs"
import { parseFile } from "/home/ishaq2321/mcp/backbencher-brain/src/ast/pool-worker"
const p = "/tmp/attach-verify.svelte"
writeFileSync(p, `<script>\n  import { myAttachment } from "./x.js"\n  const arrow = () => {}\n</script>\n<div {@attach myAttachment}>a</div>\n<div {@attach (node) => {}}></div>\n<div {@attach arrow}></div>\n`)
const r = await parseFile(p, process.cwd())
for (const rel of r.relationships ?? []) console.log(JSON.stringify({ source: rel.source, target: rel.target, type: rel.type, line: rel.line_number, ctx: rel.metadata?.context }))
