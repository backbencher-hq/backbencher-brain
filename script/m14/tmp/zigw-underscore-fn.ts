// Z46: `pub fn _()` is a real, callable declaration -- the gettext convention --
// while `const _ = ...` is a DISCARD. The lane differential found the truth
// deriving `exports (file) -> _` at ghostty/src/os/i18n.zig:69 with no published
// edge to match it, and `_` is the ONE name the analyzer refuses to treat as a
// name anywhere (Z8/GO5, correctly, for bindings).
//
// So: does the analyzer mint a SYMBOL for the function, and does it then decline
// to publish the export? Or does the `_` refusal swallow the whole declaration,
// which would make ghostty's i18n entry point invisible -- no symbol, no export,
// and no incoming `calls`?
import * as fs from "fs"
import { init, parser, analyzer } from "./zigw-harness"
import { deriveZigExports, deriveZigContainment } from "../zig-truth"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"
const f = `${CORPUS}/ghostty/src/os/i18n.zig`
const src = fs.readFileSync(f, "utf8")

await init()
const tree = parser().parse(src)
const res = analyzer().analyze(tree.rootNode, src, f) as any

const underscoreSyms = (res.symbols ?? []).filter((s: any) => String(s.name) === "_")
console.log(`symbols named "_": ${underscoreSyms.length}`)
for (const s of underscoreSyms) console.log(`  kind=${s.kind} scope=${s.scope} line=${s.range?.startLine} vis=${s.visibility}`)

const underscoreRels = (res.relationships ?? []).filter((r: any) => String(r.target) === "_")
console.log(`relationships targeting "_": ${underscoreRels.length}`)
for (const r of underscoreRels) console.log(`  ${r.type} ${r.source} -> ${r.target} line ${r.line_number}`)

const callsToUnderscore = (res.relationships ?? []).filter((r: any) => r.type === "calls" && /(^|\W)_$/.test(String(r.target)))
console.log(`calls edges targeting "_": ${callsToUnderscore.length}`)

const tExports = deriveZigExports(tree.rootNode).filter((e: any) => e.target === "_")
console.log(`TRUTH exports -> "_": ${tExports.length}`)
for (const e of tExports) console.log(`  ${e.label} ${e.from} -> ${e.target} line ${e.line}`)

// and the sibling shape: how many CALLS does this file make to _(...)?
const callSites = (src.match(/\(\s*"/g) ?? []).length
console.log(`\nfor scale: the file has ${src.split("\n").length} lines and ${(src.match(/[^A-Za-z0-9_]_\(/g) ?? []).length} apparent _( calls`)
tree.delete()
