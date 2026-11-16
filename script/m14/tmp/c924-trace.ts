import { readFileSync } from "node:fs"
import { parseFile } from "../../../src/ast/engine"
const f = "<corpus-root>/bb_tests/repositories/fmt/include/fmt/format-inl.h"
const r: any = await parseFile(f, readFileSync(f, "utf8"))
for (const i of r.imports ?? []) if (/::/.test(String(i.module))) console.log("IMPORT", JSON.stringify(i.module), JSON.stringify(i.metadata), i.range?.startLine)
for (const x of r.relationships ?? []) if (x?.metadata?.relationshipType === "include_dependency" && /::/.test(String(x.target))) console.log("EDGE", JSON.stringify(x.target), x.line_number)
