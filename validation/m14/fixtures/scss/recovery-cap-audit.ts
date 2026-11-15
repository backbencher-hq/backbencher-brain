/** WHERE DOES THE RECOVERY CAP BIND? The Lead's third condition: a normal file with an ERROR region
 *  must still be recovered FULLY — if the cap binds there, the cap is wrong. This walks every
 *  admitted .scss file and reports each file whose module symbol carries `scssRecoveryCap`, with the
 *  counts the analyzer recorded. Expected: the pathological file only.
 *  USAGE  npx tsx validation/m14/fixtures/scss/recovery-cap-audit.ts [out-json] */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
const CR = "/home/ishaq2321/bb_tests/repositories"
const files: { repo: string; rel: string; abs: string }[] = []
for (const name of execFileSync("ls", [CR], { encoding: "utf8" }).split("\n").filter(Boolean).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  for (const rel of execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)) {
    if (!rel.toLowerCase().endsWith(".scss")) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size <= 1024 * 1024) files.push({ repo: name, rel, abs }) } catch { /* absent */ }
  }
}
const bound: any[] = []
let parsed = 0, emptyWithContent = 0
for (const f of files) {
  let r: any
  try { r = await parseFile(f.abs, path.join(CR, f.repo), { projectRoot: path.join(CR, f.repo) } as any) } catch { continue }
  if (!r) continue
  parsed++
  if ((r.symbols ?? []).length === 0 && (r.relationships ?? []).length === 0) emptyWithContent++
  // THE DISCLOSURE RIDES RELATIONSHIP METADATA, and that is measured rather than assumed: `parseFile`
  // strips symbol metadata COMPLETELY (every symbol of the pathological file arrives with no metadata
  // keys at all), while relationship metadata is what the fleet's own markers already travel through.
  const cap = (r.relationships ?? []).map((x: any) => x.metadata?.scssRecoveryCap ?? x.metadata?.cssRecoveryCap).find(Boolean)
  if (cap) bound.push({ file: `${f.repo}/${f.rel}`, ...cap })
}
const report = {
  instrument: "scss recovery-cap audit — where the cap binds, and whether any file still returns nothing",
  population: { admitted: files.length, parsed },
  filesWhereTheCapBound: bound.length,
  bound,
  filesReturningNothingWithContent: emptyWithContent,
  reading: "the cap must bind ONLY on a pathological child count; every other file keeps the unbounded recovery the fixtures pin",
}
const out = process.argv[2] ?? "validation/m14/fixtures/scss/recovery-cap-audit.json"
writeFileSync(out, JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify({ population: report.population, filesWhereTheCapBound: bound.length, bound, filesReturningNothingWithContent: emptyWithContent }, null, 2))
