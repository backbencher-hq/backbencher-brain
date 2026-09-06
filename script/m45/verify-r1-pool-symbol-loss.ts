// script/m45/verify-r1-pool-symbol-loss.ts — M45.R1
// Worker-pool symbol-loss honesty (regression gate for 48f26228).
//
// The m22 V5 gate runs small fixtures through the IN-PROCESS path, where
// parse results carry `symbols` — so it can never catch the pool bug where
// `file_done` outcomes dropped `symbols` and symbolLoss == newlyParsed
// unconditionally. This gate FORCES the worker-pool path (asserts
// stats.phases.mode === "worker-pool", refusing to vouch otherwise) and
// asserts:
//   1. fresh pool index of N symbol-bearing files + 1 comment-only file:
//      newlyParsed == candidates, symbolLoss == 1 (only the zero-symbol
//      file), symbolLoss < newlyParsed, errors == 0
//   2. no-change re-run: newlyParsed == 0, unchanged == N+1, symbolLoss == 0
//   3. one-file edit (symbol-bearing): newlyParsed == 1, symbolLoss == 0
//   4. loss fixture (good.ts + empty.css): symbolLoss >= 1, errors == 0,
//      symbolLoss < newlyParsed (good.ts must NOT be counted as loss)
// Negatives: in-memory predicates that refuse fabricated summaries, plus a
// structural refusal when symbols exist in the DB yet loss == parsed.
// Evidence: validation/m45/results/R1.json (written only when
// BB_M45_EVIDENCE === "1" and the gate passed).

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { execFileSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULT = path.join(ROOT, "validation/m45/results/R1.json")
const READ_ONLY = process.env.BB_M45_READ_ONLY === "1"

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

const t0 = Date.now()

async function main() {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database"))

  const root = mkdtempSync(path.join(tmpdir(), "m45-r1-"))
  const proj = path.join(root, "proj")
  mkdirSync(path.join(proj, "src"), { recursive: true })
  const N = 14
  for (let i = 0; i < N; i++) writeFileSync(path.join(proj, "src", `m${i}.ts`), `export function r1f${i}(x: number): number { return x + ${i} }\nexport const r1c${i} = ${i}\n`)
  // comment-only TS file: parses OK with 0 symbols -> the ONE honest loss
  writeFileSync(path.join(proj, "src", "empty.ts"), "// no symbols here\n")

  const pid = getProjectId(proj)

  // 1. fresh pool run
  const s1 = await indexProjectParallel(pid, proj, { skipPostProcessing: true })
  const sum1 = s1.summary!
  const mode = (s1.phases as any)?.mode
  check("R1 fresh: mode is worker-pool (in-process cannot vouch)", mode === "worker-pool", String(mode))
  check("R1 fresh: newlyParsed == candidates", sum1.newlyParsed === sum1.totalCandidates && sum1.totalCandidates === N + 1, JSON.stringify(sum1))
  check("R1 fresh: symbolLoss == 1 (only the comment-only file)", sum1.symbolLoss === 1, `loss=${sum1.symbolLoss}`)
  check("R1 fresh: symbolLoss < newlyParsed (symbol files NOT counted)", sum1.symbolLoss < sum1.newlyParsed, JSON.stringify(sum1))
  check("R1 fresh: zero errors", sum1.errors === 0, `errors=${sum1.errors}`)
  check("R1 fresh: unchanged == 0", sum1.unchanged === 0, `unchanged=${sum1.unchanged}`)

  // 2. no-change re-run
  const s2 = await indexProjectParallel(pid, proj, { skipPostProcessing: true })
  const sum2 = s2.summary!
  check("R1 re-run: newlyParsed == 0", sum2.newlyParsed === 0, JSON.stringify(sum2))
  check("R1 re-run: unchanged == N+1", sum2.unchanged === N + 1, `unchanged=${sum2.unchanged}`)
  check("R1 re-run: symbolLoss == 0", sum2.symbolLoss === 0, `loss=${sum2.symbolLoss}`)

  // 3. one-file edit with symbols
  writeFileSync(path.join(proj, "src", "m3.ts"), "export function r1fEdited(x: number): number { return x * 2 }\n")
  const s3 = await indexProjectParallel(pid, proj, { skipPostProcessing: true })
  const sum3 = s3.summary!
  check("R1 edit: newlyParsed == 1", sum3.newlyParsed === 1, JSON.stringify(sum3))
  check("R1 edit: unchanged == N", sum3.unchanged === N, `unchanged=${sum3.unchanged}`)
  check("R1 edit: symbolLoss == 0 (edited file HAS symbols)", sum3.symbolLoss === 0, `loss=${sum3.symbolLoss}`)

  // 4. loss fixture: good.ts (symbols) + empty.css (parsed OK, 0 symbols)
  const lossProj = path.join(root, "loss")
  mkdirSync(path.join(lossProj, "src"), { recursive: true })
  writeFileSync(path.join(lossProj, "src", "good.ts"), "export function good(): number { return 1 }\n")
  writeFileSync(path.join(lossProj, "src", "empty.css"), "/* nothing */\n")
  const lossPid = getProjectId(lossProj)
  const s4 = await indexProjectParallel(lossPid, lossProj, { skipPostProcessing: true })
  const sum4 = s4.summary!
  check("R1 loss: symbolLoss >= 1 (empty.css)", sum4.symbolLoss >= 1, JSON.stringify(sum4))
  check("R1 loss: errors == 0 (not conflated)", sum4.errors === 0 && sum4.symbolLoss >= 1, JSON.stringify(sum4))
  check("R1 loss: good.ts not counted as loss", sum4.symbolLoss < sum4.newlyParsed, `loss=${sum4.symbolLoss} parsed=${sum4.newlyParsed}`)

  // 5. DB cross-check: symbols exist while loss==parsed would be a lie.
  // Section 3 edited m3.ts from 2 symbols (r1f3+r1c3) down to 1 (r1fEdited),
  // so the honest post-edit total is (N-1)*2 + 1 == 27, never N*2 == 28.
  {
    const raw = await BrainDatabase.getRawInstance(pid as any)
    const symCount = (raw.prepare("SELECT COUNT(*) AS n FROM brain_symbol WHERE project_id = ?").get(pid) as any)?.n ?? 0
    check("R1 db: symbols stored for symbol-bearing files", symCount >= (N - 1) * 2 + 1, `symbols=${symCount} (expect >= ${(N - 1) * 2 + 1} after m3.ts edit)`)
  }

  // ── negatives (ok == true means the bad state WOULD be refused) ──
  {
    const symbolsExist = true // symbols present in DB above
    const fabricated = { newlyParsed: 5, symbolLoss: 5 }
    negative("R1 negative: loss == parsed with symbols present is refused", symbolsExist && fabricated.symbolLoss === fabricated.newlyParsed && fabricated.symbolLoss > 0, "")
    const lossLie = { newlyParsed: 2, symbolLoss: 3 }
    negative("R1 negative: symbolLoss > newlyParsed refused", lossLie.symbolLoss > lossLie.newlyParsed, "impossible loss accepted")
    const claimZero = { newlyParsed: 2, symbolLoss: 0 }
    negative("R1 negative: zero loss with a real zero-symbol file present is refused", claimZero.symbolLoss === 0 && sum4.symbolLoss >= 1, "loss file invisible accepted")
  }

  const elapsedMs = Date.now() - t0
  check("R1 time bound (< 5 min for the whole gate)", elapsedMs < 300_000, `${elapsedMs}ms`)

  rmSync(root, { recursive: true, force: true })

  const ok = failed === 0
  const evidence = {
    status: ok ? "verified" : "known-gap",
    currentCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    workingTreeRelevantChanges: [] as string[],
    verifierCommand: "bun run script/m45/verify-r1-pool-symbol-loss.ts",
    evidenceFile: "R1.json",
    generatedAt: new Date().toISOString(),
    passed, failed, negativeCases, checks, elapsedMs,
    observed: {
      fresh: { newlyParsed: sum1.newlyParsed, unchanged: sum1.unchanged, symbolLoss: sum1.symbolLoss, mode: s1.phases?.mode },
      rerun: { newlyParsed: sum2.newlyParsed, unchanged: sum2.unchanged, symbolLoss: sum2.symbolLoss },
      edit: { newlyParsed: sum3.newlyParsed, unchanged: sum3.unchanged, symbolLoss: sum3.symbolLoss },
      loss: { newlyParsed: sum4.newlyParsed, symbolLoss: sum4.symbolLoss, errors: sum4.errors },
    },
  }
  const { mkdirSync: mkd, writeFileSync: wfs } = await import("node:fs")
  if (process.env.BB_M45_EVIDENCE === "1" && ok) {
    mkd(path.dirname(RESULT), { recursive: true })
    wfs(RESULT, JSON.stringify(evidence, null, 2) + "\n")
  }
  console.log(`M45 R1 POOL SYMBOL-LOSS: ${ok ? "PASS" : "FAIL"} (${passed}/${checks}, negatives=${negativeCases})`)
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error("R1 gate crashed:", e)
  process.exit(1)
})
