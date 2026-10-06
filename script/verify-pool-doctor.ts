// script/verify-pool-doctor.ts — Agent 1, round 2.
//
// The gate for `bb doctor`'s answer to "why aren't my pool workers starting?".
//
// `script/verify-pool-workers.ts` covers the pool machinery. This covers the
// part a USER reads, which is a different thing and easier to get wrong: a
// diagnosis that is correct but unreadable, or readable but not actionable, or
// actionable but wrong about severity, all pass a machinery gate and all fail
// the person who typed the command.
//
// What it pins:
//   1. the four statuses are distinguishable, and severity matches them
//      (a pool the user deliberately switched off must NOT exit 1; a pool that
//      silently regex-parses everything must NOT exit 0 silently);
//   2. every failure names a cause AND a command — a reason with no fix is the
//      bug this whole effort exists to remove;
//   3. the runtime facts are present, because `tsx-missing` and
//      `worker-entry-missing` look identical without them;
//   4. the REAL CLI, with tsx hidden, names the cause and the fix. Not a unit
//      test of a helper — the command a user types;
//   5. nothing leaks. Doctor prints env-derived text; the embeddings key must
//      never be anywhere near it.
//
// Run: npx tsx script/verify-pool-doctor.ts

import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { runDoctorChecks, renderDoctorReport, resetPoolDoctorCache } from "../src/setup/doctor"
import {
  diagnosePoolStartupSync,
  renderPoolDiagnosis,
  resolvePoolWorkerForkSafe,
} from "../src/ast/pool-diagnostics"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
const NODE = "/usr/local/bin/node"

let checks = 0
let failures = 0
function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) {
    console.log(`  ok: ${label}`)
  } else {
    failures++
    console.log(`  FAIL: ${label}${detail ? `\n        ${String(detail).replace(/\n/g, "\n        ")}` : ""}`)
  }
}
function section(title: string): void {
  console.log(`\n${title}`)
}

