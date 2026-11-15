/**
 * THE TEN EDGES THE QUALIFIED-TARGET RULE CAUSES TO RESOLVE — file, line, target, and the
 * spelling the template wrote. Sampled from the mandated 400-file stride population, one edge
 * per SOURCE FILE so the sample cannot be ten rows of one component.
 *
 * CLI: bun run validation/m14/fixtures/vue/qualified-sample.mts [--max 400] [--n 10]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "path"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argOf = (f: string, d: string) => { const i = process.argv.indexOf(f); return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : d }
const MAX = Number(argOf("--max", "400")); const N = Number(argOf("--n", "10"))
const found: string[] = []
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const r of tracked) {
    if (!r.toLowerCase().endsWith(".vue")) continue
    const abs = path.join(dir, r)
    try { if (statSync(abs).size > 1024 * 1024) continue } catch { continue }
    found.push(abs)
  }
}
found.sort()
let files = found
if (MAX > 0 && found.length > MAX) { const s = Math.max(1, Math.floor(found.length / MAX)); const p: string[] = []; for (let i = 0; i < found.length && p.length < MAX; i += s) p.push(found[i]); files = p }
const repoOf = (f: string) => path.join(CR, path.relative(CR, f).split(path.sep)[0])
const seenFile = new Set<string>()
let shown = 0
for (const f of files) {
  if (shown >= N) break
  let r: any
  try { r = await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any) } catch { continue }
  if (!r) continue
  const quals = new Map<string, string[]>()
  for (const s of r.symbols ?? []) {
    const nm = String(s?.name ?? ""); if (!nm) continue
    const q = String(s?.qualifiedName || s?.metadata?.fqn || (s?.scope ? `${s.scope}.${nm}` : nm))
    const list = quals.get(nm) ?? []; list.push(q); quals.set(nm, list)
  }
  for (const rel of r.relationships ?? []) {
    if (String(rel?.type ?? "") !== "uses") continue
    const md: any = rel?.metadata ?? {}
    if (md.isTemplateExpression !== true || !md.memberAsWritten) continue
    if (seenFile.has(f)) continue
    seenFile.add(f); shown++
    const line = md.line ?? rel?.line_number
    const decl = (r.symbols ?? []).find((s: any) => s.name === md.memberAsWritten)
    console.log(`${shown}. ${path.relative(CR, f)}:${line}`)
    console.log(`     emitted target : ${rel.target}   (template wrote: ${md.memberAsWritten})`)
    console.log(`     the declaration the code means: ${decl ? `${decl.kind} ${decl.name} @ line ${decl.range?.startLine} qualifiedName=${decl.qualifiedName ?? "(none)"} scope=${decl.scope ?? "(none)"}` : "*** NO DECLARATION IN THIS FILE ***"}`)
    break
  }
}
console.log(`\nsampled ${shown} of a requested ${N}; population ${files.length} .vue files (cap ${MAX})`)
