// #924 cpp row, second class: after the include-name fix, which PUBLISHED names
// still carry whitespace — symbol names and relationship targets — and what are
// they? Runs the PRODUCTION entry (parseFile) over the pinned cpp corpora.
import { readFileSync } from "node:fs"
import { execSync } from "node:child_process"
import { parseFile } from "../../../src/ast/engine"

const SUITES: Array<[string, string, string[]]> = [
  ["fmt:cpp", "/home/ishaq2321/bb_tests/repositories/fmt", ["*.h", "*.cc", "*.cpp"]],
  ["nlohmann-json:cpp", "/home/ishaq2321/bb_tests/repositories/nlohmann-json", ["*.hpp", "*.cpp", "*.h"]],
]

function files(root: string, exts: string[]): string[] {
  const names = exts.map((e) => `-name '${e}'`).join(" -o ")
  const out = execSync(`find ${root} -type f \\( ${names} \\) -not -path '*/build/*' -not -path '*/.git/*'`, {
    encoding: "utf8",
    maxBuffer: 1 << 28,
  })
  return out.split("\n").filter(Boolean).sort()
}

let totalFiles = 0
let filesWithWhitespace = 0
const symbolNames = new Map<string, { files: Set<string>; kinds: Set<string> }>()
const edgeTargets = new Map<string, { files: Set<string>; types: Set<string> }>()
let edgesTotal = 0
let symbolsTotal = 0

for (const [label, root, exts] of SUITES) {
  const list = files(root, exts)
  process.stderr.write(`[${label}] ${list.length} files\n`)
  for (const f of list) {
    let r: any
    try {
      r = await parseFile(f, readFileSync(f, "utf8"))
    } catch (e) {
      console.log(`PARSEFAIL ${f}: ${(e as Error).message}`)
      continue
    }
    totalFiles++
    const syms: any[] = r.symbols ?? []
    const edges: any[] = r.relationships ?? []
    symbolsTotal += syms.length
    edgesTotal += edges.length
    let hit = false
    for (const s of syms) {
      const n = String(s.name ?? "")
      if (/\s/.test(n)) {
        hit = true
        const e = symbolNames.get(n) ?? { files: new Set(), kinds: new Set() }
        e.files.add(f)
        e.kinds.add(String(s.kind ?? "?"))
        symbolNames.set(n, e)
      }
    }
    for (const e0 of edges) {
      const t = String(e0.target ?? "")
      if (/\s/.test(t)) {
        hit = true
        const e = edgeTargets.get(t) ?? { files: new Set(), types: new Set() }
        e.files.add(f)
        e.types.add(String(e0.type ?? e0.metadata?.relationshipType ?? "?"))
        edgeTargets.set(t, e)
      }
    }
    if (hit) filesWithWhitespace++
  }
}

console.log(`\n== corpora: ${SUITES.map((s) => s[0]).join(", ")}`)
console.log(`files=${totalFiles} symbols=${symbolsTotal} edges=${edgesTotal}`)
console.log(`files with any whitespace name=${filesWithWhitespace}`)
console.log(`\n== whitespace SYMBOL names: ${symbolNames.size} distinct`)
const symRows = [...symbolNames.entries()].sort((a, b) => b[1].files.size - a[1].files.size)
for (const [n, e] of symRows) {
  console.log(`  ${e.files.size}x [${[...e.kinds].join(",")}] ${JSON.stringify(n)}`)
}
console.log(`\n== whitespace EDGE targets: ${edgeTargets.size} distinct`)
const edgeRows = [...edgeTargets.entries()].sort((a, b) => b[1].files.size - a[1].files.size)
for (const [t, e] of edgeRows) {
  console.log(`  ${e.files.size}x [${[...e.types].join(",")}] ${JSON.stringify(t.length > 90 ? t.slice(0, 90) + "…" : t)}`)
}
