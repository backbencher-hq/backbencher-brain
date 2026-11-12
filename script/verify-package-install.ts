// script/verify-package-install.ts — the artifact, not the checkout.
//
// Release testing this project relied on was `--version` from the tarball,
// which never exercises the chunk graph, the phase pipeline or the summary. This
// gate packs the exact tarball that would be published, extracts it into a temp
// dir (no network install needed: the bundle is self-contained), runs
// `--version`, indexes a small project with `--no-setup`, and asserts the run
// reached its summary with the phase/derived facts and no module-resolution
// error. It also re-runs the dist-integrity check on the EXTRACTED dist.
//
// Run: npx tsx script/verify-package-install.ts
// POSIX (uses tar); intended as a pre-release gate, not part of npm test.

import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { verifyDistDir } from "./verify-dist-integrity"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
let checks = 0
let failed = 0

function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) console.log(`  ok: ${label}`)
  else {
    failed++
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv, cwd = ROOT): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(cmd, args, { cwd, env, encoding: "utf8", timeout: 240000 })
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" }
}

function main(): void {
  const packageJson = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { version: string }
  const temp = mkdtempSync(path.join(os.tmpdir(), "bb-package-smoke-"))
  const cache = path.join(temp, "npm-cache")
  mkdirSync(cache, { recursive: true })
  const env: NodeJS.ProcessEnv = { ...process.env, npm_config_cache: cache }

  try {
    console.log(`packaging bb ${packageJson.version} …`)
    const pack = run("npm", ["pack", "--pack-destination", temp], env)
    check("npm pack succeeded", pack.status === 0, pack.stderr.split("\n").slice(-4).join(" | "))
    const tarball = readdirSync(temp).find((name) => name.endsWith(".tgz"))
    check("tarball was written", Boolean(tarball), tarball ?? "no .tgz")
    if (!tarball) return

    const extractDir = path.join(temp, "extract")
    mkdirSync(extractDir, { recursive: true })
    const untar = run("tar", ["xzf", path.join(temp, tarball), "-C", extractDir], env)
    check("tarball extracts", untar.status === 0, untar.stderr.slice(0, 240))
    const pkg = path.join(extractDir, "package")
    check("package bin exists", existsSync(path.join(pkg, "bin", "bb")))
    check("package dist entry exists", existsSync(path.join(pkg, "dist", "cli", "index.js")))

    const dist = verifyDistDir(path.join(pkg, "dist"))
    check("extracted dist has no broken chunk references", dist.missing.length === 0, JSON.stringify(dist.missing.slice(0, 5)))

    // The tarball carries the bundle, not its dependencies: install it the way a
    // user does so bare imports (`commander`, the SQLite driver) resolve from the
    // package's own node_modules. Extraction above still proves the shipped dist.
    const installPrefix = path.join(temp, "install")
    const install = run(
      "npm",
      ["install", "--prefix", installPrefix, "--no-audit", "--no-fund", path.join(temp, tarball)],
      env,
      temp,
    )
    check("tarball installs into a fresh prefix", install.status === 0, `${install.stdout.slice(-400)} ${install.stderr.slice(-400)}`)
    const installed = path.join(installPrefix, "node_modules", "@backbencher", "brain")
    check("installed package bin exists", existsSync(path.join(installed, "bin", "bb")))
    const installedDist = verifyDistDir(path.join(installed, "dist"))
    check("installed dist has no broken chunk references", installedDist.missing.length === 0, JSON.stringify(installedDist.missing.slice(0, 5)))

    const version = run(process.execPath, [path.join(installed, "bin", "bb"), "--version"], env)
    check("installed --version succeeds", version.status === 0, version.stderr.slice(0, 240))
    check("installed --version reports the package version", version.stdout.trim() === packageJson.version, `${version.stdout.trim()} vs ${packageJson.version}`)

    // A small real project: one module importing another, so relationships and a
    // call site exist and the graph/derived phases have something to report.
    const project = path.join(temp, "project")
    mkdirSync(path.join(project, "src"), { recursive: true })
    writeFileSync(
      path.join(project, "src", "math.ts"),
      "export function add(a: number, b: number): number { return a + b }\n" +
        "export function twice(n: number): number { return add(n, n) }\n",
    )
    const data = path.join(temp, "data")
    const home = path.join(temp, "home")
    mkdirSync(data, { recursive: true })
    mkdirSync(home, { recursive: true })
    const index = run(
      process.execPath,
      [path.join(installed, "bin", "bb"), "index", project, "--no-setup"],
      { ...env, HOME: home, BB_DATA_DIR: data },
      project,
    )
    const output = `${index.stdout}\n${index.stderr}`
    check("packaged index exits 0", index.status === 0, output.slice(-600))
    check("packaged index reaches the summary", output.includes("✓ indexed"), output.slice(-600))
    check("summary reports relationships", output.includes("relationships"), output.slice(-600))
    check("summary names the index path (removable)", output.includes("index:") && output.includes("remove with:"), output.slice(-600))
    check("summary reports the run/phase line", output.includes("run:") && output.includes("workers"), output.slice(-600))
    check("packaged index has no module-resolution error", !output.includes("ERR_MODULE_NOT_FOUND") && !output.includes("Cannot find module"), output.slice(-600))
    check("packaged index used no embedding prompt (non-TTY notice only)", !output.includes("API key (hidden"), output.slice(-400))

    const reset = run(process.execPath, [path.join(installed, "bin", "bb"), "setup", "reset"], { ...env, HOME: home, BB_DATA_DIR: data }, project)
    check("packaged `bb setup reset` exits 0", reset.status === 0, reset.stderr.slice(0, 240))
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
  console.log("")
  console.log(failed === 0 ? `PACKAGE SMOKE: PASS (${checks} checks)` : `PACKAGE SMOKE: FAIL (${failed}/${checks})`)
  process.exit(failed === 0 ? 0 : 1)
}

main()
