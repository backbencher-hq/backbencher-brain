// Before F14 extends its V2 predicate to rust, MEASURE whether the predicate
// would be dead or firing: does any rust `calls` target spell a primitive type
// keyword (which can never name a function)? And what does each name-bearing
// target label actually carry?
//
// Run: bun script/m14/tmp/rust-798-calls-keywords.ts [--sample N]
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"
import { filesFor } from "../../m60/target-spelling-census"
import { LANG_REPOS, SECOND_CORPUS } from "../differential"

const SAMPLE = Number(process.argv.includes("--sample") ? process.argv[process.argv.indexOf("--sample") + 1] : 667)
const SECOND = Math.max(1, Math.floor(SAMPLE * 0.6))
const PRIMITIVES = new Set([
  "bool", "char", "str", "i8", "i16", "i32", "i64", "i128", "isize",
  "u8", "u16", "u32", "u64", "u128", "usize", "f32", "f64",
])
const DELIMITERS = ";(){},"
const SKIP_TARGET_LABELS = new Set(["imports", "exports"])

const files = [
  ...filesFor("rust", LANG_REPOS.rust!, SAMPLE),
  ...filesFor("rust", SECOND_CORPUS.rust!, SECOND),
]
const byLabel = new Map<string, number>()
const whitespace: string[] = []
const delimiters: string[] = []
const keywords: string[] = []
const nonName: string[] = []
let targets = 0
let calls = 0

for (const f of files) {
  const src = fs.readFileSync(f, "utf8")
  if (src.length > 400_000) continue
  let res: any
  try {
    res = await ASTEngine.parseFile(f, src)
  } catch {
    continue
  }
  const rel = path.relative("/home/ishaq2321/bb_tests/repositories", f)
  for (const r of res?.relationships ?? []) {
    const label = String(r?.type ?? "?")
    if (r?.target === undefined || r?.target === null) continue
    const target = String(r.target)
    byLabel.set(label, (byLabel.get(label) ?? 0) + 1)
    targets++
    if (label === "calls") {
      calls++
      if (PRIMITIVES.has(target)) keywords.push(`calls -> ${JSON.stringify(target)} @ ${rel}`)
    }
    if (SKIP_TARGET_LABELS.has(label)) continue
    if (/\s/.test(target)) whitespace.push(`${label} -> ${JSON.stringify(target)} @ ${rel}`)
    const dl = [...target].filter((c) => DELIMITERS.includes(c))
    if (dl.length) delimiters.push(`${label} -> ${JSON.stringify(target)} chars=${JSON.stringify(dl)} @ ${rel}`)
    if (!/^[A-Za-z_][A-Za-z0-9_]*(::[A-Za-z_][A-Za-z0-9_]*)*$/.test(target)) {
      nonName.push(`${label} -> ${JSON.stringify(target)} @ ${rel}`)
    }
  }
}

const show = (name: string, arr: string[]) => {
  console.log(`\n${name}: ${arr.length}`)
  for (const s of [...new Set(arr)].slice(0, 25)) console.log("  " + s)
}
console.log(JSON.stringify({ files: files.length, targets, calls, byLabel: Object.fromEntries([...byLabel].sort()) }, null, 1))
show("whitespace targets", whitespace)
show("delimiter targets", delimiters)
show("primitive-keyword CALL targets", keywords)
show("targets that are not a rust name path + label", nonName)
