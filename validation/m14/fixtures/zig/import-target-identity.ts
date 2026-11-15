/**
 * CAN A `Module` SYMBOL MAKE `imports` RESOLVABLE, OR WOULD IT MERGE TWO DISTINCT MODULES?
 *
 * ## THE QUESTION
 *
 * Requirement D of the incoming-edge brief asks that every APPLICABLE relationship resolve.
 * On this lane `imports` is the worst type by an order of magnitude: of 10,200 edges over
 * 3,834 files, 15 targets bind to a uniquely-named published symbol (0.15%) and 6,781 bind to
 * nothing, of which 6,621 are classed `path` — the literal contains a separator. So the type
 * the brief singles out as "an edge the graph asserts that is not there" is also the one that
 * is structurally unresolvable.
 *
 * `SymbolKind.Module` EXISTS (`src/ast/types.ts:25`) and this lane deliberately does not use
 * it: the Declaration surface table says an `@import` publishes "(no symbol)", because a
 * module alias is a binding rather than a declaration of a type. So the obvious move —
 * publish the imported module and let the edge bind — is available and NOT YET TAKEN. Whether
 * it is SAFE is a question about what a Zig import path DENOTES, and that is measurable.
 *
 * ## WHY THE ANSWER MAY BE NO
 *
 * `@import("util.zig")` is a path RELATIVE TO THE IMPORTING FILE. Two files in different
 * directories that both write `@import("util.zig")` name TWO DIFFERENT MODULES. Publishing one
 * `Module{name:"util.zig"}` for both MERGES them — an edge that is not merely ambiguous but
 * wrong, which is the brief's own category of a fabricated edge. `@import("std/mem")` is the
 * opposite case: `std` is one global module identity in the Zig build graph, so every file
 * writing it names ONE thing and a node for it is sound.
 *
 * The two halves want OPPOSITE verdicts, so a single average over "6,621 paths" would hide
 * the decision. The question is what FRACTION of the path-bearing population is relative, and
 * for each distinct literal, how many distinct DIRECTORIES write it.
 *
 * ## WHAT THIS MEASURES
 *
 * Production `parseFile` (`src/ast/pool-worker.ts`) over the corpus — NOT `analyze()` — so the
 * population is the analyzer's real output and no second implementation of the import rule
 * exists to disagree with it. For every `imports` edge: the target literal AS EMITTED, plus
 * the importing file's directory. Then:
 *
 *   - bucket each distinct literal by what its shape denotes (bare / std-rooted /
 *     relative-or-absolute-path / other-path);
 *   - for every path-bearing literal, count the DISTINCT DIRECTORIES that write it. That
 *     second number is the decision variable: many directories writing one literal is the
 *     merge hazard; one directory writing it is a local fact.
 *
 * ## WHAT IT CANNOT SEE
 *
 * It does not canonicalise a relative path against its importing file, so it cannot PROVE
 * that two same-named relative targets are distinct modules — only that the corpus writes
 * them from several directories, which is the falsifiable form of the hazard. And it inherits
 * the pinned wasm's 2.40% ERROR-node rate: an import site inside an ERROR node is invisible
 * here exactly as it is to the analyzer, so these counts are a floor on the import population.
 */
import { statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { dirname, join } from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const REPOS = ["zig", "zls", "ghostty"]

function trackedZig(dir: string): string[] {
  try {
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    return []
  }
  try {
    return execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.zig"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
  } catch {
    return []
  }
}

type Bucket = "bare" | "std-rooted" | "path-not-std" | "c-header"

function bucketOf(t: string): Bucket {
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(t)) return "bare"
  if (t.endsWith(".h") || t.endsWith(".hpp") || t.endsWith(".hxx")) return "c-header"
  const head = t.split("/")[0]
  if (head === "std") return "std-rooted"
  return "path-not-std"
}

type Entry = { sites: number; literals: Set<string>; files: Set<string>; dirs: Set<string> }

