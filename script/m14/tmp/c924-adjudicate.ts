// #924 row 2 adjudication: are the whitespace-bearing cpp symbol names the
// DELIBERATE #919 macro-heading contract (metadata.expandedFrom === "macro-heading")
// or genuine name-extraction defects? Classify by metadata, then dump the
// non-macro-heading ones with their node text so they can be judged on evidence.
import { readFileSync } from "node:fs"
import { execSync } from "node:child_process"
import { parseFile } from "../../../src/ast/engine"

const ROOTS: Array<[string, string, string[]]> = [
  ["fmt:cpp", "<corpus-root>/bb_tests/repositories/fmt", ["*.h", "*.cc", "*.cpp"]],
  ["nlohmann-json:cpp", "<corpus-root>/bb_tests/repositories/nlohmann-json", ["*.hpp", "*.cpp", "*.h"]],
]

function files(root: string, exts: string[]): string[] {
  const names = exts.map((e) => `-name '${e}'`).join(" -o ")
  const out = execSync(`find ${root} -type f \\( ${names} \\) -not -path '*/build/*' -not -path '*/.git/*'`, {
    encoding: "utf8",
    maxBuffer: 1 << 28,
  })
  return out.split("\n").filter(Boolean).sort()
}

let macroHeading = 0
let other = 0
const otherRows: Array<{ name: string; kind: string; file: string; line: number; meta: any }> = []

for (const [label, root, exts] of ROOTS) {
  for (const f of files(root, exts)) {
    let r: any
    try {
      r = await parseFile(f, readFileSync(f, "utf8"))
    } catch {
      continue
    }
    for (const s of r.symbols ?? []) {
      const n = String(s.name ?? "")
      if (!/\s/.test(n)) continue
      if (s.metadata?.expandedFrom === "macro-heading") macroHeading++
      else {
        other++
        otherRows.push({
          name: n,
          kind: String(s.kind),
          file: f.replace("<corpus-root>/bb_tests/repositories/", ""),
          line: s.range?.startLine ?? 0,
          meta: s.metadata ?? null,
        })
      }
    }
  }
}

console.log(`whitespace SYMBOL names: macro-heading (deliberate #919)=${macroHeading}  other=${other}`)
console.log(`\n== the ${otherRows.length} NON-macro-heading whitespace names ==`)
for (const r of otherRows) {
  console.log(`  ${r.file}:${r.line} [${r.kind}] ${JSON.stringify(r.name)}`)
  console.log(`      meta=${JSON.stringify(r.meta)}`)
}
