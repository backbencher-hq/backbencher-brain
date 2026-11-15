// Probe: for each dotted-unresolved edge target in the clean lane, where does the final
// segment come from — the source's own file, another file in the sample, or nothing?
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"

const corpus = "/home/ishaq2321/bb_tests/repositories"
const count = Number(process.argv[2] ?? 120)
const files = execFileSync("bash", ["-lc", `find ${corpus} -name '*.icl' -o -name '*.dcl' | sort | head -${count}`], { encoding: "utf8", maxBuffer: 1 << 28 })
  .trim().split("\n").filter(Boolean)

/** name -> set of files declaring it */
const byName = new Map<string, Set<string>>()
const edges: { t: string; type: string; file: string; line: number }[] = []
let parsed = 0, failed = 0
for (const f of files) {
  let r: any
  try { r = await ASTEngine.parseFile(f, readFileSync(f, "utf8")); parsed++ } catch { failed++; continue }
  for (const s of r?.symbols ?? []) {
    let set = byName.get(s.name)
    if (!set) byName.set(s.name, (set = new Set()))
    set.add(f)
  }
  for (const e of r?.relationships ?? []) {
    const t = String(e?.target ?? "")
    if (t) edges.push({ t, type: String(e?.type ?? ""), file: f, line: Number(e?.line_number ?? 0) })
  }
}
console.log(`files ${files.length} parsed ${parsed} failed ${failed}  edges ${edges.length}\n`)

const dottedUnres = edges.filter((e) => e.t.includes(".") && !byName.has(e.t))
const byType: Record<string, { n: number; ownFile: number; otherFile: number; nowhere: number }> = {}
const samples: Record<string, string[]> = {}
for (const e of dottedUnres) {
  const k = byType[e.type] ??= { n: 0, ownFile: 0, otherFile: 0, nowhere: 0 }
  k.n++
  const last = e.t.split(".").pop()!
  const decl = byName.get(last)
  if (!decl) k.nowhere++
  else if (decl.has(e.file)) k.ownFile++
  else k.otherFile++
  const arr = samples[e.type] ??= []
  if (arr.length < 12) arr.push(`${e.t}  [${e.file.replace(corpus + "/", "")}:${e.line}]  ownFile=${decl ? decl.has(e.file) : false} otherFiles=${decl ? decl.size : 0}`)
}
console.log(`DOTTED + UNRESOLVED: ${dottedUnres.length} edges, ${new Set(dottedUnres.map((e) => e.t)).size} distinct targets\n`)
for (const [t, k] of Object.entries(byType).sort((a, b) => b[1].n - a[1].n)) {
  console.log(`${t.padEnd(13)} n=${String(k.n).padStart(5)}  finalSegDeclaredInSourceFile=${String(k.ownFile).padStart(5)}  inAnotherFile=${String(k.otherFile).padStart(5)}  finalSegPublishedNowhere=${String(k.nowhere).padStart(5)}`)
  for (const s of samples[t] ?? []) console.log(`    ${s}`)
  console.log()
}
// Also: colon-shaped targets (Clean uses Module:Item in .dcl)
const colon = edges.filter((e) => e.t.includes(":") && !byName.has(e.t))
console.log(`\nCOLON-SHAPED unresolved: ${colon.length} edges, ${new Set(colon.map((e) => e.t)).size} distinct`)
const cType: Record<string, number> = {}
for (const e of colon) cType[e.type] = (cType[e.type] ?? 0) + 1
console.log(JSON.stringify(cType))
console.log(`examples: ${[...new Set(colon.map((e) => e.t))].slice(0, 20).join(" ")}`)

// What about dotted targets that ALREADY resolve? Are there any?
const dottedRes = edges.filter((e) => e.t.includes(".") && byName.has(e.t))
console.log(`\ndotted targets that DO resolve against the sample: ${dottedRes.length} edges, ${new Set(dottedRes.map((e) => e.t)).size} distinct`)
console.log(`examples: ${[...new Set(dottedRes.map((e) => e.t))].slice(0, 20).join(" ")}`)