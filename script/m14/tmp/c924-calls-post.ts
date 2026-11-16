// #924 cpp row 3: the acceptance measurement. After the name-bearing-callee rule,
// what call targets still carry whitespace, and does any call target spell a
// builtin type (the functional-cast residue)? Runs the PRODUCTION entry.
import { readFileSync } from "node:fs"
import { execSync } from "node:child_process"
import { parseFile } from "../../../src/ast/engine"

const ROOTS: Array<[string, string, string[]]> = [
  ["fmt:cpp", "<corpus-root>/bb_tests/repositories/fmt", ["*.h", "*.cc", "*.cpp"]],
  ["nlohmann-json:cpp", "<corpus-root>/bb_tests/repositories/nlohmann-json", ["*.hpp", "*.cpp", "*.h"]],
]
function files(root: string, exts: string[]): string[] {
  const names = exts.map((e) => `-name '${e}'`).join(" -o ")
  return execSync(`find ${root} -type f \\( ${names} \\) -not -path '*/build/*' -not -path '*/.git/*'`, { encoding: "utf8", maxBuffer: 1 << 28 })
    .split("\n").filter(Boolean).sort()
}
const BUILTINS = new Set(["int", "char", "unsigned", "signed", "short", "long", "float", "double", "bool", "void", "size_t", "wchar_t", "char8_t", "char16_t", "char32_t", "uint8_t", "uint16_t", "uint32_t", "uint64_t", "int8_t", "int16_t", "int32_t", "int64_t", "uintptr_t", "intptr_t", "ptrdiff_t"])
let calls = 0
let ws = 0
let builtin = 0
const wsRows = new Map<string, number>()
const builtinRows = new Map<string, number>()
for (const [, root, exts] of ROOTS) {
  for (const f of files(root, exts)) {
    let r: any
    try { r = await parseFile(f, readFileSync(f, "utf8")) } catch { continue }
    for (const e of r.relationships ?? []) {
      if (String(e.type) !== "calls") continue
      calls++
      const t = String(e.target ?? "")
      if (/\s/.test(t)) { ws++; wsRows.set(t.length > 60 ? t.slice(0, 60) + "…" : t, (wsRows.get(t) ?? 0) + 1) }
      if (BUILTINS.has(t)) { builtin++; builtinRows.set(t, (builtinRows.get(t) ?? 0) + 1) }
    }
  }
}
console.log(`calls edges = ${calls}`)
console.log(`calls targets with whitespace = ${ws}`)
for (const [k, v] of [...wsRows.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${v}x ${JSON.stringify(k)}`)
console.log(`calls targets spelling a builtin type = ${builtin}`)
for (const [k, v] of [...builtinRows.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${v}x ${JSON.stringify(k)}`)
