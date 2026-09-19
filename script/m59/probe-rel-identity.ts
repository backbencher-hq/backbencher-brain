// script/m59/probe-rel-identity.ts — M59.A8 (#854)
//
// THE CLAIM UNDER TEST: a relationship's identity keys on the target name AS
// THE ANALYZER WROTE IT (`target_external`), while `target_symbol_id` is what
// the resolver decided it points at. When two spellings resolve to one symbol
// the same semantic edge is stored twice — and `bb_graph` then reports one
// caller twice for one call site.
//
// This probe MEASURES the defect on the real index and shows the consequence at
// the tool layer. It does not fix anything and it asserts nothing about what
// the identity SHOULD be: that is the resolution-contract decision #854 exists
// to make (changing `targetName` to the resolved symbol changes what happens
// when resolution NULLs out, which `repairInEdges` round-trips by name).
//
// Why re-measure at all: the numbers recorded in #854 (116 groups / 223 rows)
// predate #822, #879 and the analyzer lane's line work. A fix has to reconcile
// the CURRENT state, not the filing's.
//
// Method — the real pipeline into a throwaway BB_DATA_DIR, then the DB is asked
// directly. Every predicate is a real query, and the PK-collision check is a
// negative control: duplicated ids would mean the identity change is unsafe.
//
// Usage: npx tsx script/m59/probe-rel-identity.ts [--repo=cats-effect] [--top=3]

