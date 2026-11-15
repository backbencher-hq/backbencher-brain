// #921 fixture probe: print the containment edges the two new fixtures produce,
// through the production entry, so the expectations are written from a
// measurement rather than from intent.
import { readFileSync } from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"

for (const f of [
  "validation/m14/fixtures/cpp/contains-name-line-921.cpp",
  "validation/m14/fixtures/c/contains-name-line-921.c",
]) {
  let t: string
  try {
    t = readFileSync(f, "utf8")
  } catch {
    console.log(`(missing) ${f}`)
    continue
  }
  const res: any = await ASTEngine.parseFile(f, t)
  console.log(`\n=== ${f} (dispatch ${res.language}) — ${(res.symbols ?? []).length} symbols`)
  for (const s of res.symbols ?? []) {
    console.log(`   sym ${s.kind} ${s.name} owner=${s.ownerName ?? "-"} start=${s.range?.startLine} nameLine=${(s.metadata ?? {}).nameLine}`)
  }
  for (const r of res.relationships ?? []) {
    if (r.type !== "contains") continue
    console.log(`   contains ${r.source} -> ${r.target} @${r.line_number}`)
  }
}
