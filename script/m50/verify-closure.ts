// script/m50/verify-closure.ts — M50.X1 (#767)
//
// Closure gate: refuses milestone close unless every subordinate + downstream
// gate passes RIGHT NOW (re-run live, never trusted from an evidence file) and
// the milestone's own real-index receipt holds on the current index.
//
// Honesty rules (M31/M35/M52/M54 pattern):
//  - evidence conformance is checked, but it can never substitute for a live run
//  - the real-index receipt is measured in this run, on the DB the shipped CLI
//    actually resolves, and asserts BOTH halves of every A2 claim:
//      * planner stats exist  AND  the traversal is fast (sqlite_stat1 present)
//      * blobs are promoted   AND  the JSON source of truth is intact
//      * guidance is current  AND  names no ghost tool
//  - the A4 human-session claim stays PENDING until a human performs it; the
//    closure gate reports that honestly instead of inventing an uplift
//  - any failure exits non-zero; nothing is excused

import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import { realpathSync } from "node:fs"
import { getProjectId } from "../../src/cli/index"
import { BrainDatabase } from "../../src/brain/database"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS = path.join(ROOT, "validation/m50/results")

let pass = 0
let failed = 0
const failures: string[] = []
const check = (name: string, ok: boolean, detail: string) => {
  if (ok) {
    pass++
    console.log(`  ok ${name}: ${detail}`)
  } else {
    failed++
    failures.push(`${name}: ${detail}`)
    console.log(`  FAIL ${name}: ${detail}`)
  }
}

// argv is passed through verbatim. (An earlier version built `npx run <script>`,
// which made npm exit non-zero without ever running the gate — a false failure
// this gate's own first run exposed. A runner that cannot distinguish "gate
// failed" from "gate never ran" is not a verifier.)
const runGate = (cmd: string, args: string[], label: string, timeoutMs = 900_000) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", timeout: timeoutMs })
  const combined = ((r.stdout ?? "") + (r.stderr ?? "")).trim()
  const tail = combined.split("\n").slice(-1).join(" ").slice(0, 180)
  const neverRan = /npm error|Missing script|not found/i.test(tail) && r.status !== 0
  return { ok: r.status === 0, detail: `${label}: exit=${r.status}${neverRan ? " (GATE DID NOT RUN)" : ""} ${tail}` }
}

console.log("M50.X1 closure gate")

// ── 1. the invariant, verbatim ─────────────────────────────────────────────
const INVARIANT =
  'No tool is called "adoptable" until a scripted agent loop picks it unprompted,\nand no fix lands without a measured before/after on the real index.'
{
  const raw = existsSync(path.join(ROOT, "docs/m50/PLAN.md")) ? readFileSync(path.join(ROOT, "docs/m50/PLAN.md"), "utf8") : ""
  // The invariant is quoted as a markdown blockquote in PLAN.md; compare the
  // sentence, not its formatting.
  const plan = raw.replace(/^\s*>\s?/gm, "")
  check("X1.plan-invariant", plan.includes(INVARIANT), plan.includes(INVARIANT) ? "invariant present verbatim in docs/m50/PLAN.md" : "invariant MISSING from PLAN")
}

// ── 2. live re-run of every subordinate gate ───────────────────────────────
const subordinate: Array<[string, string]> = [
  ["G1", "script/m50/verify-governance.ts"],
  ["A2-stats", "script/m50/verify-planner-stats.ts"],
  ["A2-aliases", "script/m50/verify-a2-param-aliases.ts"],
  ["A2-vector-blobs", "script/m50/verify-vector-blobs.ts"],
  ["A2-bounded", "script/m50/verify-a2-bounded-work.ts"],
  ["A2-test-sources", "script/m50/verify-a2-test-sources.ts"],
  ["A3", "script/m50/verify-a3-guidance-truth.ts"],
  ["A4", "script/m50/verify-a4-adoption.ts"],
  ["A5", "script/m50/verify-a5-verify-chain.ts"],
]
const live: Record<string, boolean> = {}
for (const [label, script] of subordinate) {
  const r = runGate("npx", ["tsx", script], label)
  live[label] = r.ok
  check(`X1.live-${label}`, r.ok, r.detail)
}

