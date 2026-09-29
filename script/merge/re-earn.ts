// script/merge/re-earn.ts — the re-earn wave a merge owes its ledger.
//
// A merge commit changes tracked inputs for lanes on BOTH sides, so the records
// whose numbers were earned on one parent line are stale at the merge — no seal
// can fix that (a seal verifies INTEGRITY, not freshness). This repository's own
// answer, used after every tracked-input change (the M29 R3 digest waves), is to
// RE-RUN the affected gates at the new HEAD and let them write their own fresh,
// sealed records. This driver does that for the ledger a merge leaves behind:
//
//   reviews/merge/<date>-<slug>-re-earn-ledger.json   (input: what was taken)
//   reviews/merge/<date>-<slug>-re-earn-wave.json     (output: what was re-run)
//
// Discipline it keeps, deliberately:
//   - it runs the command the RECORD ITSELF declares (`verifierCommand`), never
//     a command chosen here to make a number agree; a record with no declared
//     verifier is listed as un-earnable-by-this-driver, not skipped silently;
//   - it never edits an evidence file: the gate writes it;
//   - it re-verifies each record's seal AND its pin afterwards, so the wave
//     output says whether the record now names THIS HEAD and verifies — the two
//     facts a reader needs, separately;
//   - a red gate is recorded as red. A wave that hides its reds is the defect
//     this milestone class exists to kill.
//
// Run: npx tsx script/merge/re-earn.ts <ledger.json> [--only <substring>] [--timeout <seconds>]
// At a CLEAN checkout of the commit being re-earned (the pins must name it).

import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..", "..")
const SEAL_KEY = "bbSeal"

type LedgerRecord = {
  path: string
  conflictKind: "stamp-only" | "semantic"
  resolvedTo: string
  sealOfTakenSide: string
  verifier: string | null
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex")
}

/** Integrity + freshness of one evidence record, recomputed here rather than
 *  read from the record: the seal covers the content minus the seal key, and
 *  freshness is the record's own pin against the commit being re-earned. */
function inspect(relPath: string, head: string): {
  exists: boolean
  sealed: boolean
  sealValid: boolean
  pinnedCommit: string | null
  pinnedAtHead: boolean
  note?: string
} {
  const abs = path.join(ROOT, relPath)
  if (!existsSync(abs)) return { exists: false, sealed: false, sealValid: false, pinnedCommit: null, pinnedAtHead: false, note: "record absent after the run" }
  let record: Record<string, unknown>
  try {
    record = JSON.parse(readFileSync(abs, "utf8")) as Record<string, unknown>
  } catch (e) {
    return { exists: true, sealed: false, sealValid: false, pinnedCommit: null, pinnedAtHead: false, note: `unparseable: ${(e as Error).message}` }
  }
  const seal = record[SEAL_KEY] as { alg?: string; contentSha256?: string } | undefined
  const { [SEAL_KEY]: _drop, ...rest } = record
  const sealed = seal !== undefined
  const sealValid = sealed && seal!.alg === "sha256" && seal!.contentSha256 === sha256(JSON.stringify(rest))
  const pin = (record.currentCommit ?? record.commit ?? record.at ?? null) as string | null
  const pinnedCommit = typeof pin === "string" ? pin : null
  return { exists: true, sealed, sealValid, pinnedCommit, pinnedAtHead: pinnedCommit !== null && head.startsWith(pinnedCommit.slice(0, 8)) }
}

