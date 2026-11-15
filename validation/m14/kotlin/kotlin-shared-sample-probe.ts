// Reproduce the SHARED harness's file selection exactly, and report what the
// sample is made of. The master measured "73 calls over 120 files" with
// script/m14/firing-check.mjs; this asks WHY that sample answered 73 when a
// stratified sample of the same pool answers 5765 over 150.
//
// NO REGEX. Directory skip in the shared harness is `/node_modules|\.git|testdata|fixtures/`.
// Reproduced with indexOf so this probe is measuring the same selection, not a
// regex-compatible paraphrase of it.
import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const dir = join(CORPUS, "kotlin")
const exts = [".kt", ".kts"]
const want = Number(process.env.NFILES || 120)
const cap = 400

function sharedSkips(name: string): boolean {
  // node_modules | .git | testdata | fixtures
  return name.indexOf("node_modules") !== -1 || name.indexOf(".git") !== -1 ||
    name.indexOf("testdata") !== -1 || name.indexOf("fixtures") !== -1
}

const out: string[] = []
const walk = (d: string, depth: number) => {
  if (out.length >= want || depth > 7) return
  let ents: any[]
  try { ents = readdirSync(d, { withFileTypes: true }) as any } catch { return }
  for (const e of ents) {
    if (out.length >= want) return
    const p = join(d, e.name)
    if (e.isDirectory()) { if (!sharedSkips(e.name)) walk(p, depth + 1) }
    else if (exts.some((x) => e.name.endsWith(x))) {
      try { if (statSync(p).size < 400000) out.push(p) } catch { /* ignore */ }
    }
  }
}
walk(dir, 0)
const files = out.slice(0, cap)

let scripts = 0, real = 0
let bytes = 0
const perModule: Record<string, number> = {}
const perModuleBytes: Record<string, number> = {}
for (const f of files) {
  let sz = 0
  try { sz = statSync(f).size } catch { /* ignore */ }
  bytes += sz
  const rel = f.slice(dir.length + 1)
  if (rel.endsWith(".kts")) scripts++; else real++
  const slash = rel.indexOf("/")
  const m = slash === -1 ? "." : rel.slice(0, slash)
  perModule[m] = (perModule[m] || 0) + 1
  perModuleBytes[m] = (perModuleBytes[m] || 0) + sz
}
console.log(`shared-harness sample: ${files.length} files, ${real} .kt, ${scripts} .kts (gradle scripts)`)
console.log(`total bytes ${bytes}, mean ${Math.round(bytes / Math.max(1, files.length))} bytes/file`)
console.log(`modules touched ${Object.keys(perModule).length}`)
const mods = Object.keys(perModule).sort((a, b) => (perModule[b] || 0) - (perModule[a] || 0))
for (const m of mods) console.log(`  ${m.padEnd(28)} ${String(perModule[m]).padStart(3)} files  ${perModuleBytes[m]} bytes`)
console.log("\nfirst 25 paths:")
for (const f of files.slice(0, 25)) console.log("  " + f.slice(dir.length + 1))

// how big is a typical .kt in the whole pool, for comparison
const sizes: number[] = []
const stack = [dir]
let seen = 0
while (stack.length && seen < 4000) {
  const d = stack.pop() as string
  let ents: any[]
  try { ents = readdirSync(d, { withFileTypes: true }) as any } catch { continue }
  for (const e of ents) {
    if (e.isDirectory()) { if (!sharedSkips(e.name)) stack.push(join(d, e.name)) }
    else if (e.name.endsWith(".kt")) { try { sizes.push(statSync(join(d, e.name)).size); seen++ } catch { /* ignore */ } }
  }
}
sizes.sort((a, b) => a - b)
if (sizes.length) {
  console.log(`\npool .kt median ${sizes[Math.floor(sizes.length / 2)]} bytes, mean ${Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length)}, n=${sizes.length}`)
  console.log(`shared-harness sample mean ${Math.round(bytes / Math.max(1, files.length))} bytes`)
}