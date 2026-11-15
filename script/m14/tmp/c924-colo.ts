// #924 row 2: the OTHER half of the same shape — published names that contain a
// real `::`. A universal symbol's NAME should be the bare name; the owner is the
// scope. How many cpp symbols publish a qualified name, and are they the same
// glued shape or the nested-scope shape?
import { readFileSync } from "node:fs"
import { execSync } from "node:child_process"
import { parseFile } from "../../../src/ast/engine"

const ROOTS: Array<[string, string, string[]]> = [
  ["fmt:cpp", "/home/ishaq2321/bb_tests/repositories/fmt", ["*.h", "*.cc", "*.cpp"]],
  ["nlohmann-json:cpp", "/home/ishaq2321/bb_tests/repositories/nlohmann-json", ["*.hpp", "*.cpp", "*.h"]],
]

function files(root: string, exts: string[]): string[] {
  const names = exts.map((e) => `-name '${e}'`).join(" -o ")
  return execSync(`find ${root} -type f \\( ${names} \\) -not -path '*/build/*' -not -path '*/.git/*'`, {
    encoding: "utf8",
    maxBuffer: 1 << 28,
  })
    .split("\n")
    .filter(Boolean)
    .sort()
}

let total = 0
let qualified = 0
let macroHeading = 0
const rows: Array<{ name: string; file: string; line: number; kind: string; macro: boolean }> = []

for (const [, root, exts] of ROOTS) {
  for (const f of files(root, exts)) {
    let r: any
    try {
      r = await parseFile(f, readFileSync(f, "utf8"))
    } catch {
      continue
    }
    for (const s of r.symbols ?? []) {
      total++
      const n = String(s.name ?? "")
      if (!n.includes("::")) continue
      qualified++
      const macro = s.metadata?.expandedFrom === "macro-heading"
      if (macro) macroHeading++
      rows.push({ name: n, file: f.replace("/home/ishaq2321/bb_tests/repositories/", ""), line: s.range?.startLine ?? 0, kind: String(s.kind), macro })
    }
  }
}

console.log(`symbols=${total} names containing "::"=${qualified}  (of which macro-heading=${macroHeading})`)
for (const r of rows) console.log(`  ${r.file}:${r.line} [${r.kind}]${r.macro ? " MACRO" : ""} ${JSON.stringify(r.name)}`)
