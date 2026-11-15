// Diagnose the 1 pipeline mismatch: census walk vs parseFile on the same file.
import * as fs from "fs"
async function main() {
  const { ASTEngine } = await import("../../../src/ast/engine")
  const { parseFile } = await import("../../../src/ast/pool-worker")
  const F = "/home/ishaq2321/bb_tests/repositories/grails-core/etc/bin/generate-build-artifact-hashes.groovy"
  const src = fs.readFileSync(F, "utf8")
  const parser = await ASTEngine.getParser("groovy")
  const tree = parser.parse(src)
  const root = tree.rootNode
  console.log("engine root hasError:", (root as any).hasError)
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()
    if ((n as any).isMissing || n.type === "ERROR") {
      console.log(`  ${n.type}${(n as any).isMissing ? " (MISSING)" : ""} @L${n.startPosition.row + 1}: ${JSON.stringify((n.text || "").split("\n")[0].slice(0, 60))}`)
    }
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) stack.push(c) }
  }
  // production side
  const parsed = await parseFile(F, process.cwd())
  console.log("parseFile errors:", JSON.stringify((parsed as any).errors ?? []))
}
main()