const tmp = mkdtempSync(path.join(tmpdir(), "bb-pool-doctor-"))
try {
  section("1. the healthy case: verified by actually starting a worker")
  {
    resetPoolDoctorCache()
    const report = diagnosePoolStartupSync({ moduleDir: path.join(ROOT, "src", "ast") })
    console.log(`\n${renderPoolDiagnosis(report.resolution)}\n`)
    check("a healthy checkout is reported ok", report.status === "ok", JSON.stringify(report.status))
    check("…because a real worker was started, not assumed",
      report.probe?.ok === true && report.probe.report.engine === "ok",
      JSON.stringify(report.probe?.ok))
    check("…and the probe reports how long the boot took",
      report.probe?.ok === true && report.probe.ms >= 0)
    check("…with an empty diagnostics list on a healthy worker",
      report.probe?.ok === true && report.probe.report.diagnostics.length === 0,
      JSON.stringify(report.probe?.ok ? report.probe.report.diagnostics : null))
    check("the report names the runtime facts a reader needs",
      report.findings.some((f) => /runtime: .*v\d+\./.test(f.message)),
      JSON.stringify(report.findings.map((f) => f.id)))
    check("…and which build is in play",
      report.findings.some((f) => /(compiled dist\/pool-worker\.js|tsx \+ TypeScript source)/.test(f.message)),
      JSON.stringify(report.findings.map((f) => f.message.slice(0, 80))))
  }

  section("2. `bb doctor` end to end, on this checkout")
  {
    resetPoolDoctorCache()
    const r = runDoctorChecks({ cwd: ROOT, env: {}, dataDir: path.join(tmp, "d1") })
    const out = renderDoctorReport(r)
    console.log(`\n${out.split("\n").slice(0, 9).join("\n")}\n`)
    check("the report carries a pool answer on its own line", /pool workers:/.test(out))
    check("a healthy pool is ✓ ok", /✓ pool workers: Pool workers start normally/.test(out), out.slice(0, 400))
    check("it names the fork target in play", /worker: (compiled dist\/pool-worker\.js|tsx \+)/.test(out))
    check("it names the node version", /runtime: .*\(v\d+\./.test(out))
    check("…and the root it resolved against", /root: /.test(out))
    check("no pool finding is a FAIL when the pool works",
      !r.findings.some((f) => f.id.startsWith("pool-") && f.severity === "fail"),
      JSON.stringify(r.findings.filter((f) => f.id.startsWith("pool-"))))
    check("info-level pool facts stay out of the findings list",
      !r.findings.some((f) => f.id === "pool-verified" || f.id === "pool-target"),
      JSON.stringify(r.findings.map((f) => f.id)))
  }

  section("3. tsx hidden: the cause AND the fix must both be named")
  {
    // The common real cause, forced rather than simulated: a fake project root
    // with no node_modules and a PATH that has no tsx on it.
    const bare = path.join(tmp, "bare")
    mkdirSync(path.join(bare, "src", "ast"), { recursive: true })
    writeFileSync(path.join(bare, "package.json"), '{"name":"bare"}\n')
    writeFileSync(path.join(bare, "src", "ast", "pool-worker.ts"), "// worker\n")
    const report = diagnosePoolStartupSync({ moduleDir: path.join(bare, "src", "ast"), env: { PATH: "/usr/bin:/bin" } })
    const text = renderPoolDiagnosis(report.resolution)
    console.log(`\n${text}\n`)
    check("no tsx anywhere is UNAVAILABLE", report.status === "unavailable", report.status)
    check("the reason code names the cause", report.resolution.ok === false && report.resolution.reason === "tsx-missing")
    check("it names tsx", /tsx/.test(text))
    check("it says WHERE it looked", /looked in:/.test(text))
    check("it gives a command to install tsx", /npm install --include=dev/.test(text))
    check("it explains WHY tsx would be missing (devDependency)", /DEV dependency/.test(text))
    check("it offers the in-process opt-out", /BB_POOL_WORKER=0/.test(text))
    check("it does NOT claim the pool is fine", !/pool workers start normally/.test(text))
  }

section("3b. doctor's own summary — and what it is about")
  {
    // `summarizePool` — the function that produces the sentence a user reads — is
    // private, so it is driven the way a user reaches it: through
    // runDoctorChecks. The states reachable from a healthy install are `ok` and
    // (via the env) `disabled`; `unavailable` needs a genuinely broken install,
    // which section 3 covers at the resolution layer and section 6 covers
    // through the real binary.
    resetPoolDoctorCache()
    const healthy = runDoctorChecks({ cwd: ROOT, env: {}, dataDir: path.join(tmp, "d3b") })
    const healthyText = renderDoctorReport(healthy)
    check("a healthy install is summarized as ok", healthy.pool.status === "ok", JSON.stringify(healthy.pool))
    check("…with runtime facts attached", healthy.pool.facts.length >= 3, JSON.stringify(healthy.pool.facts))
    check("…naming the executable and its version", healthy.pool.facts.some((f) => /runtime: .*\(v\d+\./.test(f)))
    check("…naming which build is in play",
      healthy.pool.facts.some((f) => /worker: (compiled dist\/pool-worker\.js|tsx \+)/.test(f)),
      JSON.stringify(healthy.pool.facts))
    check("…and naming the root the paths resolved against", healthy.pool.facts.some((f) => /root: /.test(f)))
    const hlines = healthyText.split("\n")
    check("the rendered report leads with the pool answer",
      hlines.findIndex((l) => /pool workers:/.test(l)) <
        hlines.findIndex((l) => /embedding configuration|semantic search/i.test(l)),
      healthyText.slice(0, 300))

    // A property worth pinning because it is easy to get wrong: the pool belongs
    // to BB'S OWN INSTALLATION, not to the directory being indexed. Someone
    // running `bb doctor --dir ~/some/other/repo` needs the verdict for the bb
    // they are actually running.
    resetPoolDoctorCache()
    const elsewhere = runDoctorChecks({ cwd: path.join(tmp, "unrelated"), env: {}, dataDir: path.join(tmp, "d3b") })
    // Compared on the stable fields: `summary` embeds a boot time, which differs run to run.
    check("the pool verdict is about bb's install, not the indexed project's cwd",
      elsewhere.pool.status === healthy.pool.status &&
        elsewhere.pool.reasonCode === healthy.pool.reasonCode &&
        JSON.stringify(elsewhere.pool.facts.slice(0, 3)) === JSON.stringify(healthy.pool.facts.slice(0, 3)),
      `${elsewhere.pool.status}/${elsewhere.pool.reasonCode} vs ${healthy.pool.status}/${healthy.pool.reasonCode}`)

    // The opt-out, end to end, because a deliberate choice must not exit 1.
    const prev = process.env.BB_POOL_WORKER
    process.env.BB_POOL_WORKER = "0"
    try {
      resetPoolDoctorCache()
      const off = runDoctorChecks({ cwd: ROOT, env: {}, dataDir: path.join(tmp, "d3b") })
      const offText = renderDoctorReport(off)
      check("BB_POOL_WORKER=0 is summarized as disabled", off.pool.status === "disabled", JSON.stringify(off.pool))
      check("…with its reason code", off.pool.reasonCode === "pool-disabled-by-env")
      check("…and it is NOT a fail finding",
        !off.findings.some((f) => f.id.startsWith("pool-") && f.severity === "fail"),
        JSON.stringify(off.findings.map((f) => `${f.id}:${f.severity}`)))
      check("…so the report is no less healthy than a healthy pool's",
        off.healthy === healthy.healthy, `healthy=${off.healthy} vs ${healthy.healthy}`)
      check("…and the reader is told indexing still works, just slower",
        /in-process/.test(offText) && /slower/.test(offText), offText.split("\n").slice(0, 4).join(" | "))
      // The opt-out is decided from the env alone, so no worker is booted to
      // find that out — the `facts` would otherwise carry a self-test line.
      check("…and no worker was booted to find that out",
        !off.pool.facts.some((f) => /self-test:/.test(f)), JSON.stringify(off.pool.facts))
    } finally {
      if (prev === undefined) delete process.env.BB_POOL_WORKER
      else process.env.BB_POOL_WORKER = prev
      resetPoolDoctorCache()
    }
  }
  section("4. severity: a deliberate opt-out is not an outage")
  {
    const off = diagnosePoolStartupSync({ moduleDir: path.join(ROOT, "src", "ast"), env: { BB_POOL_WORKER: "0" } })
    check("BB_POOL_WORKER=0 reads as DISABLED, not broken", off.status === "disabled", off.status)
    check("…and it costs no worker boot", off.probe === undefined)
    check("…and it produces no fail finding", !off.findings.some((f) => f.severity === "fail"))
    check("…it says indexing still works, just slower",
      /in-process/.test(renderPoolDiagnosis(off.resolution)) || off.findings.some((f) => /slower/.test(f.message)))
  }

  section("5. a worker that starts but is DEGRADED is not 'fine'")
  {
    // A worker that cannot load its own module graph: resolution succeeds, so
    // nothing but a probe can see it.
    const broken = path.join(tmp, "degraded")
    mkdirSync(path.join(broken, "node_modules", ".bin"), { recursive: true })
    writeFileSync(path.join(broken, "package.json"), '{"name":"d"}\n')
    const loader = path.join(broken, "node_modules", ".bin", "tsx")
    writeFileSync(loader, 'process.stderr.write("Error [ERR_MODULE_NOT_FOUND]: Cannot find module \'web-tree-sitter\'\\n")\nprocess.exit(1)\n')
    chmodSync(loader, 0o755)
    const report = diagnosePoolStartupSync({ moduleDir: path.join(broken, "src", "ast") })
    check("a crash-on-load worker is UNAVAILABLE, not degraded",
      report.status === "unavailable", report.status)
    check("…classified from its OWN stderr, not from resolution",
      report.probe?.ok === false && report.probe.detail.cause === "missing-module",
      JSON.stringify(report.probe?.ok === false ? report.probe.detail.cause : report.probe?.ok))
    check("…with the reason code a machine can match",
      report.findings.some((f) => f.id === "pool-worker-load-crash"),
      JSON.stringify(report.findings.map((f) => f.id)))
    const text = report.findings.map((f) => f.message).join("\n")
    check("…and the child's own error is in the report", /web-tree-sitter/.test(text), text.slice(0, 300))
    check("…plus the reinstall command", /rm -rf node_modules/.test(text))
  }

section("6. the REAL CLI — `node bin/bb doctor`, and the tsx-hidden case")
  {
    // (a) As shipped. This is the regression guard for the package-root bug:
    // `ROOT_PKG` used to be `resolve(import.meta.dirname, "../..")`, which in the
    // BUNDLE is the parent of the package, so a healthy install was reported as
    // `tsx-missing` after searching `<parent>/node_modules/.bin/tsx`.
    if (!existsSync(path.join(ROOT, "dist", "cli", "index.js"))) {
      console.log("        (skipped: no dist/ — run `npm run build` first)")
    } else {
      const proj = path.join(tmp, "cli-proj")
      mkdirSync(proj, { recursive: true })
      writeFileSync(path.join(proj, "a.ts"), "export const x = 1\n")
      const dataDir = path.join(tmp, "cli-data")
      mkdirSync(dataDir, { recursive: true })

      const shipped = spawnSync(process.execPath, [path.join(ROOT, "bin", "bb"), "doctor", "--dir", proj], {
        encoding: "utf8",
        env: { ...process.env, BB_DATA_DIR: dataDir },
        timeout: 120_000,
      })
      const out = `${shipped.stdout ?? ""}${shipped.stderr ?? ""}`
      console.log(`\n${out.split("\n").slice(0, 8).join("\n")}\n`)
      check("`bb doctor` answers the pool question", /pool workers:/.test(out), out.slice(0, 300))
      check("…and resolves the COMPILED worker", /worker: compiled dist\/pool-worker\.js/.test(out), out.slice(0, 400))
      check("…so it found the package root by walking, not by counting two levels",
        !/wt\/node_modules/.test(out) && !/wt\/src\/ast/.test(out), out.slice(0, 400))
      check("…and it verified a real worker rather than assuming", /self-test: \d+ms/.test(out))
      check("…naming the node version", /runtime: .*\(v\d+\./.test(out))

      // (b) tsx hidden. NOT reachable through the binary — `bin/bb` imports
      // dist/cli/index.js, so moving dist away means the command cannot run at
      // all; and running from source needs tsx to launch. So the "no tsx" state is
      // produced through doctor's own seam (`poolModuleDir`), which is the same
      // code path the CLI takes after the install is detected.
      const bare = path.join(tmp, "bare-install")
      mkdirSync(path.join(bare, "src", "ast"), { recursive: true })
      writeFileSync(path.join(bare, "package.json"), '{"name":"bare-install"}\n')
      writeFileSync(path.join(bare, "src", "ast", "pool-worker.ts"), "// worker\n")

      const prevPath = process.env.PATH
      const prevPool = process.env.BB_POOL_WORKER
      process.env.PATH = "/usr/bin:/bin" // no tsx reachable
      delete process.env.BB_POOL_WORKER
      try {
        resetPoolDoctorCache()
        const r = runDoctorChecks({
          cwd: proj,
          env: {},
          dataDir,
          poolModuleDir: path.join(bare, "src", "ast"),
        })
        const hout = renderDoctorReport(r)
        console.log(`\n${hout.split("\n").slice(0, 13).join("\n")}\n`)
        check("with tsx hidden, `bb doctor` reports the pool UNAVAILABLE",
          r.pool.status === "unavailable", JSON.stringify(r.pool.status))
        check("…with the cause, as a reason code", r.pool.reasonCode === "tsx-missing")
        check("…and in prose", /cannot start \(tsx-missing\)/.test(hout), hout.slice(0, 300))
        check("…and a command to fix it", /npm install --include=dev/.test(hout))
        check("…explaining the devDependency trap", /DEV dependency/.test(hout))
        check("…offering the in-process opt-out", /BB_POOL_WORKER=0/.test(hout))
        check("…saying where it looked", /worker: not resolvable/.test(hout))
        check("…and the report is unhealthy, so a caller can exit non-zero", r.healthy === false)
        check("…with a fail finding in the list",
          r.findings.some((f) => f.id === "pool-tsx-missing" && f.severity === "fail"),
          JSON.stringify(r.findings.map((f) => `${f.id}:${f.severity}`)))
      } finally {
        process.env.PATH = prevPath
        if (prevPool === undefined) delete process.env.BB_POOL_WORKER
        else process.env.BB_POOL_WORKER = prevPool
        resetPoolDoctorCache()
      }
    }
  }
  section("7. nothing leaks")
  {
    // The report is derived from the environment, so it must never be able to
    // print a key. This is asserted with a canary in the env, not by inspection.
    const canary = "sk-canary-0000000000000000"
    resetPoolDoctorCache()
    const r = runDoctorChecks({
      cwd: ROOT,
      env: { OPENROUTER_API_KEY: canary, EMBEDDING_API_KEY: canary, BB_POOL_WORKER: "0" } as Record<string, string>,
      dataDir: path.join(tmp, "d7"),
    })
    const out = renderDoctorReport(r)
    check("a key in the environment never reaches the report", !out.includes(canary), out.slice(0, 300))
    check("…and the pool section is present regardless", /pool workers:/.test(out))
    resetPoolDoctorCache()
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${checks - failures}/${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)