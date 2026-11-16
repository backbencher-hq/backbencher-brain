/**
 * GraphQL — does `parseFile`'s second argument change the edges?
 *
 * Why this file exists. Three walks of the same 1,905-file corpus produced three different edge
 * totals — 156,702 / 156,763 / 156,702 — and the walks differed in whether `f.dir` was passed to
 * `parseFile`. A probe that cannot say which of its own runs is right cannot publish a count, and
 * the whole report is counts. So this isolates the variable rather than arguing about it.
 *
 * Four arms over the SAME bounded slice, all inside one process, so the pool's load is comparable:
 *
 *   A  parseFile(abs, dir)        — the gate's call, with the repo root
 *   B  parseFile(abs, undefined)  — the probe's first-draft call, no repo root
 *   A2 parseFile(abs, dir) again  — arm A repeated, to separate dir from run-to-run variance
 *
 * A vs B isolates the argument. A vs A2 isolates variance. If A == A2 != B the argument matters; if
 * A != A2 the input is not a pure function of the file and no single-run count is reproducible.
 */
import * as path from "path"
import { ROOT } from "../paths.mts"

const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))

const SLICE = Number(process.env.GQL_SLICE ?? "250")

// The four repos the production census measured most graphql files in, so the slice is the corpus's
// own centre of mass rather than a convenient guess. Counted from
// `out/production-six-questions.json` `population.repos`.
const dirs = [
  "<corpus-root>/bb_tests/repositories/gql-graphql-platform",
  "<corpus-root>/bb_tests/repositories/hasura-engine",
  "<corpus-root>/bb_tests/repositories/gql-graphql-tools",
  "<corpus-root>/bb_tests/repositories/gql-gqlgen",
]
// `statSync` is NOT exported by child_process. Importing it from there throws a TypeError, the
// per-repo try/catch below swallows it as "not a git repo", and the probe walks an EMPTY slice
// while its conclusion string still claims purity — a vacuous pass, which is worse than an error.
const { statSync } = await import("fs")
const { execFileSync } = await import("child_process")

const files: { abs: string; dir: string }[] = []
for (const dir of dirs) {
  let tracked: string[]
  try {
    if (!statSync(dir).isDirectory()) continue
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!/\.(graphql|graphqls|gql)$/.test(rel)) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
    files.push({ abs, dir })
    if (files.length >= SLICE) break
  }
  if (files.length >= SLICE) break
}

const sig = (r: any) =>
  JSON.stringify((r?.relationships ?? []).map((x: any) => [x.source ?? x.from, x.target ?? x.to, String(x.type ?? x.relationshipType)]))
const nrel = (r: any) => (r?.relationships ?? []).length

const arms: Record<string, any[]> = { A: [], B: [], A2: [] }
for (const f of files) {
  arms.A.push(await parseFile(f.abs, f.dir).catch(() => null))
  arms.B.push(await parseFile(f.abs, undefined as any).catch(() => null))
  arms.A2.push(await parseFile(f.abs, f.dir).catch(() => null))
}

const sameAB = arms.A.filter((r, i) => sig(r) === sig(arms.B[i])).length
const sameAA2 = arms.A.filter((r, i) => sig(r) === sig(arms.A2[i])).length
const total = (a: any[]) => a.reduce((s, r) => s + (r ? nrel(r) : 0), 0)

const diffs: string[] = []
for (let i = 0; i < files.length; i++) {
  if (sig(arms.A[i]) === sig(arms.B[i])) continue
  if (diffs.length < 6) {
    const a = new Set(arms.A[i] ? (arms.A[i].relationships ?? []).map((x: any) => `${x.source}->${x.target}:${x.type}`) : [])
    const b = new Set(arms.B[i] ? (arms.B[i].relationships ?? []).map((x: any) => `${x.source}->${x.target}:${x.type}`) : [])
    diffs.push(`${files[i].abs}: A ${a.size} B ${b.size}; onlyA ${[...a].filter((x) => !b.has(x)).slice(0, 2).join(" , ")}; onlyB ${[...b].filter((x) => !a.has(x)).slice(0, 2).join(" , ")}`)
  }
}

console.log(JSON.stringify({
  sliceFiles: files.length,
  relWithDir_A: total(arms.A),
  relNoDir_B: total(arms.B),
  relWithDirAgain_A2: total(arms.A2),
  A_equals_B: `${sameAB}/${files.length}`,
  A_equals_A2: `${sameAA2}/${files.length}`,
  conclusion: files.length === 0
    ? "EMPTY SLICE — the verdict below is vacuous and the numbers prove nothing"
    : sameAA2 === files.length && sameAB === files.length
    ? "parseFile is a pure function of (bytes, dir): neither the argument nor run order changes the edges"
    : sameAB !== files.length
      ? "THE SECOND ARGUMENT CHANGES THE EDGES — a count published without it describes a different call"
      : "run-to-run variance within one process: no single-run count is reproducible",
  diffSamples: diffs,
}, null, 1))