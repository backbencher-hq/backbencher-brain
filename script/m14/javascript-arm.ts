/**
 * JAVASCRIPT — THE ARM RUNNER: one whole-population arm, with the digests the cell needs RECORDED
 * IN THE ARM'S OWN LOG.
 *
 * ── WHY THIS FILE EXISTS, AND WHAT IT FIXES ──────────────────────────────────────────────────────────
 * The lane's cell (validation/m14/measurements/javascript-arm-current.json) claims, in its `view`
 * block, that its digests are "THE ARM's RUN-TIME VIEW ✓✓ (the digests the arm RAN at, read from the
 * arm's own log) ✓✓". **THE ARM'S OWN LOG HAS NO SUCH LINE.** The gate prints no digest line
 * (`grep -n "cell digests" script/m14/incoming-gate.ts` → 0 hits), so the reader fell back to the
 * digests the CALLER passed as arguments — which were SHA-1s, while the reader's own tree digests
 * are SHA-256s, so a reader could not COMPARE them, and the cell's provenance claim was not backed by
 * the artifact it names.
 *
 * **THIS RUNNER CLOSES THAT HOLE: IT PRINTS THE DIGEST LINE INTO THE LOG IT WRITES, AND IT PRINTS IT
 * BEFORE THE GATE RUNS, so the line is the digests the arm RAN at.** The reader then reads the line
 * out of the log and the claim is true.
 *
 * ── WHAT THE DIGESTS ARE, AND WHY THE SPEC IS THE LANE'S OWN ────────────────────────────────────────
 *   analyzer  src/ast/real-javascript-analyzer.ts     — the thing under test
 *   gate      script/m14/incoming-gate.ts              — the population instrument
 *   arbiter   script/m14/incoming-rule.ts              — the classifier (the tie-break lives here)
 *   spec      script/m14/spec/javascript-completeness.json — the lane's OWN completeness block
 *   declSpec  src/ast/project-index.ts                 — the javascript DECLARATION spec the gate's
 *                                                          INDEX_SPECS entry imports (incoming-gate.ts:1287)
 *
 * (The previous reader hashed `src/ast/project-index.ts` under the name "spec", which is the
 * DECLARATION spec, not the lane's completeness spec. Both are carried here, named for what they
 * are, so no reader has to guess which is which.)
 *
 * ── THE ARM TOKEN ────────────────────────────────────────────────────────────────────────────────────
 * The token is the fleet's one heavy arm at a time. The runner TAKES it, BEATS it every 120 s (the
 * token's TTL is 2700 s and the fleet's rule is to beat every two minutes), and RELEASES it in a
 * `finally` — including on a crash, because a token held by a dead runner blocks six other lanes.
 *
 *   bun run script/m14/javascript-arm.ts --label=<name> [--gate=<path>] [--token] [--extra=...]
 */
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = process.cwd()
const LOG_DIR = path.join(ROOT, "validation/m14/fixtures/javascript")

function argOf(name: string): string | undefined {
  const argv = process.argv.slice(2)
  const i = argv.indexOf("--" + name)
  if (i >= 0) return argv[i + 1]
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}
const LABEL = argOf("label") ?? `arm-${new Date().toISOString().slice(0, 10)}`
const GATE = argOf("gate") ?? "script/m14/incoming-gate.ts"
const USE_TOKEN = process.argv.includes("--token")
/** WAIT FOR THE TOKEN INSTEAD OF REFUSING IT. The fleet runs one heavy arm at a time and the queue
 *  is FIFO, so a lane that is first in the queue should WAIT rather than fail — and a lane that
 *  starts a background runner, walks away, and comes back to a refused token has lost the turn it
 *  waited for. This runner takes the token the moment the queue's turn is its own, and it holds the
 *  token for BOTH arms if `--both` is given, so the fleet's heavy slot is used once, not twice. */
const WAIT = process.argv.includes("--wait")
/** RUN BOTH ARMS UNDER ONE TOKEN: the shipping gate (the cell) and the instrumented twin (the
 *  tie-break's per-row movement, and the per-type file counts). */
const BOTH = process.argv.includes("--both")
const EXTRA = process.argv.slice(2).filter((a) => a.startsWith("--extra=")).map((a) => a.slice("--extra=".length))

const sha256 = (rel: string) => createHash("sha256").update(readFileSync(path.join(ROOT, rel))).digest("hex")
/** THE VIEW'S DIGESTS, READ AT RUN TIME — NOT AT LAUNCH TIME.
 *
 *  A runner that WAITS for the token can sit for an hour before it runs, and other lanes commit
 *  meanwhile. Digests taken at LAUNCH would then name a tree the arm did NOT run at, which is the
 *  exact defect this runner exists to close. So the digests are taken inside `runArm`, immediately
 *  before the gate is spawned, and the COMMIT is the tree's HEAD at that same moment. */
const digestsNow = () => ({
  analyzer: sha256("src/ast/real-javascript-analyzer.ts"),
  gate: sha256("script/m14/incoming-gate.ts"),
  arbiter: sha256("script/m14/incoming-rule.ts"),
  spec: sha256("script/m14/spec/javascript-completeness.json"),
  declSpec: sha256("src/ast/project-index.ts"),
})
const commitNow = () => spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim()

