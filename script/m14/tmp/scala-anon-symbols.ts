// Does the analyzer emit the anonymous class body's own members (cancel/join)
// as symbols, or only the anonymous container? Determines which layer owns the
// invisibility of `calls anonymous_Fiber -> liftF @148`.
import * as fs from "fs"
import * as path from "path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const FILE =
  "<corpus-root>/bb_tests/repositories/cats-effect/kernel-testkit/shared/src/main/scala/cats/effect/kernel/testkit/TimeT.scala"
const text = fs.readFileSync(FILE, "utf8")
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const res: any = await ASTEngine.parseFile(FILE, text)
const syms: any[] = res.symbols ?? []
console.log(`analyzer symbols: ${syms.length}`)
for (const s of syms
  .slice()
  .sort((a, b) => (a.range?.startLine ?? 0) - (b.range?.startLine ?? 0)))
  console.log(
    `   L${String(s.range?.startLine).padStart(3)}-${String(s.range?.endLine).padEnd(3)} ${String(s.kind).padEnd(12)} ${String(s.name).padEnd(22)} owner=${s.ownerName ?? "-"}`,
  )
console.log("\n--- anonymous-related symbols ---")
for (const s of syms.filter((s) => String(s.name).includes("anonymous") || String(s.ownerName ?? "").includes("anonymous")))
  console.log("   ", JSON.stringify({ name: s.name, kind: s.kind, line: s.range?.startLine, owner: s.ownerName, meta: s.metadata }).slice(0, 220))
console.log("\n--- the raw post-order (grep for anonymous) ---")
const raw = JSON.stringify(res)
let idx = raw.indexOf("anonymous_Fiber")
let n = 0
while (idx >= 0 && n < 3) {
  console.log("   ..." + raw.slice(Math.max(0, idx - 220), idx + 120) + "...")
  idx = raw.indexOf("anonymous_Fiber", idx + 1)
  n++
}