// ── 3. live re-run of the downstream gates this milestone touched ──────────
const downstream: Array<[string, string[]]> = [
  ["m13.ask-contract", ["npx", "tsx", "script/m13/verify-ask-contract.ts"]],
  ["m13.ask-provenance", ["npx", "tsx", "script/m13/verify-ask-provenance.ts"]],
  ["m21.embedding-queue", ["npx", "tsx", "script/m21/verify-embedding-queue.ts"]],
  ["m21.post-passes", ["bun", "run", "script/m21/verify-postprocessing-passes.ts"]],
  ["m33.man-page", ["npx", "tsx", "script/m33/verify-man-page.ts"]],
  ["m33.help-parity", ["npx", "tsx", "script/m33/verify-help-parity.ts"]],
  ["m40.post-entry", ["bun", "run", "script/m40/verify-a1-post-entry.ts"]],
  ["m48.h1-ghosts", ["bun", "run", "script/m48/verify-h1-ghosts.ts"]],
  ["m48.p4-param-matrix", ["bun", "run", "script/m48/verify-p4-param-matrix.ts"]],
  ["verify-embed", ["bun", "run", "script/verify-embed.ts"]],
  ["verify-semantic", ["bun", "run", "script/verify-semantic.ts"]],
  ["verify-contract-diff", ["npx", "tsx", "script/verify-contract-diff.ts"]],
  ["verify-tool-registry", ["npx", "tsx", "script/verify-tool-registry.ts"]],
]
const downstreamResults: Record<string, boolean> = {}
for (const [label, argv] of downstream) {
  const r = runGate(argv[0], argv.slice(1), label)
  downstreamResults[label] = r.ok
  check(`X1.downstream-${label}`, r.ok, r.detail)
}

// ── 4. evidence conformance (checked, never a substitute for a live run) ───
{
  const EVIDENCE = ["A1.json", "A2-planner-stats.json", "A2-vector-blobs.json", "A2-bounded-work.json", "A2-test-sources.json", "A2-residual.json", "A3.json", "A4.json", "A5.json"]
  for (const file of EVIDENCE) {
    const abs = path.join(RESULTS, file)
    if (!existsSync(abs)) {
      check(`X1.evidence-${file}`, false, "missing")
      continue
    }
    const ev = JSON.parse(readFileSync(abs, "utf8"))
    // A MEASUREMENT issue (A1) legitimately records failures — its convictions
    // ARE the failures it found. A `verified` delivery must record zero.
    const conformant = ev.status === "verified" ? (ev.failed ?? 0) === 0 : ev.status === "measured" && typeof ev.passed === "number"
    check(
      `X1.evidence-${file}`,
      conformant,
      `status=${ev.status} passed=${ev.passed} failed=${ev.failed} commit=${String(ev.commit).slice(0, 8)}`,
    )
  }
}

// ── 5. the A4 human session is declared, not invented ─────────────────────
{
  const a4 = JSON.parse(readFileSync(path.join(RESULTS, "A4.json"), "utf8"))
  const hs = a4.humanSession ?? {}
  check(
    "X1.a4-human-session-declared",
    hs.status === "pending" || (hs.status === "recorded" && hs.bbToolCalls > 0),
    `status=${hs.status} (a scripted gate measured the call SHAPES and guidance decidability; the unprompted-model claim stays pending until a human runs the session)`,
  )
}

