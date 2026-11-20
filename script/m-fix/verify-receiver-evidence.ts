// ─────────────────────────────────────────────────────────────────────────────
// Gate — P1-3 completion: receiver evidence + validated test_impact.
//
// RED on the pre-fix bytes: a selector call (`m.Lock()` on a sync.Mutex) that the
// name resolver bound to a project method was published as test evidence/impact
// (`receiver-selector-unresolved` at best, false impact at worst). GREEN: the
// receiver is proven from the TEST FILE's own declarations (hash-gated), so an
// external receiver is rejected as `external-stdlib-leaf` and a project receiver
// whose type declares the method is validated — and test_impact applies the same
// contract, counting/excluding unvalidated caller edges.
//
// RUN — BB_DATA_DIR=$PWD/.tools/triage-fix/receiver-evidence/bbdata npx tsx script/m-fix/verify-receiver-evidence.ts
// ─────────────────────────────────────────────────────────────────────────────
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

let checks = 0
let failures = 0
function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) {
    console.log(`  ok: ${label}`)
  } else {
    failures++
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

const scratch = mkdtempSync(path.join(tmpdir(), "bb-receiver-"))
process.env.BB_CONFIG_FILE = path.join(scratch, "config.json")
writeFileSync(process.env.BB_CONFIG_FILE, "{}")

async function main(): Promise<void> {
  const root = path.join(scratch, "project")
  mkdirSync(path.join(root, "app"), { recursive: true })
  writeFileSync(path.join(root, "go.mod"), "module example.com/rx\n\ngo 1.21\n")
  writeFileSync(path.join(root, "app", "app.go"), `package app

import "sync"

type Worker struct{}

func (w *Worker) Run() {}

func (w *Worker) Lock() {}

type Holder struct {
	M sync.Mutex
	W *Worker
}

func (h *Holder) Touch() {}
`)
  writeFileSync(path.join(root, "app", "app_test.go"), `package app

import (
	"sync"
	"testing"
)

func TestLocal(t *testing.T) {
	var m sync.Mutex
	m.Lock() // external receiver: NOT evidence for Worker.Lock
	h := &Holder{}
	h.M.Lock() // 3-segment chain ending at an external type: NOT evidence
	w := &Worker{}
	w.Run() // project receiver: genuine evidence
	h.W.Run() // project chain: genuine evidence
}
`)
  const { getProjectId } = await import("../../src/cli/index")
  const { indexProjectParallel } = await import("../../src/ast/parallel-indexer")
  const { testMapping, testImpact } = await import("../../src/intelligence/testing/test-intel")
  const projectId = getProjectId(root) as any
  await indexProjectParallel(projectId, root, {} as any)

  // Write side: a selector call whose receiver type is declared in the calling
  // file is BOUND at index time (previously these stayed unresolved, so genuine
  // project-receiver calls were invisible test evidence).
  const { BrainDatabase } = await import("../../src/brain/database")
  const raw: any = await BrainDatabase.getRawInstance(projectId)
  const rows = raw.prepare(
    "SELECT json_extract(metadata,'$.callExpression') ce, target_symbol_id tid, json_extract(metadata,'$.bindingBasis') bb " +
      "FROM brain_relationship WHERE project_id=? AND relationship_type='calls'",
  ).all(projectId) as any[]
  const writeSide = new Map(rows.map((r) => [String(r.ce), r]))
  check("WRITE: `w.Run()` is resolved through the declared receiver type",
    !!writeSide.get("w.Run")?.tid && writeSide.get("w.Run")?.bb === "receiver-type", JSON.stringify(writeSide.get("w.Run")))
  check("WRITE: `h.W.Run()` resolves through the declared field chain",
    !!writeSide.get("h.W.Run")?.tid && writeSide.get("h.W.Run")?.bb === "receiver-type", JSON.stringify(writeSide.get("h.W.Run")))
  check("WRITE: external receivers are NOT bound (`m.Lock`, `h.M.Lock` stay unresolved)",
    !writeSide.get("m.Lock")?.tid && !writeSide.get("h.M.Lock")?.tid, JSON.stringify([writeSide.get("m.Lock"), writeSide.get("h.M.Lock")]))

  // Simulate an OLD/stale index name-binding: the resolver used to bind the leaf
  // `Lock` to the project method despite the receiver being sync.Mutex. The read
  // side must reject that row using the receiver evidence, not trust the target.
  const lockTarget = raw.prepare("SELECT id FROM brain_symbol WHERE project_id=? AND name='Lock' AND symbol_type='method' LIMIT 1").get(projectId) as any
  raw.prepare("UPDATE brain_relationship SET target_symbol_id=?, confidence=0.8 WHERE project_id=? AND json_extract(metadata,'$.callExpression') IN ('m.Lock','h.M.Lock','m.Lock()','h.M.Lock()')")
    .run(lockTarget.id, projectId)
  const forged = raw.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE project_id=? AND target_symbol_id IS NOT NULL AND json_extract(metadata,'$.callExpression') LIKE '%Lock'").get(projectId) as any
  check("SETUP: old-index misbinding simulated (Lock rows carry the project method target)", Number(forged.c) >= 2, String(forged.c))

  const mapping = await testMapping(projectId, {} as any)
  const linksTo = (target: string) => mapping.entries.filter((e) => e.name === target).flatMap((e) => e.links ?? [])
  const runLinks = linksTo("Run")
  const lockLinks = linksTo("Lock")
  const md = mapping as any
  const reasons = md.summary?.unvalidatedByReason ?? {}
  check("GREEN: project-typed receiver validates the call as test evidence (Worker.Run)",
    runLinks.some((l: any) => l.evidence === "direct_call" && l.testFile.endsWith("app_test.go")),
    JSON.stringify(runLinks.map((l: any) => [l.evidence, l.testFile])))
  check("READ: a stale/name-bound external receiver is rejected as external-stdlib-leaf",
    (reasons["external-stdlib-leaf"] ?? 0) >= 2, JSON.stringify(reasons))
  check("READ: neither external-receiver row becomes evidence for Worker.Lock",
    lockLinks.length === 0 && (md.summary?.unvalidatedLinks ?? 0) >= 2,
    JSON.stringify({ lockLinks: lockLinks.length, unvalidated: md.summary?.unvalidatedLinks, reasons }))

  // test_impact must apply the same contract: the false Lock rows are excluded and
  // DECLARED, while the genuine Run rows are impact.
  const falseImpact = await testImpact(projectId, "Lock", {} as any)
  check("test_impact: a false selector edge is not published as test impact",
    falseImpact.directTests.length + falseImpact.indirectTests.length === 0,
    JSON.stringify({ direct: falseImpact.directTests.length, indirect: falseImpact.indirectTests.length }))
  check("test_impact: unvalidated caller edges are counted and declared",
    (falseImpact.summary as any)?.unvalidatedLinks >= 2 &&
      falseImpact.provenance.unknowns.some((u) => /unvalidated-test-links/.test(u)),
    JSON.stringify({ summary: falseImpact.summary, unknowns: falseImpact.provenance.unknowns }))
  const realImpact = await testImpact(projectId, "Run", {} as any)
  check("control: a genuine receiver-validated edge IS published as test impact",
    realImpact.directTests.length + realImpact.indirectTests.length >= 1 &&
      !((realImpact.summary as any)?.unvalidatedLinks > 0),
    JSON.stringify({ direct: realImpact.directTests.length, indirect: realImpact.indirectTests.length, summary: realImpact.summary }))

  // Hash gate: a source file edited AFTER indexing must NOT produce receiver
  // evidence (the call line still comes from the index; the source is unproven).
  writeFileSync(path.join(root, "app", "app_test.go"), "package app\n\nimport \"testing\"\n\nfunc TestLocal(t *testing.T) {}\n")
  const staleMapping = await testMapping(projectId, {} as any)
  const staleRun = staleMapping.entries.filter((e) => e.name === "Run").flatMap((e) => e.links ?? [])
  check("stale-source control: mutated test file yields no receiver evidence (fails closed)",
    staleRun.length === 0 || staleRun.every((l: any) => l.testFile !== "app/app_test.go"),
    JSON.stringify(staleRun.map((l: any) => [l.evidence, l.testFile])))
}

try {
  await main()
} catch (error) {
  failures++
  console.log(`  FAIL: gate crashed — ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}

console.log(failures === 0 ? `\nRECEIVER EVIDENCE: VERIFIED (${checks} checks)` : `\nRECEIVER EVIDENCE: ${failures} FAILURE(S) of ${checks}`)
process.exit(failures > 0 ? 1 : 0)
