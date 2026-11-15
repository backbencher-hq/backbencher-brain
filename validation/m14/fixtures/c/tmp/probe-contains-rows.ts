import * as path from "node:path"
import { parseFile } from "../../../../../src/ast/pool-worker"
const CR = path.resolve(import.meta.dirname, "../../../../../.corpus")
const [rel, ...targets] = process.argv.slice(2)
const abs = path.join(CR, rel)
const r: any = await parseFile(abs, path.join(CR, "sqlite"))
for (const e of r.relationships ?? []) {
  if (String(e.type) === "contains" && targets.includes(String(e.target))) {
    console.log(`contains ${e.source} -> ${e.target} @${e.line_number}`)
  }
}
for (const s of r.symbols ?? []) {
  if ((s as any).ownerName && targets.includes(String(s.name))) console.log(`symbol ${s.kind} ${s.name} owner=${(s as any).ownerName} meta=${JSON.stringify((s as any).metadata ?? {})}`)
}
