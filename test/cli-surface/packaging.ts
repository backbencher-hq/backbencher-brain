// test/cli-surface/packaging.ts — does `bb` work as a SHIPPED package?
//
// Everything else in this suite drives the CLI from source (`src/cli/index.ts`
// under the repo's own tsx). That is the right default — it needs no build — but
// it is not what a user runs. A user runs `bin/bb`, which is a three-line shim
// over `dist/cli/index.js`, and the two paths are NOT the same code: the source
// entry self-execs `runCli` from inside its own module evaluation
// (src/cli/index.ts:899-904) while the compiled one is imported by bin/bb.
//
// So this file builds the package, stages a clean install layout out of what
// `npm pack` would actually ship, and runs the real binary from there.
//
// Run:  npx tsx test/cli-surface/packaging.ts

import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, chmodSync, utimesSync, cpSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  createSuite, guard, isolatedDataDir, makeFixture, bb, pkgJson, REPO_ROOT, repoFileExists,
  mcpInitialize, parseJsonRpcLines,
} from "./harness"

const suite = createSuite("cli-packaging")
isolatedDataDir("packaging")
const pkg = pkgJson()

const staged: string[] = []
function stageDir(tag: string): string {
  const d = mkdtempSync(path.join(tmpdir(), `bb-cli-stage-${tag}-`))
  staged.push(d)
  return d
}
process.on("exit", () => {
  for (const d of staged) { try { rmSyncQuiet(d) } catch { /* best effort */ } }
})
function rmSyncQuiet(d: string): void {
  spawnSync("rm", ["-rf", d])
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("1. package.json `files` — every entry exists and actually ships")
// ─────────────────────────────────────────────────────────────────────────────
{
  // `npm pack --dry-run --json` is the authoritative answer to "what ships", and
  // it runs entirely offline. It also resolves the .npmignore/`files` question:
  // .npmignore lists `docs/` while `files` lists docs/man, docs/data, docs/tools.
  const pack = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 180_000,
  })
  suite.check("`npm pack --dry-run` succeeds", pack.status === 0, `rc=${pack.status}\n${String(pack.stderr).slice(0, 300)}`)
  let shipped: string[] = []
  try { shipped = JSON.parse(String(pack.stdout))[0].files.map((f: any) => f.path) } catch { /* reported below */ }
  suite.check("`npm pack` reports a file list", shipped.length > 0, `files=${shipped.length}`)

  for (const entry of pkg.files ?? []) {
    const trimmed = entry.replace(/\/$/, "")
    const onDisk = repoFileExists(trimmed)
    suite.check(`files entry "${entry}" exists in the repo`, onDisk, trimmed)
    const shippedHere = shipped.filter((f) => f === trimmed || f.startsWith(trimmed + "/"))
    suite.check(
      `files entry "${entry}" actually ships in the tarball`,
      shippedHere.length > 0,
      onDisk ? "present in the repo but absent from the tarball (is .npmignore excluding it?)" : "not in the repo at all",
    )
  }

  // The three docs directories `files` names, file by file — the task's
  // explicit question.
  for (const dir of ["docs/man", "docs/data", "docs/tools"]) {
    const full = path.join(REPO_ROOT, dir)
    if (!existsSync(full)) { suite.note(`${dir} is listed in files but does not exist in the repo`); continue }
    const { readdirSync } = await import("node:fs")
    const onDisk = readdirSync(full).map((f) => `${dir}/${f}`)
    const missing = onDisk.filter((f) => !shipped.includes(f))
    suite.check(
      `every file under ${dir} ships (${onDisk.length} files)`,
      missing.length === 0,
      `not shipped: ${missing.slice(0, 5).join(", ")}`,
    )
  }

  suite.check(
    "package.json is present in the tarball (npm always ships it)",
    shipped.includes("package.json"),
    "",
  )
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("2. the build, and the hook that runs it")
// ─────────────────────────────────────────────────────────────────────────────
{
  // `prepublishOnly` runs on `npm publish` but NOT on `npm pack`. So a tarball
  // produced locally — or by any CI that packs instead of publishing — has no
  // dist/ and its bin/bb cannot resolve its import.
  suite.check(
    "a `prepack` script exists (the hook that runs for BOTH pack and publish)",
    typeof pkg.scripts?.prepack === "string",
    `scripts present: ${Object.keys(pkg.scripts ?? {}).filter((k) => /pack|publish|pre/.test(k)).join(", ") || "(none)"}`,
  )

  const bin = path.join(REPO_ROOT, "bin", "bb")
  suite.check("bin/bb exists", existsSync(bin), bin)
  suite.check("bin/bb has a node shebang", readFileSync(bin, "utf8").startsWith("#!/usr/bin/env node"), readFileSync(bin, "utf8").split("\n")[0])
  const mode = statSync(bin).mode
  suite.check("bin/bb is executable", (mode & 0o111) !== 0, `mode=${(mode & 0o777).toString(8)}`)

  const buildOut = spawnSync("npm", ["run", "build"], { cwd: REPO_ROOT, encoding: "utf8", timeout: 600_000 })
  suite.check("`npm run build` succeeds", buildOut.status === 0, `rc=${buildOut.status}\n${String(buildOut.stderr).slice(-400)}`)
  suite.check("the build emits dist/cli/index.js (what bin/bb imports)", repoFileExists("dist/cli/index.js"), "dist/cli/index.js")

  // Every self-executing entry in src must be a build output, or it ships as
  // source that nothing can run.
  const tsup = readFileSync(path.join(REPO_ROOT, "tsup.config.ts"), "utf8")
  // Match on the SOURCE PATH rather than the entry key: tsup.config.ts writes
  // keys both ways (`index: "…"` and `"cli/index": "…"`), so key-shape matching
  // is a source of false negatives that has nothing to do with the product.
  const tsupEntries: Array<[string, string]> = [
    ["index", "src/index.ts"],
    ["cli/index", "src/cli/index.ts"],
    ["mcp/server", "src/mcp/server.ts"],
    ["lsp/server", "src/lsp/server.ts"],
    ["pool-worker", "src/ast/pool-worker.ts"],
  ]
  for (const [entry, srcPath] of tsupEntries) {
    suite.check(
      `tsup builds the "${entry}" entry from ${srcPath}`,
      tsup.includes(srcPath),
      `tsup.config.ts never references ${srcPath}`,
    )
    suite.check(`dist/${entry}.js exists`, repoFileExists(`dist/${entry}.js`), `dist/${entry}.js`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("3. a clean install layout: run the real binary from a staged package")
// ─────────────────────────────────────────────────────────────────────────────
const stage = stageDir("pkg")
{
  // Stage exactly what the tarball carries, then add node_modules the way an
  // `npm install` would. Nothing from the repo's src/ or test/ is reachable.
  const pack = spawnSync("npm", ["pack", "--dry-run", "--json"], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 180_000 })
  const shipped: string[] = JSON.parse(String(pack.stdout))[0].files.map((f: any) => f.path)
  for (const rel of shipped) {
    const dest = path.join(stage, rel)
    if (rel.endsWith("/")) { mkdirSync(dest, { recursive: true }); continue }
    mkdirSync(path.dirname(dest), { recursive: true })
    cpSync(path.join(REPO_ROOT, rel), dest)
  }
  // Stand in for `npm install`: the published package's dependencies.
  symlinkSync(path.join(REPO_ROOT, "node_modules"), path.join(stage, "node_modules"), "dir")
  chmodSync(path.join(stage, "bin", "bb"), 0o755)

  const stagedBin = path.join(stage, "bin", "bb")
  const fixture = makeFixture("packaged")
  mkdirSync(path.join(fixture, "src"), { recursive: true })
  writeFileSync(path.join(fixture, "src", "pkgmod.ts"), "export function packagedSymbol(x: number): number {\n  return x + 1\n}\n")
  utimesSync(path.join(fixture, "src", "pkgmod.ts"), new Date("2020-01-01T00:00:00Z"), new Date("2020-01-01T00:00:00Z"))

  const run = (args: string[], opts: { input?: string; timeoutMs?: number } = {}) => {
    const r = spawnSync(process.execPath, [stagedBin, ...args], {
      cwd: fixture, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: opts.timeoutMs ?? 240_000,
      input: opts.input ?? "",
      env: { ...process.env, NO_COLOR: "1", BB_LOG_LEVEL: "error", BB_DATA_DIR: path.join(stage, "data"), PATH: process.env.PATH ?? "" },
    })
    return { code: r.status ?? -1, out: String(r.stdout ?? ""), err: String(r.stderr ?? ""), all: String(r.stdout ?? "") + String(r.stderr ?? "") }
  }

  suite.check("the staged package has bin/bb", existsSync(stagedBin), stagedBin)
  suite.check("the staged package has dist/cli/index.js", existsSync(path.join(stage, "dist/cli/index.js")), "")
  suite.check("the staged package has the wasm grammars", existsSync(path.join(stage, "wasm")), "")
  suite.check("the staged package has docs/man/bb.1", existsSync(path.join(stage, "docs/man/bb.1")), "")

  const v = run(["version"])
  suite.check("staged `bb version` exits 0", v.code === 0, `rc=${v.code}\n${v.err.slice(0, 300)}`)
  suite.check("staged `bb version` prints the package version", v.out.trim() === pkg.version, `${v.out.trim()} vs ${pkg.version}`)

  const h = run(["--help"])
  suite.check("staged `bb --help` exits 0", h.code === 0, `rc=${h.code}\n${h.err.slice(0, 300)}`)
  suite.check("staged `bb --help` lists the commands", /Commands:/.test(h.out) && /index/.test(h.out), h.out.split("\n").slice(0, 3).join(" | ").slice(0, 200))

  const up = run(["upgrade"])
  // Same contract as the behaviour suite, and for the same reason: `bb upgrade`
  // exits 0 when it can determine the answer and exits 1 (saying why) when it
  // cannot. `backbencher-brain` is not published — registry.npmjs.org returns
  // 404 — so the honest answer today is "could not check" + exit 1. Requiring 0
  // would push toward printing a false "you are up to date".
  suite.check(
    "staged `bb upgrade` exits 0 when it can answer, and 1 with a reason when it cannot",
    up.code === 0 || (/could not check/i.test(up.all) && up.code === 1),
    `rc=${up.code}\n${up.all.slice(0, 300)}`,
  )

  const idx = run(["index", fixture, "--no-setup"])
  suite.check("staged `bb index` exits 0", idx.code === 0, `rc=${idx.code}\n${idx.all.slice(-400)}`)
  suite.check(
    "staged `bb index` stored at least one symbol",
    /indexed \d+ files, [1-9]\d* symbols/.test(idx.out),
    idx.out.split("\n").filter((l) => l.includes("indexed")).slice(0, 1).join(" | ").slice(0, 200),
  )

  const st = run(["stats", fixture])
  suite.check("staged `bb stats` exits 0", st.code === 0, `rc=${st.code}\n${st.err.slice(0, 200)}`)
  suite.check("staged `bb stats` reports symbols", /symbols [1-9]/.test(st.out), st.out.split("\n").slice(0, 2).join(" | ").slice(0, 200))

  const se = run(["search", "packagedSymbol", "--dir", fixture])
  suite.check("staged `bb search` finds the indexed symbol", se.code === 0 && /packagedSymbol/.test(se.all), `rc=${se.code} ${se.all.split("\n").filter((l) => l.trim()).slice(0, 3).join(" | ").slice(0, 200)}`)

  // The compiled path is the one users actually run, and it is NOT the same code
  // path as the source entry the rest of this suite drives.
  const mcpRun = run(["mcp", "--dir", fixture], { input: `${mcpInitialize()}\n`, timeoutMs: 30_000 })
  const frames = parseJsonRpcLines(mcpRun.out)
  suite.check(
    "staged `bb mcp` (the SHIPPED path) answers an MCP initialize handshake",
    frames.some((f) => f.id === 1 && f.result),
    `rc=${mcpRun.code} frames=${frames.length} stderr=${mcpRun.err.split("\n").filter((l) => l.trim()).slice(0, 2).join(" | ").slice(0, 200)}`,
  )

  const sourceEntry = bb(["mcp", "--dir", fixture], { cwd: fixture, input: `${mcpInitialize()}\n`, timeoutMs: 30_000 })
  const sourceFrames = parseJsonRpcLines(sourceEntry.out)
  suite.check(
    "`bb mcp` from the SOURCE entry (src/cli/index.ts) answers the same handshake",
    sourceFrames.some((f) => f.id === 1 && f.result),
    `rc=${sourceEntry.code} frames=${sourceFrames.length} stderr=${sourceEntry.err.split("\n").filter((l) => l.trim()).slice(0, 2).join(" | ").slice(0, 200)}`,
  )
  if (sourceFrames.length === 0 && frames.length > 0) {
    suite.note(
      "the two entries diverge: bin/bb -> dist works, src/cli/index.ts self-exec does not " +
      "(src/cli/index.ts:904 awaits runCli from inside its own module evaluation, and " +
      "src/mcp/server.ts:7 imports getProjectId back from ../cli/index)",
    )
  }
}

suite.finish()