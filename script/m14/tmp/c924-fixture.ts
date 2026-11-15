import { readFileSync } from "node:fs"
import { parseFile } from "../../../src/ast/engine"
const f = "validation/m14/fixtures/cpp/include-name-924.cpp"
const r: any = await parseFile(f, readFileSync(f, "utf8"))
console.log("imports:", JSON.stringify(r.imports, null, 1))
console.log("rows:", JSON.stringify((r.relationships ?? []).filter((x: any) =>
  x?.metadata?.relationshipType === "include_dependency" ||
  x?.type === "imports" || x?.type === "references"), null, 1))
