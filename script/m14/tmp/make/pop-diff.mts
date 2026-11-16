// Enumerate the difference between the census walk (router predicate) and the
// gate's admission (exts=[mk,mak,makefile] by extension, or lowercased basename
// equal to one of them + router verdict), over the same git-tracked corpus.
import { readdirSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join } from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? "<corpus-root>/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const { detectLanguageFromPath } = await import(`<corpus-root>/mcp/backbencher-brain/src/ast/language-detection.ts`)

const trackedAll: string[] = []
for (const name of readdirSync(CR).sort()) {
  const dir = join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  trackedAll.push(...tracked.map((rel) => `${name}/${rel}`))
}

const routerAdmits = (rel: string) => detectLanguageFromPath(rel) === "make"
const gateAdmits = (rel: string) => {
  const low = rel.toLowerCase()
  const base = low.slice(low.lastIndexOf("/") + 1)
  const exts = ["mk", "mak", "makefile"]
  if (exts.some((e) => low.endsWith(`.${e}`))) return true
  return exts.some((e) => base === e) && routerAdmits(rel)
}

const census = trackedAll.filter(routerAdmits)
const gate = trackedAll.filter(gateAdmits)
const inCensusNotGate = census.filter((f) => !gateAdmits(f))
const inGateNotCensus = gate.filter((f) => !routerAdmits(f))
console.log(`census(router): ${census.length} · gate(exts): ${gate.length}`)
console.log(`in census NOT in gate (${inCensusNotGate.length}):`)
for (const f of inCensusNotGate.sort()) console.log(`  ${f}`)
console.log(`in gate NOT in census (${inGateNotCensus.length}):`)
for (const f of inGateNotCensus.sort()) console.log(`  ${f}`)
