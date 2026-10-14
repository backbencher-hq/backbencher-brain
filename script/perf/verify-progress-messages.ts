#!/usr/bin/env npx tsx
/**
 * verify-progress-messages.ts — what bb index tells the user while it works.
 *
 * Why this exists
 * ---------------
 * Measured on real runs before this gate:
 *   - a 7-file project that finished in 2s was told "this is a small project — a few
 *     minutes at most", and then, at 1 of 7 files, "a quarter of the way in";
 *   - a HEALTHY 5,086-file run that took 7m 7s was told "That took 7m 7s — longer than
 *     we expect. If it felt like it hung, that is worth reporting";
 *   - the ETA printed `eta=0s` at 100% of files while the derived pass and the
 *     embedding tail still had two-thirds of the run to go (files were done at 5m33s
 *     of a 15.1-minute command);
 *   - `encouragementFor` carried a branch whose comment described a "go away" line the
 *     function never had, and which returned null either way — dead code.
 *
 * Every claim here is checked against the shipped functions, and the wording is checked
 * once more end to end on a real 7-file index run, because a message is a product
 * surface: the pure function agreeing with itself is not evidence that the user sees it.
 *
 * Usage: npx tsx script/perf/verify-progress-messages.ts [--keep]
 * Exit:  0 all contracts hold, 1 otherwise.
 */
import { spawn } from "node:child_process"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import {
  encouragementFor,
  estimateRemainingMs,
  expectationFor,
  expectedDurationMs,
  formatEta,
  windowedFilesPerSecond,
} from "../../src/cli/index-progress"

const REPO = process.cwd()
const SCRATCH = path.join(REPO, ".progress-scratch")
const keep = process.argv.includes("--keep")

let failures = 0
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures++
}

async function main() {
  console.log(`\nPROGRESS MESSAGES — size bands, ETA honesty, and the wording a user sees\n`)

  console.log("── the up-front expectation")
  check("7 files is 'a moment', not 'a few minutes'", expectationFor(7) === "a moment — this is a tiny project", expectationFor(7))
  check("100 files is the small-project band", expectationFor(100) === "this is a small project — a few minutes at most", expectationFor(100))
  check("200 files has moved to the mid band (the boundary is 150)", expectationFor(200) === "this will take a few minutes")
  check("1,000 files is 'a few minutes'", expectationFor(1000) === "this will take a few minutes")
  check("11,045 files gets the coffee line", expectationFor(11045).includes("Grab a coffee"))
  check("nothing to index stays honest", expectationFor(0) === "nothing to index — the index is already up to date")

  console.log("\n── encouragement is for runs long enough to need it")
  check("no encouragement at 14% of 7 files", encouragementFor(14, false, 7) === null)
  check("none at 30% of 7 files either", encouragementFor(30, false, 7) === null)
  check("but 30% of 1,000 files is announced", encouragementFor(30, false, 1000) === "a quarter of the way in")
  check("95% announces the finish", encouragementFor(96, false, 1000) === "almost there — finishing up")
  check("100% announces nothing", encouragementFor(100, false, 1000) === null)

  console.log("\n── the ETA never claims a run is over while phases remain")
  check("0 remaining with files done reads 'finishing', not '0s'", formatEta(0, true) === "finishing", formatEta(0, true))
  check("unknown stays unknown", formatEta(null, false) === "…")
  check("a real duration is formatted", formatEta(90_000, false) === "1m 30s", formatEta(90_000, false))

  console.log("\n── the rate is windowed, so a slowdown moves the estimate")
  {
    // 100 files in 10s (10/s), then 20 more in the next 40s (0.5/s).
    const samples = [
      { at: 0, files: 0 },
      { at: 10_000, files: 100 },
      { at: 50_000, files: 120 },
    ]
    const windowed = windowedFilesPerSecond(samples)
    const cumulative = 120 / 50
    check("the windowed rate tracks the recent stretch", windowed !== null && Math.abs(windowed - 0.5) < 0.001, `windowed=${windowed}`)
    check("and it is not the cumulative average", Math.abs((windowed ?? 0) - cumulative) > 1, `windowed=${windowed} cumulative=${cumulative}`)
    const eta = estimateRemainingMs({ processedFiles: 120, totalFiles: 200 }, 0, samples, 50_000)
    check("so the remaining 80 files are estimated at the slow rate", !!eta && eta > 150_000, `eta=${eta}ms (cumulative would say ~33s)`)
  }
  {
    // A burst must not claim the rest is instant: clamp to 2x the run average.
    const samples = [
      { at: 0, files: 0 },
      { at: 10_000, files: 10 },
      { at: 12_000, files: 100 },
    ]
    const eta = estimateRemainingMs({ processedFiles: 100, totalFiles: 200 }, 0, samples, 12_000)
    check("a burst is clamped, not believed", !!eta && eta >= 5_000, `eta=${eta}ms (unclamped would say ~2.2s)`)
  }

  console.log("\n── 'longer than we expect' scales with the project")
  check("5,086 files are allowed ~21 minutes", expectedDurationMs(5086) > 20 * 60_000, `${Math.round(expectedDurationMs(5086) / 60_000)}m`)
  check("so the measured healthy 7m run would NOT warn", expectedDurationMs(5086) > 7 * 60_000)
  check("small projects keep the 3-minute floor", expectedDurationMs(100) === 3 * 60_000)

  console.log("\n── end to end: a real 7-file run says the right thing")
  {
    rmSync(SCRATCH, { recursive: true, force: true })
    const project = path.join(SCRATCH, "tiny")
    mkdirSync(project, { recursive: true })
    for (let i = 0; i < 7; i++) {
      writeFileSync(path.join(project, `m${i}.ts`), `export function f${i}(s: string): string { return s }\n`)
    }
    const out = await new Promise<string>((resolve) => {
      const child = spawn("npx", ["tsx", "src/cli/index.ts", "index", project, "--no-setup"], {
        cwd: REPO,
        env: { ...process.env, BB_DATA_DIR: path.join(SCRATCH, "data") },
        stdio: ["ignore", "pipe", "pipe"],
      })
      let s = ""
      child.stdout.on("data", (d) => { s += d.toString() })
      child.stderr.on("data", (d) => { s += d.toString() })
      child.on("close", () => resolve(s))
    })
    const visible = out.split("\n").filter((l) => l.includes("Indexing 7 files") || l.includes("[index] a quarter"))
    check("the tiny-project line is what the user sees", out.includes("a moment — this is a tiny project"), visible[0]?.trim() ?? "not printed")
    check("'a few minutes at most' is NOT claimed for 7 files", !out.includes("a few minutes at most"))
    check("no 'quarter of the way in' at 1 of 7 files", !out.includes("a quarter of the way in"))
  }

  console.log(
    failures === 0 ? `\nPROGRESS MESSAGES: ALL PASS\n` : `\nPROGRESS MESSAGES: ${failures} FAILURE(S)\n`,
  )
  if (!keep) rmSync(SCRATCH, { recursive: true, force: true })
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error("harness error:", e)
  process.exit(1)
})