// ── 6. real-index receipt, measured now on the DB the CLI resolves ────────
{
  try {
    const projectId = getProjectId(ROOT)
    const dbPath = BrainDatabase.getDbPath(projectId as any)
    check("X1.receipt-db-found", existsSync(dbPath), dbPath.replace(String(process.env.HOME ?? ""), "~"))
    const probe = spawnSync(
      "node",
      [
        "-e",
        `const Database = require(${JSON.stringify(path.join(ROOT, "node_modules/better-sqlite3"))});
         const db = new Database(${JSON.stringify(dbPath)}, { readonly: true });
         const stat = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_stat1'").get();
         const statRows = stat ? db.prepare('SELECT COUNT(*) c FROM sqlite_stat1').get().c : 0;
         const ownerIdx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='brain_symbol_owner_idx'").get();
         const dim = 2048;
         const blobRows = db.prepare("SELECT COUNT(*) c FROM brain_semantic_embedding WHERE embedding_blob IS NOT NULL AND length(embedding_blob) = vector_dimension * 4").get().c;
         const blobMissing = db.prepare("SELECT COUNT(*) c FROM brain_semantic_embedding WHERE embedding_blob IS NULL AND embedding_model != 'tfidf-v1'").get().c;
         const jsonRows = db.prepare("SELECT COUNT(*) c FROM brain_semantic_embedding WHERE embedding_vector IS NOT NULL AND embedding_vector != ''").get().c;
         const dim2048 = db.prepare("SELECT COUNT(*) c FROM brain_semantic_embedding WHERE vector_dimension = ?").get(dim).c;
         console.log(JSON.stringify({ statRows, ownerIdx: !!ownerIdx, blobRows, blobMissing, jsonRows, dim2048, dim }));
         db.close()`,
      ],
      { encoding: "utf8", cwd: ROOT, timeout: 120_000 },
    )
    const rec = JSON.parse((probe.stdout ?? "").trim().split("\n").pop() ?? "{}")
    check("X1.receipt-planner-stats", rec.statRows > 0, `sqlite_stat1 rows=${rec.statRows}`)
    check("X1.receipt-owner-index", rec.ownerIdx === true, "brain_symbol_owner_idx present (the index the planner must choose)")
    if (rec.dim2048 > 0) {
      check(
        "X1.receipt-blob-promotion",
        rec.blobMissing === 0,
        `dense rows with a correctly-sized blob=${rec.blobRows}, legacy rows still missing=${rec.blobMissing}`,
      )
    } else {
      check("X1.receipt-blob-promotion", true, "no 2048-dim embeddings on this index — promotion vacuously holds")
    }
    check("X1.receipt-json-source-of-truth", rec.jsonRows > 0, `JSON vectors preserved=${rec.jsonRows} (the blob column is an accelerator, never a replacement)`)
  } catch (e: any) {
    check("X1.receipt", false, e?.message ?? String(e))
  }
}

// ── 7. guidance on the real repo is current (the agent-facing artifact) ───
{
  const r = spawnSync("node", [path.resolve(ROOT, "bin/bb"), "onboard", ROOT, "--check"], { cwd: ROOT, encoding: "utf8", timeout: 60_000 })
  check("X1.receipt-guidance-current", r.status === 0, ((r.stdout ?? "") + (r.stderr ?? "")).trim().slice(0, 160))
}

// ── stamp ──────────────────────────────────────────────────────────────────
{
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  mkdirSync(RESULTS, { recursive: true })
  writeFileSync(
    path.join(RESULTS, "X1.json"),
    JSON.stringify(
      {
        gate: "M50.X1",
        issue: 767,
        milestone: "M50",
        at: new Date().toISOString(),
        commit,
        checks: pass + failed,
        passed: pass,
        failed,
        verifierCommand: "npx tsx script/m50/verify-closure.ts",
        status: failed === 0 ? "verified" : "known-gap",
        invariant: "milestone invariant present verbatim in docs/m50/PLAN.md",
        subordinate: live,
        downstream: downstreamResults,
        receipts: { projectIdSha1Prefix: createHash("sha1").update(realpathSync(ROOT)).digest("hex").slice(0, 8) },
      },
      null,
      2,
    ) + "\n",
  )
}

console.log(`\n=== M50.X1 CLOSURE: ${pass} pass, ${failed} fail ===`)
if (failed > 0) {
  console.log(failures.map((f) => `  ✗ ${f}`).join("\n"))
  process.exit(1)
}
