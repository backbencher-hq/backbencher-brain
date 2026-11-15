import { readFileSync } from "node:fs"
import { parseFile } from "../../../src/ast/engine"
const f = "validation/m14/fixtures/cpp/include-name-924.cpp"
const r: any = await parseFile(f, readFileSync(f, "utf8"))
console.log("keys:", Object.keys(r))
console.log("path-ish:", Object.entries(r).filter(([k,v]) => typeof v === "string" && (v.includes("include-name-924")||k.toLowerCase().includes("file")||k.toLowerCase().includes("path"))))
console.log("symbols sample:", JSON.stringify((r.symbols??[]).slice(0,2)))
