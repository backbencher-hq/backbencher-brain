/**
 * POWERSHELL — THE CLAIM-REFUTATION CENSUS.
 *
 * ## WHAT THIS MEASURES, AND WHY THE GATE CANNOT
 *
 * The incoming gate reports `extFAIL` — the rows where **the arbiter** finds the analyzer's claim
 * false. It reads a claim from an EXPLICIT key list (`EXTERNAL_KEYS`, `script/m14/incoming-rule.ts`).
 * The powershell analyzer publishes its externality reading under TWO keys:
 *
 *   `isExternalTarget`  the arbiter-readable spelling PS38 added;
 *   `externalTarget`    the original spelling, which is NOT in `EXTERNAL_KEYS`.
 *
 * PS38 publishes `isExternalTarget` only where the arbiter's question is one the target's own
 * spelling settles (`arbiterCanCheckOwner`), and it leaves `externalTarget` published everywhere
 * the reading fires. **So there are rows the analyzer marks with a claim the arbiter CANNOT SEE,
 * and a false claim among them does not reach `extFAIL` at all.** The gate reads 0 refuted on
 * such a row; the row is simply unresolved.
 *
 * This census asks the question the gate structurally cannot: **for every row the analyzer
 * publishes a claim on, what does the ARBITER'S OWN RULE say about that claim?** It answers with
 * `verifyExternalClaim` — imported from `script/m14/incoming-rule.ts`, never copied, because a copy
 * of a counting rule is a second rule — and with the PROJECT'S OWN admitted file list, built the
 * way `projectFactsForFiles` (incoming-gate.ts:573) builds it.
 *
 * ## WHAT IT REPORTS
 *
 *   marked        rows the analyzer publishes a claim on (`externalTarget: true`);
 *   verified      the arbiter's rule says the claim is TRUE (the project declares no such owner);
 *   unverified    the arbiter's rule cannot reach the question (a path, a URI, a bare owner);
 *   REFUTED       the arbiter's rule says the claim is FALSE — **the analyzer's own claim is a lie**;
 *   invisible     of the refuted rows, how many the ARBITER CAN SEE (i.e. would reach `extFAIL`);
 *   hidden        the rest — the false claims the gate can never count against the lane.
 *
 * ## THE SCOPE
 *
 *   whole         the whole admitted population (the gate's own discovery: git checkouts under the
 *                 corpus root, `git ls-files`, the lane's admitted extensions, the 1 MB size cap);
 *   --files F     a comma-separated list of repo-relative paths, for a bounded run;
 *   --out FILE    write the JSON.
 *
 * A run over named files is a probe, not a population, and the report says which it was.
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { verifyExternalClaim, isMarkedExternal, type ProjectFacts } from "../../../../script/m14/incoming-rule"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const ADMITTED = ["ps1", "psm1", "psd1"]
const SIZE_CAP = 1024 * 1024

const argv = process.argv.slice(2)
const outIdx = argv.indexOf("--out")
const OUT = outIdx >= 0 ? argv[outIdx + 1] : null
const filesIdx = argv.indexOf("--files")
const NAMED = filesIdx >= 0 ? (argv[filesIdx + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean) : null

/** THE ADMITTED FILES OF ONE REPO, repo-relative — the arbiter's suffix match needs this spelling. */
function admittedFilesOf(repo: string): Set<string> {
  const out = new Set<string>()
  let tracked: string
  try {
    tracked = execFileSync("git", ["-C", path.join(CR, repo), "ls-files"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    })
  } catch {
    return out
  }
  for (const rel of tracked.split("\n")) {
    if (!rel) continue
    const low = rel.toLowerCase()
    if (!ADMITTED.some((e) => low.endsWith(`.${e}`))) continue
    const abs = path.join(CR, repo, rel)
    try {
      if (existsSync(abs) && readFileSync(abs).length >= 0) {
        const st = execFileSync("stat", ["-c", "%s", abs], { encoding: "utf8" })
        if (Number(st.trim()) > SIZE_CAP) continue
        out.add(rel.split(path.sep).join("/"))
      }
    } catch {
      /* absent from the working tree — the gate counts these as `absent` and excludes them */
    }
  }
  return out
}

type Refuted = {
  repo: string
  file: string
  line: number
  type: string
  target: string
  arbiterCanSee: boolean
  via: string
}