async function main() {
  const files: string[] = []
  for (const repo of REPOS) {
    const root = join(CORPUS, repo)
    try {
      if (!statSync(root).isDirectory()) continue
    } catch {
      continue
    }
    for (const rel of trackedZig(root)) files.push(join(root, rel))
  }
  files.sort()

  const byBucket = new Map<Bucket, Entry>()
  const dirPerLiteral = new Map<string, Set<string>>()
  const sitesPerLiteral = new Map<string, number>()
  const litPerBucket = new Map<Bucket, Set<string>>()
  let edges = 0
  let parsed = 0
  let degraded = 0
  let failures = 0
  // The shared arbiter admits files UNDER a 512 KB ceiling (`ontology-coverage-gate.ts`
  // reads 3,834 admitted files on this corpus and this lane has 14 files over it).
  // Tallying the same population the arbiter tallies is what makes the two edge counts
  // comparable at all, so the ceiling is applied here too and both are printed.
  const CEILING = 524288
  let edgesAdmitted = 0
  let filesOverCeiling = 0
  let edgesOverCeiling = 0

  for (const f of files) {
    let res: Awaited<ReturnType<typeof parseFile>>
    try {
      res = await parseFile(f, "zig")
    } catch {
      failures++
      continue
    }
    if (!res) {
      failures++
      continue
    }
    parsed++
    if ((res as any).fallback) degraded++
    let size = 0
    try { size = statSync(f).size } catch { }
    const overCeiling = size > CEILING
    if (overCeiling) filesOverCeiling++
    for (const r of res.relationships ?? []) {
      if (r.type !== "imports") continue
      edges++
      if (overCeiling) edgesOverCeiling++
      else edgesAdmitted++
      const t = String(r.target ?? "")
      if (!t) continue
      const b = bucketOf(t)
      const e = byBucket.get(b) ?? { sites: 0, literals: new Set(), files: new Set(), dirs: new Set() }
      e.sites++
      e.literals.add(t)
      e.files.add(f)
      e.dirs.add(dirname(f))
      byBucket.set(b, e)
      const ls = litPerBucket.get(b) ?? new Set<string>()
      ls.add(t)
      litPerBucket.set(b, ls)
      sitesPerLiteral.set(t, (sitesPerLiteral.get(t) ?? 0) + 1)
      // EVERY non-bare literal belongs in the hazard table, not only the ones holding a
      // separator. `build.zig` has no slash and is exactly as relative as `../build.zig`;
      // an earlier version of this file filtered on `t.includes("/")` and silently
      // undercounted its own hazard by 2,604 sites.
      if (b !== "bare") {
        const d = dirPerLiteral.get(t) ?? new Set<string>()
        d.add(dirname(f))
        dirPerLiteral.set(t, d)
      }
    }
  }

  console.log("import-target-identity: zig — can a Module symbol make `imports` resolvable?")
  console.log(`corpus: ${files.length} tracked .zig files in ${REPOS.join(", ")}`)
  console.log(`parseFile: ${parsed} parsed, ${degraded} degraded, ${failures} failed`)
  console.log(`imports edges read: ${edges}`)
  console.log(`  of which from files UNDER the arbiter's 512 KB ceiling: ${edgesAdmitted}`)
  console.log(`  of which from the ${filesOverCeiling} files OVER it: ${edgesOverCeiling}`)
  console.log(`  files over the ceiling: ${filesOverCeiling} of ${files.length}; admitted ${files.length - filesOverCeiling}\n`)

  const order: Bucket[] = ["bare", "std-rooted", "path-not-std", "c-header"]
  console.log("bucket           sites   distinct   files    dirs   dirs/literal")
  console.log("-".repeat(72))
  for (const b of order) {
    const e = byBucket.get(b)
    if (!e) continue
    const ratio = (e.dirs.size / e.literals.size).toFixed(2)
    console.log(
      `${b.padEnd(15)}${String(e.sites).padStart(7)}${String(e.literals.size).padStart(11)}` +
        `${String(e.files.size).padStart(8)}${String(e.dirs.size).padStart(8)}${ratio.padStart(15)}`,
    )
  }

  console.log(`\nthe merge hazard — one NON-BARE literal, how many distinct directories write it:`)
  const rows = [...dirPerLiteral.entries()].sort((a, b) => b[1].size - a[1].size)
  const multi = rows.filter(([, d]) => d.size > 1)
  const single = rows.filter(([, d]) => d.size === 1)
  console.log(`  distinct non-bare literals:                ${rows.length}`)
  console.log(`  written from >1 directory (merge hazard):   ${multi.length}`)
  console.log(`  written from exactly 1 directory:           ${single.length}`)
  console.log(`  top 15 by directory count:`)
  for (const [lit, d] of rows.slice(0, 15)) console.log(`    ${String(d.size).padStart(5)} dirs  ${lit}`)

  console.log(`\nSITES, not literals — the number a Module node would have to be right about:`)
  let hazardSites = 0
  let safeSites = 0
  for (const [lit, d] of rows) {
    const sites = sitesPerLiteral.get(lit) ?? 0
    if (d.size > 1) hazardSites += sites
    else safeSites += sites
  }
  const totalPathSites = hazardSites + safeSites
  console.log(`  non-bare sites total:                      ${totalPathSites}`)
  console.log(`  from >1 directory (a Module node MERGES): ${hazardSites}  (${pct(hazardSites, totalPathSites)})`)
  console.log(`  from 1 directory (a Module node is sound):${String(safeSites).padStart(5)}  (${pct(safeSites, totalPathSites)})`)

  const bareEntry = byBucket.get("bare")
  if (bareEntry) {
    const top = [...sitesPerLiteral.entries()]
      .filter(([lit]) => bareEntry.literals.has(lit))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
    console.log(`\nthe bare bucket, top 12 targets — one global name each, so a Module node is sound here:`)
    for (const [lit, n] of top) {
      const dirs = (() => {
        let m = 0
        for (const f of bareEntry.files) void f
        return m
      })()
      void dirs
      console.log(`    ${String(n).padStart(6)} sites  ${lit}`)
    }
    console.log(`  bare literals written from >1 directory (expected for a global name like std):`)
    console.log(`    bare: ${bareEntry.sites} sites, ${bareEntry.literals.size} distinct, ${bareEntry.dirs.size} dirs, ${(bareEntry.dirs.size / bareEntry.literals.size).toFixed(2)} dirs per literal`)
  }

  console.log(`\nVERDICT INPUT — what fraction of ALL imports edges a Module node could bind:`)
  const mergeable = byBucket.get("bare")?.sites ?? 0
  const stdOk = byBucket.get("std-rooted")?.sites ?? 0
  console.log(`  bare-name targets (already bind or are one global name): ${mergeable}`)
  console.log(`  std-rooted targets (one global module identity):          ${stdOk}`)
  console.log(`  path-not-std + c-header (relative or per-directory):      ${hazardSites + safeSites}`)
  console.log(`  bucket arithmetic check: ${mergeable} + ${stdOk} + ${hazardSites + safeSites} = ${mergeable + stdOk + hazardSites + safeSites} vs ${edges} edges read`)
  if (mergeable + stdOk + hazardSites + safeSites !== edges) {
    console.log("  !! buckets do not sum to the edge count — this instrument is wrong, do not quote it")
  }
}

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`
}

main()
