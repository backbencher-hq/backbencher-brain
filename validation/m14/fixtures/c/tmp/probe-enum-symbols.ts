import * as path from "node:path"
import { parseFile } from "../../../../../src/ast/pool-worker"
const CR = path.resolve(import.meta.dirname, "../../../../../.corpus")
const [rel, ...names] = process.argv.slice(2)
const abs = path.join(CR, rel)
const r: any = await parseFile(abs, path.join(CR, rel.split("/")[0]))
for (const s of r.symbols ?? []) if (names.includes(String(s.name))) console.log(`symbol ${s.kind} ${s.name} owner=${(s as any).ownerName ?? "-"}`)
for (const e of r.relationships ?? []) if (String(e.type) === "contains" && names.includes(String(e.target))) console.log(`contains ${e.source} -> ${e.target}`)
