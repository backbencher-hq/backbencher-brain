/**
 * C `contains` SOURCE-CONTAINER probe — is the shared file-scope pseudo-container convention
 * (`contains from global`) a C-lane debt? Answer: NO.
 *
 * Lead ruling 2026-10-18 (charter reproduction of the C verdict): the convention was named as a
 * shared-oracle debt for a one-pass cpp fix. This probe measures the C side of the question.
 *
 * STRUCTURAL half: the C analyzer's `contains` source is `symbol.ownerName`, and `ownerName` is
 * assigned at exactly three sites — struct member, union member, enum member
 * (src/ast/real-c-analyzer.ts member-publish blocks) — with the name coming from a
 * struct/union/enum specifier or the #950/#986 member-path composition. The literal `global`
 * has no assignment path in this analyzer.
 *
 * MEASURED half (STRIDE TRIAGE, not a population claim): corpus walk over the admitted `.c`
 * population (5,022 files), sample 300 at stride 16, each analyzed through the production entry
 * `pool-worker.parseFile`; every emitted `contains` edge counted by source, and the sources equal
 * to `global` counted separately. Result at 2026-10-18: 975 contains edges, **0** with source
 * `global`; the sources seen are real containers (`SuiteSparse_config_struct`,
 * `__pyx_CyFunctionObject`, `ret`, `prof_logging_state_e`, ...).
 *
 * WHOLE-POPULATION command (NOT run — the cpp lane measures the whole-population count for the
 * one-pass fix; this command would produce the same number for C's population):
 *   export BB_CORPUS_ROOT=$PWD/.corpus
 *   bun run validation/m14/fixtures/c/tmp/probe-contains-source.ts 5022     # sample == population, stride 1
 * (or `0`, because `cap` larger than the discovered set yields stride 1; the script prints
 * `population.discovered`, `population.sampled`, `containsEdges`, `sourceGlobal`).
 *
 * Usage: bun run <this> [cap]   (cap = the stride sample size; default 300)
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../../src/ast/pool-worker"
const ROOT = path.resolve(import.meta.dirname, "../../../../..")
const CR = path.join(ROOT, ".corpus")
const found: string[] = []
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue; execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[] = []
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) { if (!rel.toLowerCase().endsWith(".c")) continue; const abs = path.join(dir, rel); try { if (statSync(abs).size > 1024 * 1024) continue } catch { continue } found.push(abs) }
}
found.sort()
const cap = Number(process.argv[2] ?? 300)
const stride = Math.max(1, Math.floor(found.length / cap))
const picked: string[] = []
for (let i = 0; i < found.length && picked.length < cap; i += stride) picked.push(found[i])
let total = 0, byGlobal = 0, byGlobalSources: string[] = [], other: string[] = []
for (const abs of picked) {
  const rel = path.relative(CR, abs)
  let r: any
  try { r = await parseFile(abs, path.join(CR, rel.split(path.sep)[0])) } catch { continue }
  for (const e of r.relationships ?? []) {
    if (String(e.type) !== "contains") continue
    total++
    const src = String(e.source ?? "")
    if (src === "global") { byGlobal++; if (byGlobalSources.length < 8) byGlobalSources.push(`${rel}: ${src} -> ${e.target}`) }
    else if (other.length < 5 && !other.includes(src)) other.push(src)
  }
}
console.log(JSON.stringify({ population: { discovered: found.length, sampled: picked.length, stride }, containsEdges: total, sourceGlobal: byGlobal, sampleGlobalRows: byGlobalSources, sampleOtherSources: other }, null, 1))
