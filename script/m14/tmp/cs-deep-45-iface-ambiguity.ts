// Is c1/c2/c3 in the corpus interface set, and is each name ALSO declared as a class?
import * as fs from "fs"
const files = fs.readFileSync("/home/sano/ishaq/bb_tests/lists/roslyn-src.txt","utf8").split("\n").map(f=>f.trim()).filter(Boolean).slice(0,120)
const ifaces = new Set<string>(), classes = new Set<string>()
const declOf = new Map<string, Set<string>>()
for (const f of files) {
  let s: string
  try { s = fs.readFileSync(f, "utf8") } catch { continue }
  for (const m of s.matchAll(/\binterface\s+([A-Za-z_][A-Za-z0-9_]*)/g)) ifaces.add(m[1])
  for (const m of s.matchAll(/\b(?:class|struct|record)\s+([A-Za-z_][A-Za-z0-9_]*)/g)) classes.add(m[1])
  for (const m of s.matchAll(/\b(interface|class|struct|record)\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
    const st = declOf.get(m[2]) ?? new Set<string>(); st.add(m[1]); declOf.set(m[2], st)
  }
}
console.log(`  corpus interface names: ${ifaces.size}   corpus class/struct/record names: ${classes.size}`)
for (const n of ["c1","c2","c3","c4","c5"]) {
  const kinds = [...(declOf.get(n) ?? [])]
  console.log(`  ${n.padEnd(3)} inInterfaceSet=${String(ifaces.has(n)).padEnd(5)} alsoDeclaredAs=${kinds.join(",") || "(none)"}  AMBIGUOUS=${kinds.length > 1}`)
}
const ambiguous = [...ifaces].filter(n => (declOf.get(n)?.size ?? 0) > 1)
console.log(`\n  names in the interface set that are ALSO declared as something else: ${ambiguous.length} of ${ifaces.size}`)
console.log(`  e.g. ${ambiguous.slice(0, 12).join(", ")}`)
