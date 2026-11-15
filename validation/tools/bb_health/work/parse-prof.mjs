import { readFileSync, readdirSync } from "node:fs"
const files = readdirSync(".").filter((f) => f.endsWith(".cpuprofile"))
if (!files.length) { console.log("no cpuprofile"); process.exit(0) }
const prof = JSON.parse(readFileSync(files[files.length - 1], "utf8"))
const nodes = new Map(prof.nodes.map((n) => [n.id, n]))
const self = new Map()
const byId = prof.samples ?? []
// dt per sample from timeDeltas
for (let i = 0; i < byId.length; i++) {
  const id = byId[i]
  const dt = prof.timeDeltas?.[i] ?? 0
  self.set(id, (self.get(id) ?? 0) + dt)
}
const rows = [...self.entries()].map(([id, us]) => {
  const n = nodes.get(id) ?? {}
  const cf = n.callFrame ?? {}
  return { us, name: cf.functionName || "(anonymous)", url: cf.url || "", line: cf.lineNumber }
}).filter((r) => r.us > 20000).sort((a, b) => b.us - a.us).slice(0, 30)
for (const r of rows) console.log(`${(r.us / 1000).toFixed(0).padStart(7)}ms  ${r.name}  ${r.url.replace(/.*\//, "").slice(0, 60)}:${r.line}`)
