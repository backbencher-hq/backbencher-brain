// Are `field_identifier` and `struct_literal` real node types in the PINNED
// grammar, and if not, are the analyzer's comparisons against them DEAD BRANCHES?
//
// An unregistered type literal in a comparison is one of two very different
// things, and the difference is whether the branch can ever fire:
//   - the type exists and the audit's registry is stale  -> fix the registry
//   - the type does not exist                          -> the branch is DEAD, and
//     it is dead code that reads like coverage
import { init, parser } from "./zigw-harness"

await init()
const p: any = parser()

const PROBES: Array<[string, string]> = [
  ["struct literal, explicit type", 'const x = Foo{ .a = 1, .b = 2 };'],
  ["struct literal, inferred", 'const y = .{ .a = 1 };'],
  ["struct literal, empty", 'const z = Foo{};'],
  ["field access", 'fn f(s: S) u32 { return s.a; }'],
  ["field decl in struct", 'const S = struct { alpha: u32 };'],
  ["enum member", 'const E = enum { one, two };'],
  ["anon struct literal in fn", 'fn g() void { const w = .{ .k = 1 }; _ = w; }'],
]

const seen = new Set<string>()
const typesOf = (n: any, out: string[] = []): string[] => {
  out.push(n.type)
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) typesOf(c, out)
  }
  return out
}

for (const [label, src] of PROBES) {
  const tree = p.parse(src)
  const types = typesOf(tree.rootNode)
  for (const t of types) seen.add(t)
  const structish = [...new Set(types)].filter((t) => /struct|literal|field/.test(t))
  console.log(`  ${label.padEnd(30)} ${structish.join(", ") || "(none)"}`)
  tree.delete()
}

console.log(`\n  does 'field_identifier' ever appear? ${[...seen].includes("field_identifier")}`)
console.log(`  does 'struct_literal' ever appear?     ${[...seen].includes("struct_literal")}`)
console.log(`  the struct-literal-ish types seen:     ${[...seen].filter((t) => /struct|literal/.test(t)).join(", ") || "(none)"}`)
