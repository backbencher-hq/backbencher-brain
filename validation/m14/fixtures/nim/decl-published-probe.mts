/**
 * NIM — IS THIS TARGET PUBLISHED AS A SYMBOL BY ONE FILE? (read-only, one small probe)
 *
 * The residual's biggest buckets name targets like `TGLenum` and `doAssert`. The question a
 * cause classification cannot answer from counts alone is whether the target has NO declaration
 * anywhere, or whether a declaration exists and the analyzer does not PUBLISH it — those are two
 * different repairs and only the second is the lane's to make.
 *
 * Usage: npx tsx validation/m14/fixtures/nim/decl-published-probe.mts <file> <name> [<name> ...]
 */
import { parseFile } from "../../../../src/ast/pool-worker"

const [file, ...names] = process.argv.slice(2)
if (!file || names.length === 0) {
  console.error("usage: decl-published-probe.mts <file> <name> [name ...]")
  process.exit(2)
}
const repo = file.slice(0, file.indexOf("/repositories/") + "/repositories/".length)
const repoRoot = repo + file.slice(repo.length).split("/")[0]
const r: any = await parseFile(file, repoRoot, { projectRoot: repoRoot } as any)
const idx = new Map<string, any[]>()
for (const s of (r?.symbols ?? []) as any[]) {
  const k = String(s?.name ?? "")
  if (!idx.has(k)) idx.set(k, [])
  idx.get(k)!.push(s)
  const q = String(s?.qualifiedName ?? "")
  if (q && q !== k) {
    if (!idx.has(q)) idx.set(q, [])
    idx.get(q)!.push(s)
  }
}
console.log(`file: ${file}`)
console.log(`symbols: ${(r?.symbols ?? []).length}  relationships: ${(r?.relationships ?? []).length}`)
for (const n of names) {
  const hit = idx.get(n) ?? []
  console.log(`  ${n.padEnd(20)} published ${hit.length}  ${hit.length ? JSON.stringify(hit.slice(0, 3).map((s) => ({ kind: s.kind, line: s.range?.startLine, q: s.qualifiedName }))) : "NOT PUBLISHED BY THIS FILE"}`)
}
// every T* type alias this file declares, so the reader can see the shape
const aliases = ((r?.symbols ?? []) as any[]).filter((s) => /^[TP][A-Z]/.test(String(s?.name ?? ""))).map((s) => String(s.name))
console.log(`  T*/P* symbols declared here (${aliases.length}): ${aliases.slice(0, 25).join(", ")}`)