async function main(): Promise<void> {
  const targets: Array<[string, string]> = []
  if (NAMED) {
    for (const s of NAMED) {
      const i = s.indexOf("/")
      if (i <= 0) continue
      targets.push([s.slice(0, i), s.slice(i + 1)])
    }
  } else {
    const repos = execFileSync("ls", [CR], { encoding: "utf8" }).split("\n").filter(Boolean).sort()
    for (const repo of repos) {
      const dir = path.join(CR, repo)
      let tracked: string
      try {
        tracked = execFileSync("git", ["-C", dir, "ls-files"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      } catch {
        continue
      }
      for (const rel of tracked.split("\n")) {
        const low = rel.toLowerCase()
        if (rel && ADMITTED.some((e) => low.endsWith(`.${e}`))) targets.push([repo, rel])
      }
    }
  }

  const factsByRepo = new Map<string, ProjectFacts>()
  const refuted: Refuted[] = []
  const tally = { marked: 0, verified: 0, unverified: 0, refuted: 0, refutedVisible: 0, refutedHidden: 0 }
  let failures = 0
  let parsed = 0

  for (const [repo, rel] of targets) {
    const abs = path.join(CR, repo, rel)
    if (!existsSync(abs)) continue
    let facts = factsByRepo.get(repo)
    if (!facts) {
      facts = { packages: new Set<string>(), files: admittedFilesOf(repo), sdkLib: false }
      factsByRepo.set(repo, facts)
    }
    let res: Awaited<ReturnType<typeof parseFile>>
    try {
      res = await parseFile(abs, path.join(CR, repo))
    } catch (e) {
      failures++
      process.stderr.write(`SHARD FAILURE ${repo}/${rel}: ${String(e)}\n`)
      continue
    }
    parsed++
    const declCount = new Map<string, number>()
    for (const s of res.symbols ?? []) {
      const n = String(s.name ?? "")
      if (!n) continue
      declCount.set(n, (declCount.get(n) ?? 0) + 1)
    }
    for (const r of res.relationships ?? []) {
      const md = (r.metadata ?? {}) as Record<string, unknown>
      // THE ANALYZER'S OWN CLAIM — the reading it publishes, in EITHER spelling. This is the
      // question the gate cannot ask, because the gate reads only the arbiter-readable key.
      if (md.externalTarget !== true && md.isExternalTarget !== true) continue
      const target = String(r.target ?? "")
      if (!target) continue
      tally.marked++
      const outcome = verifyExternalClaim(declCount, target, facts)
      if (outcome === "externalVerified") { tally.verified++; continue }
      if (outcome === "externalUnverified") { tally.unverified++; continue }
      if (outcome !== "externalRefuted") { tally.unverified++; continue }
      tally.refuted++
      const visible = isMarkedExternal(md)
      if (visible) tally.refutedVisible++
      else tally.refutedHidden++
      refuted.push({
        repo, file: rel, line: Number(r.line_number ?? 0), type: String(r.type ?? ""),
        target, arbiterCanSee: visible, via: String(md.externalVia ?? "-"),
      })
    }
  }

  console.log(`census: ${NAMED ? "NAMED files" : "WHOLE admitted population"} · root ${CR}`)
  console.log(`files parsed: ${parsed} · parse failures: ${failures}`)
  console.log(`rows the analyzer publishes a claim on: ${tally.marked}`)
  console.log(`  the arbiter's rule says VERIFIED   (the claim is true): ${tally.verified}`)
  console.log(`  the arbiter's rule says UNVERIFIED (the claim is unreachable): ${tally.unverified}`)
  console.log(`  the arbiter's rule says REFUTED    (THE ANALYZER'S CLAIM IS FALSE): ${tally.refuted}`)
  console.log(`     of which the ARBITER CAN SEE (would reach extFAIL): ${tally.refutedVisible}`)
  console.log(`     of which the arbiter CANNOT see (hidden from the gate): ${tally.refutedHidden}`)
  console.log("")
  for (const r of refuted) {
    console.log(`  REFUTED ${r.repo}/${r.file}:${r.line}  ${r.type} -> ${JSON.stringify(r.target)}` +
      `  via=${r.via}  arbiterCanSee=${r.arbiterCanSee}`)
  }
  if (OUT) {
    writeFileSync(OUT, JSON.stringify({ root: CR, scope: NAMED ? "named" : "whole", parsed, failures, tally, refuted }, null, 1))
    console.log(`\nwrote ${OUT}`)
  }
}

await main()
