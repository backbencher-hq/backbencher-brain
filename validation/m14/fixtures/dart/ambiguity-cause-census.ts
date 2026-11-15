/**
 * WHY IS AN EDGE AMBIGUOUS? — the decomposition that decides whether 100 % is reachable, and how.
 *
 * The gate says an edge is AMBIGUOUS when its target matches MORE THAN ONE declaration in the
 * project's key space. That single number hides two causes that need completely different fixes, and
 * the whole point of this file is that they are separable with information the run ALREADY HAS:
 *
 *   amb(SAME-FILE)   every declaration that answers the target is declared in the file that EMITTED
 *                    the edge. The emitting file knows its own declarations, so this is a pure
 *                    analyzer defect: the information needed to disambiguate was in hand at emission
 *                    time and was not used. Fix = qualify the target (the `contains` round's
 *                    mechanism, and what `calls` already does for an enclosing-class callee).
 *
 *   amb(CROSS-FILE)  the declarations live in files OTHER than (or in addition to) the emitting one.
 *                    No local fix can close it: the store resolves by NAME, so the edge must start
 *                    naming an IDENTITY (a file-scoped spelling, the way `imports` names a file and
 *                    `contains` names `Owner.member`). Fix = representation, not inference.
 *
 * The split is the roadmap. If the mass is mostly SAME-FILE, the next round is a bounded analyzer fix
 * with a large, deterministic payoff. If it is mostly CROSS-FILE, no amount of analyzer cleverness
 * moves it and the work is the target spelling — a bigger, cross-cutting change.
 *
 * MEASURED with the gate's own rule, so the numbers are comparable to TABLE 1: the key space is
 * `name` plus the `qualifiedName` alias when it differs (gate `countKey`), the scope is PER PROJECT
 * (gate: production's scope, `resolveRelationships`' `WHERE s.project_id = ?`), files come from
 * `git ls-files`, and the same 1 MB cap applies.
 *
 * WHAT THIS FILE DOES NOT CLAIM. It is not a second gate: it counts only the ambiguous column's two
 * causes, it runs on the repos named on the command line rather than the whole corpus, and it says
 * nothing about whether an edge points at the RIGHT declaration (that is differential.ts's question).
 *
 * Run: npx tsx validation/m14/fixtures/dart/ambiguity-cause-census.ts [repo,repo,...]
 */
import { execFileSync } from "node:child_process"
import { statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const CONC = Number(process.env.BB_DART_CONC ?? 8)
const SIZE_CAP = 1_048_576
const repos = (process.argv[2] ?? "dart-http,riverpod,proxicall").split(",")

const TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
]

function filesOf(name: string): { repo: string; files: string[] } | null {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) return null } catch { return null }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { return null }
  const files = tracked
    .filter((r) => r.endsWith(".dart"))
    .map((r) => path.join(dir, r))
    .filter((f) => {
      try { return statSync(f).size <= SIZE_CAP } catch { return false }
    })
  return { repo: dir, files }
}

type Row = { edges: number; resolved: number; ambSameFile: number; ambCrossFile: number; unresolved: number }
const zero = (): Row => ({ edges: 0, resolved: 0, ambSameFile: 0, ambCrossFile: 0, unresolved: 0 })

