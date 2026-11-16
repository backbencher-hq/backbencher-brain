// script/m14/tmp/sw-m12-adjudicate.ts — the swift half of #933 (the M12 hand audit
// must describe the analyzer that exists). Prints every relationship the analyzer
// publishes for the two M12 swift fixtures, with the LINE it claims and the path
// metadata that produced it, so each FP/FN pair is adjudicated against the fixture
// SOURCE TEXT instead of against the audit's own wording.
//
// Run: bun script/m14/tmp/sw-m12-adjudicate.ts
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"

const DIR = "<corpus-root>/mcp/backbencher-brain/validation/m12/fixtures/swift"
for (const file of ["UserService.swift", "Negative.swift"]) {
  const f = path.join(DIR, file)
  const src = fs.readFileSync(f, "utf8")
  const lines = src.split("\n")
  const parsed: any = await (ASTEngine as any).parseFile(f, src, { language: "swift" })
  console.log(`\n########## ${file} — ${parsed.relationships?.length ?? 0} relationships`)
  const rels = (parsed.relationships ?? []).filter((r: any) => r.type === "uses")
  for (const r of rels) {
    const ln: number = r.line_number ?? 0
    console.log(
      `  L${String(ln).padStart(3)} uses ${String(r.source).padEnd(14)} -> ${String(r.target).padEnd(12)}` +
      ` conf=${r.confidence} ${JSON.stringify(r.metadata ?? {})}  | ${(lines[ln - 1] ?? "").trim().slice(0, 80)}`,
    )
  }
}
