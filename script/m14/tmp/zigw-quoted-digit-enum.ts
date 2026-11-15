// Z43: `contains` says 0/0 and the ownership verifier says 701 PHANTOM_OWN on
// the same edges. Two committed gates disagree about the same relationships, so
// one of them is wrong and the honest move is to find out which before either
// number goes in a document.
//
// The shape: `@"1Monochrome" = ...` inside `pub const PixelFormat = enum(...)`.
// A QUOTED enum field name whose text begins with a digit -- legal Zig, and used
// in ghostty's macOS pixel-format bindings because the C names begin with digits.
//
// The analyzer publishes `contains PixelFormat -> 1Monochrome (enum_member)`,
// with `PixelFormat` as the owner. The ownership verifier says the TREE derives no
// such owner. The contains gate says the two agree. So: does the truth derive
// that edge, and if it does, what owner does it attach?
import * as fs from "fs"
import { init, parser, analyzer } from "./zigw-harness"
import { deriveZigContainment } from "../zig-truth"

const f = process.argv[2] ?? "/home/sano/ishaq/bb_tests/repositories/ghostty/pkg/macos/video/pixel_format.zig"
const src = fs.readFileSync(f, "utf8")

await init()
const tree = parser().parse(src)
const res = analyzer().analyze(tree.rootNode, src, f) as any
const truth = deriveZigContainment(tree.rootNode, res.symbols ?? [])

const pubd = (res.relationships ?? []).filter((r: any) => r.type === "contains")
const derived = truth.filter((t: any) => t.label === "contains")
const digit = (n: string) => /^\d/.test(n)

console.log(`file: ${f.split("/").slice(-2).join("/")}`)
console.log(`published contains: ${pubd.length}   derived contains: ${derived.length}\n`)

console.log("PUBLISHED rows whose target starts with a digit:")
for (const r of pubd.filter((r: any) => digit(String(r.target)))) {
  console.log(`  ${r.source} -> ${r.target}  (${r.metadata?.relationshipType ?? "?"})`)
}
console.log("\nDERIVED rows whose target starts with a digit:")
const d = derived.filter((t: any) => digit(String(t.target)))
if (d.length === 0) console.log("  (none -- the truth derives NO owner for a digit-named member)")
for (const t of d) console.log(`  ${t.from} -> ${t.target}  L${t.line}`)

const pubKeys = new Set(pubd.map((r: any) => `${r.source}->${r.target}`))
const derKeys = new Set(derived.map((t: any) => `${t.from}->${t.target}`))
const onlyPub = [...pubKeys].filter(k => !derKeys.has(k))
const onlyDer = [...derKeys].filter(k => !pubKeys.has(k))
console.log(`\nonly PUBLISHED (${onlyPub.length}): ${onlyPub.slice(0, 6).join(", ")}`)
console.log(`only DERIVED   (${onlyDer.length}): ${onlyDer.slice(0, 6).join(", ")}`)

// And the symbol side, which is what the ownership verifier reads.
const members = (res.symbols ?? []).filter((s: any) => digit(String(s.name ?? "")))
console.log(`\nsymbols with a digit-leading name: ${members.length}`)
for (const s of members.slice(0, 4)) {
  console.log(`  name=${JSON.stringify(s.name)} kind=${s.kind} scope=${s.scope} ownerName=${JSON.stringify(s.ownerName ?? null)} owner=${JSON.stringify(s.owner ?? null)}`)
}
const pf = (res.symbols ?? []).filter((s: any) => s.name === "PixelFormat")
console.log(`PixelFormat symbols: ${pf.length}`)
for (const s of pf) console.log(`  kind=${s.kind} scope=${s.scope} ownerName=${JSON.stringify(s.ownerName ?? null)}`)
tree.delete()
