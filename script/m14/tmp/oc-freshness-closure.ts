// Why is objective-c's M12 freshness hostage to a foreign lane?
//
// `verify-differential-freshness.ts` fingerprints, for every language, the
// transitive RELATIVE-IMPORT CLOSURE of that language's analyzer file. The
// checker just reported objective-c STALE with exactly ONE changed input —
// `src/ast/real-cpp-analyzer.ts` — which the objc lane never touched. This
// prints the closure and the import edge that reaches a foreign analyzer, so
// the #840 finding names a line instead of a hunch.
//
// Run: bun script/m14/tmp/oc-freshness-closure.ts
import { readFileSync } from "node:fs"
import { importClosure } from "../../m12/differential-provenance"

const ROOT = process.cwd()
const ENTRY = `${ROOT}/src/ast/real-objective-c-analyzer.ts`

const closure = importClosure(ROOT, ENTRY)
console.log(`closure of real-objective-c-analyzer.ts: ${closure.length} file(s)`)
const analyzers = closure.filter((f) => /\/real-.*-analyzer\.ts$/.test(f))
console.log(`of those, ${analyzers.length} are OTHER languages' analyzers:`)
for (const a of analyzers) console.log(`  ${a.replace(ROOT + "/", "")}`)

// For each closure member, list the relative imports that make it an edge.
console.log("\nedges into foreign analyzers:")
for (const f of closure) {
  const src = readFileSync(f, "utf8")
  const specs = [...src.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g)].map((m) => m[1])
  for (const spec of specs) {
    if (/analyzer-?|real-/.test(spec)) {
      console.log(`  ${f.replace(ROOT + "/", "")}  ->  ${spec}`)
    }
  }
}

// The hub hypothesis: if pool-worker (which dispatches to every analyzer) is in
// the closure, every language's artifact fingerprints every analyzer.
console.log("\nhub candidates reached:", closure.some((f) => f.endsWith("pool-worker.ts")) ? "pool-worker.ts YES" : "pool-worker.ts no")
