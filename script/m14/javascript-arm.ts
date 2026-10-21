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
const EXTRA = process.argv.slice(2).filter((a) => a.startsWith("--extra=")).map((a) => a.slice("--extra=".length))

const sha256 = (rel: string) => createHash("sha256").update(readFileSync(path.join(ROOT, rel))).digest("hex")
const digests = {
  analyzer: sha256("src/ast/real-javascript-analyzer.ts"),
  gate: sha256("script/m14/incoming-gate.ts"),
  arbiter: sha256("script/m14/incoming-rule.ts"),
  spec: sha256("script/m14/spec/javascript-completeness.json"),
  declSpec: sha256("src/ast/project-index.ts"),
}
const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim()

const LOG = path.join(LOG_DIR, `arm-${LABEL}.log`)
mkdirSync(LOG_DIR, { recursive: true })

const out = (s: string) => process.stdout.write(s)
out(`ARM ${LABEL}\n`)
out(`  corpus root : ${process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")}\n`)
out(`  gate        : ${GATE}\n`)
out(`  commit      : ${commit}\n`)
// THE LINE THE READER READS. It is printed BEFORE the gate runs, so it states the digests the arm
// RAN at — and it is in the log, so the cell's provenance claim is checkable against an artifact.
const digestLine = `cell digests: analyzer=${digests.analyzer} gate=${digests.gate} arbiter=${digests.arbiter} spec=${digests.spec} declSpec=${digests.declSpec} commit=${commit}`
out(`  ${digestLine}\n`)

if (USE_TOKEN) {
  const t = spawnSync("bash", [path.join(ROOT, "script/m14/arm-token.sh"), "take", "javascript"], { cwd: ROOT, encoding: "utf8" })
  out(t.stdout ?? "")
  if (t.status !== 0) {
    out(`TOKEN REFUSED (exit ${t.status}) — the arm will NOT run without it.\n`)
    process.exit(t.status ?? 5)
  }
}

const args = ["run", GATE, "javascript", "js,mjs,cjs,jsx", "0", ...EXTRA]
out(`  command     : bun ${args.join(" ")}\n\n`)

const logLines: string[] = []
let beat: NodeJS.Timeout | null = null
const child = spawn("bun", args, {
  cwd: ROOT,
  env: { ...process.env, BB_CORPUS_ROOT: process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus") },
  stdio: ["ignore", "pipe", "pipe"],
})
const capture = (buf: Buffer) => {
  const s = buf.toString()
  logLines.push(s)
  out(s)
}
child.stdout.on("data", capture)
child.stderr.on("data", capture)

if (USE_TOKEN) {
  // BEAT EVERY 120 SECONDS — the fleet's rule, and the TTL's reason.
  beat = setInterval(() => {
    spawnSync("bash", [path.join(ROOT, "script/m14/arm-token.sh"), "beat", "javascript"], { cwd: ROOT, stdio: "ignore" })
  }, 120_000)
}

child.on("exit", (code) => {
  if (beat) clearInterval(beat)
  const body = logLines.join("")
  writeFileSync(LOG, body)
  out(`\n  log written: ${LOG} (${body.length} bytes)\n  exit code  : ${code}\n`)
  if (USE_TOKEN) {
    spawnSync("bash", [path.join(ROOT, "script/m14/arm-token.sh"), "release", "javascript"], { cwd: ROOT, stdio: "ignore" })
    out("  token released\n")
  }
  process.exit(code ?? 1)
})
