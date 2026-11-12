// script/m30/verify-embedding-progress.ts — the drain line's wording.
//
// The live line under an index run is the only place a rate-limited provider is
// explained while vectors drain. It is a pure formatter, so these checks are
// deterministic: no provider, no timing, no TTY. A 429 must read as a provider
// rate limit with its retry number and growing backoff — never as a slow indexer.
//
// Run: npx tsx script/m30/verify-embedding-progress.ts

import { formatEmbeddingDrainLine } from "../../src/cli/index-progress"

let checks = 0
let passed = 0
let failed = 0
const failures: string[] = []

function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) passed++
  else {
    failed++
    failures.push(label + (detail ? ` — ${detail}` : ""))
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

const base = {
  queued: 100,
  completed: 40,
  active: true,
  rateLimited: false,
  retryInMs: 0,
  retryAttempt: 0,
  retryDelayMs: 0,
}

const normal = formatEmbeddingDrainLine(base)
check("normal line shows progress and percentage", normal.includes("40/100 vectors (40%)"), normal)
check("normal line says in flight while work remains", normal.includes("in flight"), normal)
check("normal line is not a rate-limit line", !normal.includes("rate-limited"), normal)

const limited = formatEmbeddingDrainLine({
  queued: 4462,
  completed: 1000,
  active: true,
  rateLimited: true,
  retryInMs: 12400,
  retryAttempt: 2,
  retryDelayMs: 10000,
})
check("rate-limit line states the provider is rate-limited", limited.includes("provider rate-limited"), limited)
check("rate-limit line names the retry number", limited.includes("retry 2"), limited)
check("rate-limit line gives the countdown in seconds", limited.includes("in 13s"), limited)
check("rate-limit line gives the backoff window", limited.includes("backoff 10s"), limited)
check("rate-limit line also keeps the vector progress", limited.includes("1,000/4,462 vectors (22%)"), limited)
check("rate-limit line replaces 'in flight'", !limited.includes("in flight"), limited)

const growing = formatEmbeddingDrainLine({
  queued: 10,
  completed: 0,
  active: true,
  rateLimited: true,
  retryInMs: 400,
  retryAttempt: 3,
  retryDelayMs: 20000,
})
check("later retries show the grown backoff", growing.includes("retry 3 in 1s (backoff 20s)"), growing)
check("sub-second countdown is reported as at least 1s", growing.includes("in 1s"), growing)

const noQueue = formatEmbeddingDrainLine({ queued: 0, completed: 0, active: true, rateLimited: false, retryInMs: 0, retryAttempt: 0, retryDelayMs: 0 })
check("unknown total says finishing vectors", noQueue.includes("finishing vectors"), noQueue)
check("unknown total never prints a fake percentage", !noQueue.includes("%"), noQueue)

const idle = formatEmbeddingDrainLine({ ...base, completed: 100, active: false })
check("completed line is 100%", idle.includes("100/100 vectors (100%)"), idle)
check("completed line has no in-flight marker", !idle.includes("in flight"), idle)

console.log("")
console.log(`  checks: ${passed}/${checks} passed`)
if (failed > 0) {
  console.log("VERDICT: FAIL")
  for (const failure of failures) console.log(`  - ${failure}`)
  process.exit(1)
}
console.log("VERDICT: PASS")