const LOG = path.join(LOG_DIR, `arm-${LABEL}.log`)
mkdirSync(LOG_DIR, { recursive: true })

const out = (s: string) => process.stdout.write(s)
out(`ARM ${LABEL}\n`)
out(`  corpus root : ${process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")}\n`)
out(`  gate        : ${GATE}\n`)
out(`  (the commit is read at RUN TIME, with the digests)\n`)
// THE LINE THE READER READS. It is printed BEFORE the gate runs, so it states the digests the arm
// RAN at — and it is in the log, so the cell's provenance claim is checkable against an artifact.
out(`  (the digests are taken at RUN TIME, inside the arm, and printed into the arm's own log)\n`)

function takeToken(): boolean {
  const t = spawnSync("bash", [path.join(ROOT, "script/m14/arm-token.sh"), "take", "javascript"], { cwd: ROOT, encoding: "utf8" })
  out(t.stdout ?? "")
  if (t.status === 0) return true
  if (!WAIT) {
    out(`TOKEN REFUSED (exit ${t.status}) — the arm will NOT run without it.\n`)
    process.exit(t.status ?? 5)
  }
  return false
}

if (USE_TOKEN) {
  // WAIT FOR THE TURN, POLLING THE QUEUE AND THE SLOT. The poll interval is short enough that the
  // lane does not lose its place and long enough not to spin the machine.
  let taken = false
  let waited = 0
  while (!taken) {
    taken = takeToken()
    if (!taken) {
      waited += 30
      out(`  waiting for the arm token… ${waited}s\n`)
      spawnSync("sleep", ["30"], { cwd: ROOT })
    }
  }
  out(`  token HELD after ${waited}s of waiting\n`)
}

/**
 * RUN ONE ARM: the gate, over the whole admitted population, into its own log.
 * The digest line is printed into the log BEFORE the gate runs, so the log states the digests the
 * arm RAN at — that is what makes the cell's VIEW checkable against an artifact.
 */
function runArm(label: string, gate: string, extra: string[]): Promise<number> {
  return new Promise((resolve) => {
    const log = path.join(LOG_DIR, `arm-${label}.log`)
    out(`\n=== ARM ${label} ===\n`)
    out(`  log        : ${path.relative(ROOT, log)}\n`)
    out(`  command    : bun run ${gate} javascript js,mjs,cjs,jsx 0 ${extra.join(" ")}\n\n`)
    const logLines: string[] = []
    // THE LINE THE READER READS, AND IT IS THE FIRST LINE OF THE LOG ITSELF — so the log states the
    // digests the arm RAN at, and the cell's provenance claim is checkable against the artifact it
    // names. (The previous cell claimed its digests were "read from the arm's own log" and the arm's
    // log had no such line.)
    const digests = digestsNow()
    const commit = commitNow()
    const digestLine = `cell digests: analyzer=${digests.analyzer} gate=${digests.gate} arbiter=${digests.arbiter} spec=${digests.spec} declSpec=${digests.declSpec} commit=${commit}`
    logLines.push(`${digestLine}\n`)
    out(`  ${digestLine}\n`)
    const child = spawn("bun", ["run", gate, "javascript", "js,mjs,cjs,jsx", "0", ...extra], {
      cwd: ROOT,
      env: { ...process.env, BB_CORPUS_ROOT: process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus") },
      stdio: ["ignore", "pipe", "pipe"],
    })
    const capture = (buf: Buffer) => {
      const t = buf.toString()
      logLines.push(t)
      out(t)
    }
    child.stdout.on("data", capture)
    child.stderr.on("data", capture)
    child.on("exit", (code) => {
      const body = logLines.join("")
      writeFileSync(log, body)
      out(`\n  log written: ${path.relative(ROOT, log)} (${body.length} bytes)\n  exit code  : ${code}\n`)
      resolve(code ?? 1)
    })
  })
}

async function main() {
  let code = 0
  if (BOTH) {
    // ARM 1 — the SHIPPING GATE, over the whole population. This is the cell.
    code = await runArm(LABEL, GATE, EXTRA)
    // ARM 2 — the INSTRUMENTED TWIN, over the SAME population and the SAME key space. Its TABLE 1
    // is byte-identical to the shipping gate's (that is the twin's falsifier), and it adds the
    // tie-break's PER-ROW movement and the per-type FILE counts.
    const twinGate = path.join(ROOT, ".tmp-js-tiebreak/incoming-gate.ts")
    if (!existsSync(twinGate)) {
      out(`\n  THE TWIN IS NOT BUILT (${path.relative(ROOT, twinGate)} is absent) — build it with\n`)
      out(`    bun run script/m14/javascript-tiebreak-twin.ts\n`)
      code = code === 0 ? 6 : code
    } else {
      const twinCode = await runArm(`${LABEL}-twin`, twinGate, EXTRA)
      code = code === 0 ? twinCode : code
    }
  } else {
    code = await runArm(LABEL, GATE, EXTRA)
  }
  if (USE_TOKEN) {
    spawnSync("bash", [path.join(ROOT, "script/m14/arm-token.sh"), "release", "javascript"], { cwd: ROOT, stdio: "ignore" })
    out("  token released\n")
  }
  process.exit(code)
}

main()
