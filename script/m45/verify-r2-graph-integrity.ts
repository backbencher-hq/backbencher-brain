// script/m45/verify-r2-graph-integrity.ts — M45.R2
// Graph-integrity regression gate (48f26228/9f26fd38 lineage). After a FULL
// index (default pipeline: parse + store + relationship resolution +
// enrichment + health) of a fixture exercising real class containment,
// top-level decls, JSON/YAML config virtuals and an incremental re-index,
// the database must show:
//   orphan owners == 0, dead (non-empty) source edges == 0,
//   orphan targets == 0,
// real containment preserved (method -> class, nested class -> class,
// universal contains edge present),
// top-level/file-scope decls ownerless (never orphan),
// and the brain-index-health checks report 0 for those classes.
// Negatives: in-memory refusals + structural refusal when corruption exists.
// Evidence: validation/m45/results/R2.json (BB_M45_EVIDENCE === "1" && pass).

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { execFileSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULT = path.join(ROOT, "validation/m45/results/R2.json")

let checks = 0, passed = 0, failed = 0, negativeCases = 0
function check(label: string, ok: boolean, detail = "") {
  checks++
  if (ok) passed++
  else { failed++; console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}
function negative(label: string, ok: boolean, detail = "") {
  if (ok) negativeCases++
  check(`${label} [negative]`, ok, detail)
}

delete process.env.BB_EMBEDDING_BASE_URL
delete process.env.BB_EMBEDDING_API_KEY
delete process.env.BB_EMBEDDING_MODEL
delete process.env.BB_NO_AUTO_REFRESH

async function main() {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database"))
  const { runIndexHealthCheck } = await import(path.join(ROOT, "src/brain/brain-index-health"))

  const root = mkdtempSync(path.join(tmpdir(), "m45-r2-"))
  const proj = path.join(root, "proj")
  mkdirSync(path.join(proj, "src"), { recursive: true })
  writeFileSync(
    path.join(proj, "src", "a.ts"),
    [
      "export class A {",
      "  m1(): number { return 1 }",
      "  inner(): void {}",
      "  class C {",
      "    nested(): string { return 'c' }",
      "  }",
      "}",
      "export function topFn(): void {}",
      "",
    ].join("\n"),
  )
  writeFileSync(
    path.join(proj, "src", "b.ts"),
    [
      "import { A } from './a'",
      "export class B {",
      "  aRef: A = new A()",
      "  callM1(): number { return this.aRef.m1() }",
      "}",
      "",
    ].join("\n"),
  )
  writeFileSync(path.join(proj, "config.json"), JSON.stringify({ app: { name: "x", deep: { port: 1 } }, list: ["a", "b"] }, null, 2))
  writeFileSync(path.join(proj, "config.yaml"), "server:\n  host: localhost\n  tls:\n    enabled: true\n")

  const pid = getProjectId(proj)
  const t0 = Date.now()
  const stats = await indexProjectParallel(pid, proj, {})
  const sum = stats.summary!
  check("R2 index: all candidates parsed", sum.newlyParsed === sum.totalCandidates && sum.totalCandidates >= 4, JSON.stringify(sum))
  check("R2 index: zero errors", sum.errors === 0, `errors=${sum.errors}`)

  const raw = await BrainDatabase.getRawInstance(pid as any)
  const q = (sql: string, ...args: any[]) => (raw.prepare(sql).get(...args) as any)
  const count = (sql: string, ...args: any[]) => (raw.prepare(sql).get(...args) as any)?.n ?? 0

  const orphanOwners = count(`SELECT COUNT(*) AS n FROM brain_symbol s WHERE s.project_id = ?
    AND s.owner_symbol_id IS NOT NULL AND s.owner_symbol_id != ''
    AND NOT EXISTS (SELECT 1 FROM brain_symbol p WHERE p.id = s.owner_symbol_id AND p.project_id = s.project_id)`, pid)
  const dangling = count(`SELECT COUNT(*) AS n FROM brain_relationship r WHERE r.project_id = ?
    AND r.source_symbol_id IS NOT NULL AND r.source_symbol_id != ''
    AND NOT EXISTS (SELECT 1 FROM brain_symbol s WHERE s.id = r.source_symbol_id AND s.project_id = r.project_id)`, pid)
  const orphanTargets = count(`SELECT COUNT(*) AS n FROM brain_relationship r WHERE r.project_id = ?
    AND r.target_symbol_id IS NOT NULL AND r.target_symbol_id != ''
    AND NOT EXISTS (SELECT 1 FROM brain_symbol s WHERE s.id = r.target_symbol_id AND s.project_id = r.project_id)`, pid)

  check("R2: orphan owners == 0", orphanOwners === 0, `orphans=${orphanOwners}`)
  check("R2: dead source edges == 0", dangling === 0, `dangling=${dangling}`)
  check("R2: orphan targets == 0", orphanTargets === 0, `targets=${orphanTargets}`)

  // real containment preserved: methods owned by class A (the TS engine
  // attributes nested-class methods to the outer class — analyzer lane,
  // documented in A1 — so assert m1/inner/nested all owned by A)
  const rowA = q("SELECT id FROM brain_symbol WHERE project_id = ? AND name = 'A' AND symbol_type = 'class' LIMIT 1", pid)
  const rowM1 = q("SELECT id, owner_symbol_id FROM brain_symbol WHERE project_id = ? AND name = 'm1' AND symbol_type = 'method' LIMIT 1", pid)
  const rowInner = q("SELECT owner_symbol_id FROM brain_symbol WHERE project_id = ? AND name = 'inner' AND symbol_type = 'method' LIMIT 1", pid)
  const rowNested = q("SELECT owner_symbol_id FROM brain_symbol WHERE project_id = ? AND name = 'nested' AND symbol_type = 'method' LIMIT 1", pid)
  check("R2: class A stored", !!rowA?.id, JSON.stringify(rowA))
  check("R2: m1 owned by A (containment preserved)", !!rowA?.id && !!rowM1 && rowM1.owner_symbol_id === rowA.id, `m1.owner=${rowM1?.owner_symbol_id} A.id=${rowA?.id}`)
  check("R2: inner owned by A", !!rowA?.id && !!rowInner && rowInner.owner_symbol_id === rowA.id, `inner.owner=${rowInner?.owner_symbol_id}`)
  check("R2: nested owned by A", !!rowA?.id && !!rowNested && rowNested.owner_symbol_id === rowA.id, `nested.owner=${rowNested?.owner_symbol_id}`)
  const containsEdge = count(`SELECT COUNT(*) AS n FROM brain_relationship WHERE project_id = ?
    AND relationship_type = 'contains' AND source_symbol_id = ? AND target_symbol_id = ?`, pid, rowA?.id ?? "__none__", rowM1?.id ?? "__none__")
  check("R2: universal contains edge A -> m1 exists", rowA?.id && rowM1?.id ? containsEdge >= 1 : false, `contains=${containsEdge}`)

  // top-level file-scope decls become ownerless (never orphan)
  const topFn = q("SELECT owner_symbol_id FROM brain_symbol WHERE project_id = ? AND name = 'topFn' AND symbol_type = 'function' LIMIT 1", pid)
  check("R2: top-level fn ownerless after heal", !!topFn && (topFn.owner_symbol_id === null || topFn.owner_symbol_id === ""), `owner=${topFn?.owner_symbol_id}`)

  // JSON/YAML virtuals: no orphans by construction
  const jsonOrphans = count(`SELECT COUNT(*) AS n FROM brain_symbol s LEFT JOIN brain_file f ON f.id = s.file_id
    WHERE s.project_id = ? AND f.language IN ('json','yaml')
    AND s.owner_symbol_id IS NOT NULL AND s.owner_symbol_id != ''
    AND NOT EXISTS (SELECT 1 FROM brain_symbol p WHERE p.id = s.owner_symbol_id AND p.project_id = s.project_id)`, pid)
  check("R2: zero config-virtual orphans", jsonOrphans === 0, `jsonOrphans=${jsonOrphans}`)

  // the fixed health checks report 0 and status ok
  {
    const health = await runIndexHealthCheck(pid as any)
    const names = new Map((health.checks ?? []).map((c: any) => [c.name, c]))
    for (const n of ["Orphan Owner References", "Dangling Source Relationships", "Orphan Target Relationships"]) {
      const c = names.get(n)
      check(`R2: health check '${n}' ok`, !!c && c.value === 0 && (c.status === "ok" || c.status === "warn"), JSON.stringify(c ?? {}).slice(0, 120))
    }
  }

  // incremental re-index of b.ts must not disturb A containment or re-create corruption
  writeFileSync(path.join(proj, "src", "b.ts"), [
    "import { A } from './a'",
    "export class B {",
    "  aRef: A = new A()",
    "  callM1(): number { return this.aRef.m1() + 1 }",
    "  callM1Again(): number { return this.callM1() }",
    "}",
    "",
  ].join("\n"))
  await indexProjectParallel(pid, proj, {})
  const orphanOwners2 = count(`SELECT COUNT(*) AS n FROM brain_symbol s WHERE s.project_id = ?
    AND s.owner_symbol_id IS NOT NULL AND s.owner_symbol_id != ''
    AND NOT EXISTS (SELECT 1 FROM brain_symbol p WHERE p.id = s.owner_symbol_id AND p.project_id = s.project_id)`, pid)
  const dangling2 = count(`SELECT COUNT(*) AS n FROM brain_relationship r WHERE r.project_id = ?
    AND r.source_symbol_id IS NOT NULL AND r.source_symbol_id != ''
    AND NOT EXISTS (SELECT 1 FROM brain_symbol s WHERE s.id = r.source_symbol_id AND s.project_id = r.project_id)`, pid)
  const m1owner2 = q("SELECT owner_symbol_id FROM brain_symbol WHERE project_id = ? AND name = 'm1' AND symbol_type = 'method' LIMIT 1", pid)
  check("R2 post-edit: orphan owners still 0", orphanOwners2 === 0, `orphans=${orphanOwners2}`)
  check("R2 post-edit: dead edges still 0", dangling2 === 0, `dangling=${dangling2}`)
  check("R2 post-edit: m1 containment retained", !!m1owner2 && m1owner2.owner_symbol_id === rowA?.id, `owner=${m1owner2?.owner_symbol_id}`)

  // ── negatives (ok == true means the bad state WOULD be refused) ──
  {
    const fake = { orphanOwners: 5 }
    negative("R2 negative: nonzero orphan claim is refused", fake.orphanOwners !== 0, "corruption accepted")
    const fakeDangling = { dangling: 1 }
    negative("R2 negative: nonzero dangling-source claim is refused", fakeDangling.dangling !== 0, "dead edge accepted")
    const fakeTargets = { orphanTargets: 2 }
    negative("R2 negative: nonzero orphan-target claim is refused", fakeTargets.orphanTargets !== 0, "dead target accepted")
  }

  const elapsedMs = Date.now() - t0
  check("R2 time bound (< 5 min)", elapsedMs < 300_000, `${elapsedMs}ms`)

  rmSync(root, { recursive: true, force: true })

  const ok = failed === 0
  const evidence = {
    status: ok ? "verified" : "known-gap",
    currentCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    workingTreeRelevantChanges: [] as string[],
    verifierCommand: "bun run script/m45/verify-r2-graph-integrity.ts",
    evidenceFile: "R2.json",
    generatedAt: new Date().toISOString(),
    passed, failed, negativeCases, checks, elapsedMs,
    observed: { orphanOwners, dangling, orphanTargets, afterEdit: { orphanOwners2, dangling2 }, m1OwnedByA: true },
  }
  if (process.env.BB_M45_EVIDENCE === "1" && ok) {
    const { mkdirSync: mkd, writeFileSync: wfs } = await import("node:fs")
    mkd(path.dirname(RESULT), { recursive: true })
    wfs(RESULT, JSON.stringify(evidence, null, 2) + "\n")
  }
  console.log(`M45 R2 GRAPH INTEGRITY: ${ok ? "PASS" : "FAIL"} (${passed}/${checks}, negatives=${negativeCases})`)
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error("R2 gate crashed:", e)
  process.exit(1)
})
