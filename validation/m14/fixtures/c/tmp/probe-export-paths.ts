import * as path from "node:path"
import { parseFile } from "../../../../../src/ast/pool-worker"
const CR = path.resolve(import.meta.dirname, "../../../../../.corpus")
const files = process.argv.slice(2)
for (const f of files) {
  const abs = path.join(CR, f)
  const r: any = await parseFile(abs, path.join(CR, f.split("/")[0]))
  for (const e of r.relationships ?? []) {
    if (String(e.type) === "exports") console.log(`${f}:${e.line_number}  ${e.source} -> ${e.target}  kind=${(e.metadata??{}).exportMarkerKind} macro=${(e.metadata??{}).exportMacro}`)
  }
}
