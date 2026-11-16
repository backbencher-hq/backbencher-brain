// script/m14/tmp/sw-published-vs-analyzer.ts
//
// QUESTION: R8's runtime probe runs each ANALYZER directly
// (`new RealXLaneAnalyzer().analyze(root, src, file)`), so it measures what the
// analyzers emit. The product publishes a DIFFERENT object: `ASTEngine.parseFile`
// post-processes the result through `enhanceWithFrameworkIntelligence`, which
// merges a second detector's detections, re-promotes `framework`, and appends its
// own pattern objects to `frameworkPatterns`.
//
// So "does this code publish a framework capability it does not have" has two
// answers and only one has ever been measured. This measures the published one, on
// the same assertion set (`checkMetadata`) the probe uses.
//
// Run: bun script/m14/tmp/sw-published-vs-analyzer.ts
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"
import { checkMetadata } from "../../m60/framework-surface-probe"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const REPOS = "<corpus-root>/bb_tests/repositories"

const LANES: { lang: string; repos: string[]; ext: string[]; fixture: string }[] = [
  { lang: "swift", repos: ["alamofire", "swift-nio"], ext: [".swift"], fixture: "validation/m14/fixtures/swift/framework-surface-pins.swift" },
  { lang: "ruby", repos: ["rake", "rack"], ext: [".rb"], fixture: "validation/m14/fixtures/ruby/framework-surface-pins.rb" },
  { lang: "python", repos: ["cython", "requests"], ext: [".py"], fixture: "validation/m14/fixtures/python/framework-surface-pins.py" },
  { lang: "php", repos: ["phpmyadmin", "slim", "phpunit"], ext: [".php"], fixture: null as any },
  { lang: "csharp", repos: ["powershell"], ext: [".cs"], fixture: null as any },
  { lang: "dart", repos: ["dart-http"], ext: [".dart"], fixture: null as any },
  { lang: "objective-c", repos: ["sdwebimage", "afnetworking"], ext: [".m"], fixture: null as any },
].filter((l) => l.fixture)

function filesIn(repos: string[], ext: string[], cap: number): string[] {
  const out: string[] = []
  for (const r of repos) {
    const root = path.join(REPOS, r)
    if (!fs.existsSync(root)) continue
    const stack = [root]
    const hits: string[] = []
    while (stack.length) {
      const d = stack.pop()!
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === ".git" || e.name === "node_modules") continue
        const p = path.join(d, e.name)
        if (e.isDirectory()) stack.push(p)
        else if (ext.some((x) => e.name.endsWith(x))) hits.push(p)
      }
    }
    hits.sort()
    for (const h of hits.slice(0, cap)) out.push(h)
  }
  return out
}

for (const lane of LANES) {
  const files = [path.join(ROOT, lane.fixture), ...filesIn(lane.repos, lane.ext, 60)]
  const publishedFind: Record<string, number> = {}
  const examples: string[] = []
  let checked = 0
  for (const f of files) {
    let src: string
    try { src = fs.readFileSync(f, "utf8") } catch { continue }
    checked++
    const pub: any = await (ASTEngine as any).parseFile(f, src, { language: lane.lang })
    const md = pub?.metadata ?? {}
    for (const fnd of checkMetadata(md)) {
      publishedFind[fnd.id] = (publishedFind[fnd.id] ?? 0) + 1
      if (examples.length < 4) {
        examples.push(
          `${path.relative(REPOS, f)}\n      ${fnd.id}: ${fnd.detail}\n      detected=${JSON.stringify(md.detectedFrameworks)} primary=${JSON.stringify(md.framework)}\n      patterns=${JSON.stringify((md.frameworkPatterns ?? []).slice(0, 6))}`,
        )
      }
    }
  }
  console.log(`\n=== ${lane.lang} (${checked} files) ===`)
  console.log(`  PUBLISHED findings: ${JSON.stringify(publishedFind)}`)
  for (const e of examples) console.log("  · " + e)
}