for (const repoName of repos) {
  const found = filesOf(repoName)
  if (!found) continue
  const { repo, files } = found
  const rel = (f: string) => path.relative(repo, f)

  // ── PASS 1: the key space, with the DECLARING FILES of every key ────────────────────────────
  // The gate keys on `name`, plus `qualifiedName` when it differs — one declaration counted twice
  // under two spellings, which is what keeps the count honest. Here each key also remembers WHICH
  // file declared it, because that is the whole census: a collision inside one file is a different
  // defect from a collision across files.
  const decls = new Map<string, number>()
  const decliningFiles = new Map<string, Set<string>>()
  const parsed: { f: string; r: any }[] = []
  const queue = [...files]
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (true) {
      const f = queue.shift()
      if (!f) return
      let r: any
      try { r = await parseFile(f, path.dirname(f)) } catch { continue }
      const here = rel(f)
      const add = (key: string) => {
        decls.set(key, (decls.get(key) ?? 0) + 1)
        let s = decliningFiles.get(key)
        if (!s) decliningFiles.set(key, (s = new Set()))
        s.add(here)
      }
      for (const s of Array.isArray(r?.symbols) ? r.symbols : []) {
        const name = String(s?.name ?? "")
        if (name.length === 0) continue
        add(name)
        const q = String(s?.qualifiedName ?? "")
        if (q.length > 0 && q !== name) add(q)
      }
      parsed.push({ f, r })
    }
  }))

  // ── PASS 2: classify every edge, against the FINISHED key space ─────────────────────────────
  // Two passes for the same reason the gate has two: an edge judged against a half-built space is a
  // measurement of this file's loop order, not of the code. (See `incoming-gate.ts`'s two-pass note:
  // dart-http's imports read 384/1406 one-pass and 713/1406 two-pass, same edges, same space.)
  const rows = new Map<string, Row>(TYPES.map((t) => [t, zero()]))
  const topAmb = new Map<string, Map<string, number>>(TYPES.map((t) => [t, new Map()]))
  for (const { f, r } of parsed) {
    const here = rel(f)
    for (const x of Array.isArray(r?.relationships) ? r.relationships : []) {
      const t = String(x?.type ?? x?.relationshipType ?? "")
      const row = rows.get(t)
      if (!row) continue
      const tgt = String(x?.target ?? x?.to ?? x?.toSymbol ?? "")
      if (tgt.length === 0) continue
      row.edges++
      const n = decls.get(tgt) ?? 0
      if (n === 0) { row.unresolved++; continue }
      if (n === 1) { row.resolved++; continue }
      const where = decliningFiles.get(tgt)!
      // SAME-FILE means every declarer is the emitting file. One foreign declarer is enough to make
      // it CROSS-FILE, and that is the right line: the emitting file cannot disambiguate against a
      // declaration it has never read, so no local fix exists for that edge.
      if (where.size === 1 && where.has(here)) row.ambSameFile++
      else {
        row.ambCrossFile++
        const m = topAmb.get(t)!
        m.set(tgt, (m.get(tgt) ?? 0) + 1)
      }
    }
  }

  const parsedCount = parsed.length
  console.log(`\n${repoName}: ${parsedCount}/${files.length} files parsed — ${decls.size} keys, ${decliningFiles.size} with a declaring file`)
  // THE "unresolved" COLUMN IS NOT the gate's `unresolved` COLUMN. This census ignores CLAIMS by
  // design (it is about the key space), so its column is the gate's `unresolved` PLUS all of its
  // claim columns (`extOK`/`ext?`/`extFAIL`/`bindOK`/`bind?`/`bindFAIL`). Reconciled on dart-http
  // against the gate's own table: `calls` 2313 here = 2248 unresolved + 65 bindOK there, and the
  // other two columns match to the edge (1341 resolved, 1055 ambiguous). Stated because a reader
  // comparing the two tables would otherwise read a 65-edge discrepancy as a defect in one of them.
  console.log("  (this census ignores CLAIMS: its `unresolved` = the gate's unresolved + its extOK/ext?/extFAIL/bindOK/bind?/bindFAIL)")
  console.log(
    "type".padEnd(14) + "edges".padStart(9) + "resolved".padStart(10) +
    "amb(SAME-FILE)".padStart(16) + "amb(CROSS-FILE)".padStart(16) + "unresolved".padStart(12),
  )
  console.log("-".repeat(77))
  const tot = zero()
  for (const t of TYPES) {
    const r = rows.get(t)!
    tot.edges += r.edges; tot.resolved += r.resolved; tot.ambSameFile += r.ambSameFile
    tot.ambCrossFile += r.ambCrossFile; tot.unresolved += r.unresolved
    if (r.edges === 0) continue
    console.log(
      t.padEnd(14) + String(r.edges).padStart(9) + String(r.resolved).padStart(10) +
      String(r.ambSameFile).padStart(16) + String(r.ambCrossFile).padStart(16) + String(r.unresolved).padStart(12),
    )
  }
  const amb = tot.ambSameFile + tot.ambCrossFile
  console.log("-".repeat(77))
  console.log(
    "TOTAL".padEnd(14) + String(tot.edges).padStart(9) + String(tot.resolved).padStart(10) +
    String(tot.ambSameFile).padStart(16) + String(tot.ambCrossFile).padStart(16) + String(tot.unresolved).padStart(12),
  )
  console.log(
    `\n  ambiguous ${amb} of ${tot.edges} edges — SAME-FILE ${tot.ambSameFile} (${pct(tot.ambSameFile, amb)} %), ` +
    `CROSS-FILE ${tot.ambCrossFile} (${pct(tot.ambCrossFile, amb)} %)`,
  )
  console.log(
    `  ceiling: SAME-FILE is closable by the analyzer alone (+${tot.ambSameFile}); ` +
    `CROSS-FILE needs an identity-carrying target (+${tot.ambCrossFile})`,
  )
  for (const t of TYPES) {
    const m = topAmb.get(t)!
    if (m.size === 0) continue
    const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    console.log(`\n  ${t} — top CROSS-FILE ambiguous targets (name x edges, declaring files):`)
    for (const [name, count] of top) {
      console.log(`     ${name.slice(0, 46).padEnd(48)} x${String(count).padEnd(7)} in ${decliningFiles.get(name)!.size} file(s)`)
    }
  }
}

function pct(a: number, b: number): string {
  return b === 0 ? "0.0" : ((a / b) * 100).toFixed(1)
}
