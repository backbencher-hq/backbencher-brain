// #907 acceptance 3 residue: the 10 names clang reports as main-file
// DEFINITIONS that the analyzer does not emit AND that appear in the file text.
// Each is resolved with three facts, all measured: is it really absent from the
// analyzer, what is written at clang's reported line, and does the tree carry an
// ERROR row near it (the #907 swallow shape)?
//
// Run: bun script/m14/tmp/c907-residue-open.ts
import { readFileSync } from "node:fs"
import { parseFile } from "../../../src/ast/pool-worker"
import { ASTEngine } from "../../../src/ast/engine"

const ROOT = "/home/ishaq2321/bb_tests/repositories/jq"
const audit = JSON.parse(readFileSync("validation/m12/results/c-clang-def-audit.json", "utf8"))

const TARGETS: Array<[string, string[]]> = audit.perFile
  .filter((r: any) => r.lostDefs?.length)
  .map((r: any) => [r.file, r.lostDefs] as [string, string[]])

for (const [rel, names] of TARGETS) {
  const abs = `${ROOT}/${rel}`
  const src = readFileSync(abs, "utf8").split("\n")
  const r: any = await parseFile(abs, ROOT)
  const fns = new Set((r.symbols ?? []).filter((s: any) => s.kind === "function").map((s: any) => String(s.name)))
  const lines: Record<string, number> = audit.perFile.find((x: any) => x.file === rel).lostDefLines ?? {}
  // line-valued: does the file's own text write the name at/near clang's row?
  console.log(`\n=== ${rel} (${names.length} lost defin.) ===`)
  const t: any = (await ASTEngine.parseTree(abs, readFileSync(abs, "utf8"))).tree
  for (const n of names) {
    const L = lines[n]
    const ctx = typeof L === "number" ? [L - 2, L - 1, L, L + 1].filter(i => i > 0 && i <= src.length).map(i => `${i}:${(src[i - 1] ?? "").trim().slice(0, 60)}`).join(" | ") : "(no line)"
    const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const written = new RegExp(`(^|[^\\w])${escaped}\\s*\\(`).test(src.join("\n"))
    console.log(`  ${fns.has(n) ? "PRESENT" : "ABSENT "} ${n}  written-in-text=${written}  clang-line=${L}`)
    console.log(`      src: ${ctx}`)
  }
  // error rows in the tree near the target lines
  const errs: string[] = []
  const walk = (node: any): void => {
    if (node.type === "ERROR") errs.push(`${node.startPosition.row + 1}-${node.endPosition.row + 1}`)
    for (const c of node.children ?? []) walk(c)
  }
  try { walk(t.rootNode) } catch { /* shape differs */ }
  if (errs.length) console.log(`      tree ERROR rows: ${errs.slice(0, 10).join(", ")}${errs.length > 10 ? ` (+${errs.length - 10})` : ""}`)
  else console.log("      tree ERROR rows: none")
}
