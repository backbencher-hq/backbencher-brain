// Fault-injection hook for script/perf/verify-pool-failure-modes.ts.
//
// Loaded through NODE_OPTIONS=--require, so it runs inside every Node child the
// indexer forks. It exists to reproduce ONE failure deterministically: a pool
// worker that dies BEFORE it can signal `ready` (the pre-ready exit that used to
// bypass the pool's restart cap and fork replacements forever).
//
// Two guards keep the experiment honest:
//
//   1. Only processes whose argv names `pool-worker` are touched. The harness
//      itself, and anything else in the tree, is unaffected.
//   2. The FIRST such process survives. `probePoolWorker()` forks the resolved
//      worker target once and waits for `ready`; if that probe dies, the indexer
//      correctly falls back to in-process indexing and the pool path — the thing
//      under test — is never entered. So the probe is allowed through and every
//      worker after it dies before `ready`.
//
// The counter file is supplied by the harness and reset per scenario, so the
// experiment cannot leak into a later run.
const fs = require("fs")

const counterFile = process.env.BB_TEST_WORKER_COUNTER
if (!counterFile) return
if (!process.argv.join(" ").includes("pool-worker")) return

// How many leading pool-worker invocations must be allowed through before the
// killing starts. The indexer forks BEFORE it decides: one or more probe/startup
// processes run first, and if any of them dies the run correctly falls back to
// in-process indexing — the pool path, which is the thing under test, is then
// never entered. The harness raises this until "worker pool available" appears.
const surviveFirst = Number(process.env.BB_TEST_SURVIVE_FIRST || 1)

let seen = 0
try {
  seen = Number(fs.readFileSync(counterFile, "utf8")) || 0
} catch {}
seen += 1
try {
  fs.writeFileSync(counterFile, String(seen))
} catch {}

// The leading invocations are the indexer's probe(s): let them reach `ready` so
// the pool is entered. Everything after that is a pool worker, and dies before
// `ready` — the failure mode under test.
if (seen > surviveFirst) process.exit(1)
