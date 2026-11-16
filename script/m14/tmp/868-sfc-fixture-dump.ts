// Author the #868 SFC expectations from LIVE emission through the real entry
// point (ASTEngine.parseFile), printed with the file's own line numbers.
import { readFileSync } from "node:fs"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"

const FILES = process.argv.slice(2)

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  for (const rel of FILES) {
    const full = path.join(ROOT, rel)
    const src = readFileSync(full, "utf8")
    console.log(`===== ${rel} =====`)
    console.log("--- the file's own lines of interest ---")
    src.split("\n").forEach((l, i) => {
      if (/@\w|class |pool|method\(\)|decorator/.test(l)) console.log(`   L${i + 1}: ${l}`)
    })
    const res: any = await ASTEngine.parseFile(full, src)
    console.log("--- symbols ---")
    for (const s of res.symbols ?? []) {
      if (!(s.decorators?.length > 0)) continue
      console.log(`   { "name": "${s.name}", "kind": "${String(s.kind)}"${s.ownerName ? `, "ownerName": "${s.ownerName}"` : ""} }  // L${s.range?.startLine} decorators=${JSON.stringify(s.decorators)} meta.decoratorLines=${JSON.stringify(s.metadata?.decoratorLines ?? null)}`)
    }
    console.log("--- decorator rows ---")
    for (const r of res.relationships ?? []) {
      if (!(r.metadata?.isDecorator || /sealed|inject/.test(String(r.target)))) continue
      console.log(`   { "type": "${String(r.type)}", "from": "${r.source}", "target": "${r.target}", "line_number": ${r.line_number ?? null}, "meta.decoratorLine": ${r.metadata?.decoratorLine ?? null} }  // offset=${r.metadata?.sfcLineOffset}`)
    }
    console.log("")
  }
}
main()
