#!/usr/bin/env bun
/**
 * CLEAN lane — THE STANDARD ENVIRONMENT'S OWN INVENTORY, read off the corpus's stdlib repos.
 *
 * The round's precedent for a closed, language-defined name set is the `c` lane's ISO C §7 list
 * (`validation/m14/verification/C-FIX.md` §5): a name set the LANGUAGE defines, embedded as a
 * constant with its derivation stated, so that marking a target as external is a checkable
 * statement rather than a guess.
 *
 * Clean's equivalent is its standard environment (StdEnv and the modules it re-exports), and the
 * corpus CARRIES it: `clean-stdlib` (74 files) and `Prelude` (42 files) are the language's own
 * library sources, while `Clyde`, `eastwood` and `cloogle.org` are ordinary applications. So the
 * list is DERIVED, not authored: every name below is declared by the standard library's own files.
 *
 * This probe prints that inventory and intersects it with the unresolved bare-name targets the
 * gate measured, so the size of the fix is known BEFORE it is written.
 *
 * Usage: bun validation/m14/fixtures/clean/stdlib-inventory.mts [--json <out>]
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { parseFile } from "../../../../src/ast/pool-worker"

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const CORPUS = arg("corpus") ?? process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const STDLIB_REPOS = (arg("repos") ?? "clean-stdlib,Prelude").split(",")
const HIST = arg("hist") ?? "validation/m14/fixtures/clean/residual-buckets2-BEFORE.json"
const JSON_OUT = arg("json")

type FileRec = { abs: string; repo: string; rel: string }
const files: FileRec[] = []
for (const entry of fs.readdirSync(CORPUS)) {
  const repoRoot = path.join(CORPUS, entry)
  try { if (!fs.statSync(repoRoot).isDirectory()) continue } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", repoRoot, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!/\.(icl|dcl)$/.test(rel)) continue
    const abs = path.join(repoRoot, rel)
    try { if (fs.statSync(abs).size > 1024 * 1024) continue } catch { continue }
    files.push({ abs, repo: repoRoot, rel })
  }
}

const names = new Map<string, Set<string>>()   // name -> kinds
const modules = new Set<string>()
for (const f of files) {
  if (!STDLIB_REPOS.includes(path.basename(f.repo))) continue
  let r: any
  try { r = await parseFile(f.abs, f.repo, { projectRoot: f.repo } as any) } catch { continue }
  if (!r) continue
  for (const s of r.symbols ?? []) {
    const name = String(s?.name ?? ""); if (!name) continue
    const kind = String(s?.kind ?? "")
    let ks = names.get(name); if (!ks) names.set(name, (ks = new Set()))
    ks.add(kind)
    if (kind === "module") modules.add(name)
  }
}

// THE TYPE SURFACE ONLY: a `references` edge in a typed position names a TYPE, CLASS, INTERFACE or
// MODULE. Function/method/property/constructor names of the stdlib are NOT what such an edge names,
// so the embedded list is filtered to those four kinds and the filter is measured here.
const TYPE_KINDS = new Set(["module", "type", "class", "interface"])
const typeNames = [...names.entries()].filter(([, ks]) => [...ks].some((k) => TYPE_KINDS.has(k))).map(([n]) => n).sort()

const hist: Record<string, number> = JSON.parse(fs.readFileSync(HIST, "utf8")).bareUnresolved ?? {}
const inList = Object.entries(hist).filter(([n]) => names.has(n))
const notInList = Object.entries(hist).filter(([n]) => !names.has(n)).sort((a, b) => b[1] - a[1])

console.log(`CLEAN standard-environment inventory — repos [${STDLIB_REPOS.join(", ")}], ${files.filter((f) => STDLIB_REPOS.includes(path.basename(f.repo))).length} files`)
console.log(`published names: ${names.size}  (modules: ${modules.size})`)
console.log(`unresolved bare-name targets covered by the inventory: ${inList.reduce((a, [, v]) => a + v, 0)} edges of ${Object.values(hist).reduce((a, b) => a + b, 0)} (${inList.length} of ${Object.keys(hist).length} distinct names)`)
console.log()
console.log("COVERED (name, edges, kinds):")
for (const [n, v] of inList.sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${n.padEnd(24)} ${[...(names.get(n) ?? [])].sort().join("|")}`)
console.log()
console.log("NOT COVERED — the project-internal and unvendored remainder:")
for (const [n, v] of notInList) console.log(`  ${String(v).padStart(5)}  ${n}`)
console.log()
console.log(`THE LIST AS A TS CONSTANT (${names.size} entries):`)
console.log([...names.keys()].sort().join("\n"))

console.log()
console.log(`TYPE SURFACE (module|type|class|interface only): ${typeNames.length} names`)
console.log(`unresolved bare-name edges it covers: ${Object.entries(hist).filter(([n]) => typeNames.includes(n)).reduce((a, [, v]) => a + v, 0)}`)
console.log("TYPESURFACE_TS_CONSTANT_BEGIN")
for (let i = 0; i < typeNames.length; i += 8) console.log("  " + typeNames.slice(i, i + 8).map((n) => JSON.stringify(n)).join(", ") + ",")
console.log("TYPESURFACE_TS_CONSTANT_END")
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ covered: Object.fromEntries(inList), notCovered: Object.fromEntries(notInList), names: [...names.keys()].sort() }, null, 2))