import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const arg = (n: string, d?: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? d
const REPO = arg("repo", "cats-effect")!
// --data=<dir> reuses an existing index (the measurement is read-only, so
// re-indexing the same repo to re-ask the same question is pure waste).
const REUSE = arg("data")
const DATA = REUSE ?? mkdtempSync(path.join(tmpdir(), "m59-relident-data-"))
process.env.BB_DATA_DIR = DATA
const TOP = Number(arg("top", "3"))
const CORPUS = `$HOME/fixtures/repositories/${REPO}`

async function main() {
  const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const { graphTraversal } = await import(path.join(ROOT, "src/intelligence/graph/graph-engine.ts"))

  const pid = getProjectId(CORPUS) as any
  if (REUSE && existsSync(REUSE)) {
    console.log(`reusing index at ${REUSE}`)
  } else {
    console.log(`indexing ${CORPUS} …`)
    const stats: any = await indexProjectParallel(pid, CORPUS, {})
    console.log(`indexed: files=${stats?.filesProcessed ?? stats?.files ?? "?"} rels=${stats?.relationships ?? "?"}`)
  }

  const db: any = await BrainDatabase.getRawInstance(pid)
  const one = (sql: string, ...p: any[]) => db.prepare(sql).get(...p) as any
  const all = (sql: string, ...p: any[]) => db.prepare(sql).all(...p) as any[]

  const total = one(`SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ?`, pid).c

  // ── NEGATIVE CONTROL: a duplicated primary key would make any identity change unsafe ──
  const pkCollisions = all(
    `SELECT id, COUNT(*) n FROM brain_relationship WHERE project_id = ? GROUP BY id HAVING COUNT(*) > 1`,
    pid,
  )

  // ── THE DEFECT: same (source, resolved target, type, line) stored more than once ──
  const dupGroups = all(
    `SELECT r.source_symbol_id src, r.target_symbol_id tgt, r.relationship_type rt, r.line_number ln,
            COUNT(*) n,
            COUNT(DISTINCT COALESCE(r.target_external,'')) spellings,
            GROUP_CONCAT(DISTINCT COALESCE(r.target_external,'')) exts
     FROM brain_relationship r
     WHERE r.project_id = ? AND r.target_symbol_id IS NOT NULL
     GROUP BY r.source_symbol_id, r.target_symbol_id, r.relationship_type, r.line_number
     HAVING COUNT(*) > 1
     ORDER BY COUNT(*) DESC`,
    pid,
  )
  const extraRows = dupGroups.reduce((a, g) => a + (g.n - 1), 0)
  const withLine = dupGroups.filter((g) => Number(g.ln) > 0).length
  const withLineExtra = dupGroups.filter((g) => Number(g.ln) > 0).reduce((a, g) => a + (g.n - 1), 0)

  // ── CLASS SPLIT: does the duplicate come from DIFFERENT SPELLINGS — the #854
  //    mechanism — or from the same spelling stored twice (a different bug)? ──
  const spellingClass = dupGroups.filter((g) => g.spellings > 1)
  const sameSpellingClass = dupGroups.filter((g) => g.spellings === 1)

  // ── The `contains` class the issue calls out: distinct YAML/index paths
  //    resolving to one anchor symbol (same question, different answer) ──
  const containsGroups = all(     `SELECT r.source_symbol_id src, r.target_symbol_id tgt, COUNT(*) n, COUNT(DISTINCT r.target_external) spellings,
            GROUP_CONCAT(DISTINCT r.target_external) exts
     FROM brain_relationship r
     WHERE r.project_id = ? AND r.relationship_type = 'contains'
     GROUP BY r.source_symbol_id, r.target_symbol_id
     HAVING COUNT(*) > 1`,
    pid,
  )

  const byType: Array<{ rt: string; groups: number; extra: number }> = all(
    `SELECT rt, COUNT(*) groups, SUM(n - 1) extra FROM (
       SELECT r.relationship_type rt, COUNT(*) n
       FROM brain_relationship r
       WHERE r.project_id = ? AND r.target_symbol_id IS NOT NULL
       GROUP BY r.source_symbol_id, r.target_symbol_id, r.relationship_type, r.line_number
       HAVING COUNT(*) > 1
     ) GROUP BY rt ORDER BY extra DESC`,
    pid,
  )

  console.log(`\n=== ${REPO}: ${total} relationship rows ===`)
  console.log(`PK collisions (must be 0)                    : ${pkCollisions.length}`)
  console.log(`duplicate groups (source,tgt,type,line)      : ${dupGroups.length}`)
  console.log(`  extra rows they account for                : ${extraRows}`)
  console.log(`  of those groups, ones carrying a line      : ${withLine}  (${withLineExtra} extra rows)`)
  console.log(`  caused by DIFFERENT spellings (#854 shape) : ${spellingClass.length}`)
  console.log(`  same spelling stored twice (other shape)   : ${sameSpellingClass.length}`)
  console.log(`contains groups with >1 row                 : ${containsGroups.length}`)
  console.log(`\nby type:`)
  for (const t of byType) console.log(`  ${String(t.rt).padEnd(16)} groups=${t.groups} extra=${t.extra}`)

  console.log(`\n=== sample duplicate groups (the two spellings are the whole defect) ===`)
  for (const g of spellingClass.slice(0, 6)) {
    console.log(JSON.stringify({ type: g.rt, line: g.ln, n: g.n, spellings: g.exts }))
  }
  console.log(`\n=== sample same-spelling duplicates (a different mechanism — must not be lumped in) ===`)
  for (const g of sameSpellingClass.slice(0, 4)) {
    console.log(JSON.stringify({ type: g.rt, line: g.ln, n: g.n, spellings: g.exts }))
  }

  // ── THE CONSEQUENCE AT THE TOOL LAYER: one call site reported twice ──
  // Rank callees by how many duplicate groups name them as the resolved target,
  // then ask the REAL tool and compare what it reports against distinct sites.
  const callees = all(
    `SELECT ts.name tname, COUNT(*) groups FROM (
       SELECT r.target_symbol_id tgt, COUNT(*) n
       FROM brain_relationship r
       WHERE r.project_id = ? AND r.target_symbol_id IS NOT NULL
       GROUP BY r.source_symbol_id, r.target_symbol_id, r.relationship_type, r.line_number
       HAVING COUNT(*) > 1
     ) d JOIN brain_symbol ts ON ts.id = d.tgt
     GROUP BY ts.name ORDER BY groups DESC LIMIT ?`,
    pid,
    TOP,
  )

  console.log(`\n=== tool-layer consequence (bb_graph over-counts one site) ===`)
  const toolLeg: any[] = []
  let printedRaw = false
  for (const c of callees) {
    let callers: any[] = []
    try {
      const t: any = await graphTraversal(pid, c.tname, {})
      callers = (t?.callers ?? []) as any[]
    } catch (e: any) {
      console.log(`  ${c.tname}: graphTraversal failed: ${e?.message ?? e}`)
      continue
    }
    const keys = new Set(callers.map((x) => `${x.from}|${x.callSite?.line ?? "null"}`))
    const rowIds = callers.map((x) => String(x.rowId ?? x.id ?? "<none>"))
    const distinctRowIds = new Set(rowIds).size
    // The decisive split: if the tool repeats the SAME row, that is a join bug
    // in the tool; if it reports DIFFERENT rows for one (from, line), that is
    // the store-identity defect this issue is about. Never conflate the two.
    const triple = new Map<string, number>()
    for (const x of callers) {
      const k = `${x.from}|${x.callSite?.line ?? "null"}|${x.type ?? x.relationshipType ?? "?"}`
      triple.set(k, (triple.get(k) ?? 0) + 1)
    }
    const repeatedTriples = [...triple.entries()].filter(([, n]) => n > 1)
    if (!printedRaw && callers.length > 0) {
      printedRaw = true
      console.log(`\n  raw payload sample for ${c.tname} (first 8 of ${callers.length}):`)
      for (const x of callers.slice(0, 8)) {
        console.log(
          "   " +
            JSON.stringify({
              rowId: String(x.rowId ?? x.id ?? "<none>").slice(-28),
              from: x.from,
              to: x.to,
              type: x.type ?? x.relationshipType,
              line: x.callSite?.line ?? null,
              keys: x.callSite ? Object.keys(x.callSite) : null,
            }),
        )
      }
    }
    const rowDepths = new Map<string, number[]>()
    for (let i = 0; i < callers.length; i++) {
      const id = rowIds[i]
      const d = Number((callers[i] as any).depth ?? -1)
      rowDepths.set(id, [...(rowDepths.get(id) ?? []), d])
    }
    const repeatedRowIds = [...rowDepths.entries()]
      .filter(([, ds]) => ds.length > 1)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 5)
      .map(([id, ds]) => ({ id: id.slice(-52), n: ds.length, depths: ds }))
    toolLeg.push({
      callee: c.tname,
      duplicateGroups: c.groups,
      reportedCallers: callers.length,
      distinctFromAtLine: keys.size,
      reportedMoreThanSites: callers.length - keys.size,
      distinctRowIds,
      sameRowRepeated: callers.length - distinctRowIds,
      repeatedFromLineTypeKeys: repeatedTriples.length,
      maxRepeat: repeatedTriples.reduce((a, [, n]) => Math.max(a, n), 0),
      repeatedRowIds,
      note: "<none> rowIds mean the payload carries no rowId — the mapping is then unprovable here",
    })
    console.log(
      `  ${String(c.tname).padEnd(22)} dupGroups=${c.groups} reported=${callers.length} distinct(from,line)=${keys.size} over=${callers.length - keys.size} distinctRowIds=${distinctRowIds} sameRowRepeated=${callers.length - distinctRowIds} repeated(from,line,type)=${repeatedTriples.length} maxRepeat=${repeatedTriples.reduce((a, [, n]) => Math.max(a, n), 0)}`,
    )
    if (repeatedRowIds.length) console.log(`     repeated rowIds: ${JSON.stringify(repeatedRowIds)}`)
  }

  const out = {
    probe: "M59.A8",
    issue: 854,
    at: new Date().toISOString(),
    repo: CORPUS,
    dataDir: DATA,
    totals: { rows: total, pkCollisions: pkCollisions.length },
    duplicateGroups: {
      groups: dupGroups.length,
      extraRows,
      groupsWithLine: withLine,
      extraRowsWithLine: withLineExtra,
      fromDifferentSpellings: spellingClass.length,
      fromSameSpelling: sameSpellingClass.length,
      byType,
    },
    containsGroups: { groups: containsGroups.length, sample: containsGroups.slice(0, 8) },
    sampleSpellingDuplicates: spellingClass.slice(0, 12),
    sampleSameSpellingDuplicates: sameSpellingClass.slice(0, 8),
    toolLeg,
    verdict: dupGroups.length === 0 ? "CLEAN" : "DEFECT-PRESENT",
  }

  mkdirSync(path.join(ROOT, "validation/m59/results"), { recursive: true })
  writeFileSync(
    path.join(ROOT, "validation/m59/results/probe-rel-identity.json"),
    JSON.stringify(out, null, 2) + "\n",
  )
  console.log(`\nverdict: ${out.verdict}`)
  console.log(`evidence: validation/m59/results/probe-rel-identity.json`)
}

main().catch((e) => {
  console.error("PROBE ERROR:", e?.stack ?? e)
  process.exit(1)
})