function main(): number {
  const args = process.argv.slice(2)
  const ledgerPath = args.find((a) => !a.startsWith("--"))
  if (!ledgerPath) {
    console.error("usage: npx tsx script/merge/re-earn.ts <ledger.json> [--only <substring>] [--timeout <seconds>]")
    return 2
  }
  const onlyIdx = args.indexOf("--only")
  const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null
  const timeoutIdx = args.indexOf("--timeout")
  const timeoutMs = (timeoutIdx >= 0 ? Number(args[timeoutIdx + 1]) : 900) * 1000

  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).trim()
  if (dirty.length > 0) {
    console.error("refusing to run a re-earn wave in a dirty checkout: the pins would name this commit while the tree is not it")
    console.error(dirty.split("\n").slice(0, 10).join("\n"))
    return 3
  }

  const ledger = JSON.parse(readFileSync(path.join(ROOT, ledgerPath), "utf8")) as {
    merge: Record<string, unknown>
    counts: Record<string, number>
    records: LedgerRecord[]
  }
  const targets = ledger.records.filter((r) => (only ? r.path.includes(only) || (r.verifier ?? "").includes(only) : true))

  console.log(`re-earn wave at ${head.slice(0, 8)} — ${targets.length} ledger records, ${targets.filter((r) => r.verifier).length} with a declared verifier`)
  const results: Array<Record<string, unknown>> = []
  const ranCommands = new Map<string, { exitCode: number | null; outputTail: string }>()

  for (const rec of targets) {
    const before = inspect(rec.path, head)
    const entry: Record<string, unknown> = {
      path: rec.path,
      conflictKind: rec.conflictKind,
      verifier: rec.verifier,
      before: { sealValid: before.sealValid, pinnedAtHead: before.pinnedAtHead, pinnedCommit: before.pinnedCommit },
    }
    if (!rec.verifier) {
      entry.outcome = "no declared verifier — this driver will not invent one; the owning lane must re-earn it"
      entry.after = inspect(rec.path, head)
      results.push(entry)
      continue
    }
    if (!ranCommands.has(rec.verifier)) {
      const started = Date.now()
      const proc = spawnSync(rec.verifier, { cwd: ROOT, shell: true, timeout: timeoutMs, encoding: "utf8" })
      const out = `${proc.stdout ?? ""}${proc.stderr ?? ""}`
      ranCommands.set(rec.verifier, { exitCode: proc.status, outputTail: out.slice(-1200) })
      entry.commandSeconds = Math.round((Date.now() - started) / 100) / 10
      entry.timedOut = proc.error?.name === "Error" && /ETIMEDOUT|timed out/i.test(String(proc.error?.message))
    } else {
      entry.reusedEarlierRun = true
    }
    const run = ranCommands.get(rec.verifier)!
    entry.exitCode = run.exitCode
    entry.outputTail = run.outputTail
    entry.after = inspect(rec.path, head)
    entry.outcome =
      run.exitCode === 0 && (entry.after as { sealValid: boolean }).sealValid && (entry.after as { pinnedAtHead: boolean }).pinnedAtHead
        ? "re-earned (green, sealed, pinned at this commit)"
        : run.exitCode !== 0
          ? "GATE RED — record NOT re-earned"
          : !(entry.after as { sealValid: boolean }).sealValid
            ? "run green but the record is not sealed by this run"
            : "run green and sealed, but the record's pin does not name this commit"
    console.log(`  ${String(entry.outcome).padEnd(58)} ${rec.path}${rec.verifier ? `  [${rec.verifier}]` : ""}`)
    results.push(entry)
  }

  const summary = {
    ranAt: new Date().toISOString(),
    head,
    ledger: ledgerPath,
    ledgerMerge: ledger.merge,
    counts: {
      records: results.length,
      withVerifier: results.filter((r) => r.verifier).length,
      distinctCommands: ranCommands.size,
      commandsGreen: [...ranCommands.values()].filter((v) => v.exitCode === 0).length,
      commandsRed: [...ranCommands.values()].filter((v) => v.exitCode !== 0).length,
      reEarned: results.filter((r) => r.outcome === "re-earned (green, sealed, pinned at this commit)").length,
      stillStale: results.filter((r) => String(r.outcome).startsWith("run green") || String(r.outcome).startsWith("no declared")).length,
      red: results.filter((r) => r.outcome === "GATE RED — record NOT re-earned").length,
    },
    commands: [...ranCommands.entries()].map(([command, v]) => ({ command, exitCode: v.exitCode, outputTail: v.outputTail })),
    results,
  }
  const outPath = path.join(ROOT, path.dirname(ledgerPath), path.basename(ledgerPath).replace(/-ledger\.json$/, "-wave.json"))
  writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`)
  console.log(`\nwave record: ${path.relative(ROOT, outPath)}`)
  console.log(JSON.stringify(summary.counts, null, 2))
  return summary.counts.red > 0 ? 1 : 0
}

process.exitCode = main()
