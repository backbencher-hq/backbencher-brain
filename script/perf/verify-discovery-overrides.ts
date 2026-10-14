#!/usr/bin/env npx tsx
/**
 * verify-discovery-overrides.ts — can a project override bb's built-in file skips?
 *
 * Why this exists
 * ---------------
 * Discovery used to run its built-in rules BEFORE consulting `.bbignore`/`.gitignore`,
 * and none of the built-in rules supported negation. Measured consequence in this
 * repository: the compiled-mode list hid 17 first-party files under `script/perf/**`
 * (including the gate that verifies the worker pool) and `/bin/` hid the shipped
 * `bin/bb` launcher — and NO ignore file could bring any of them back. A default a
 * user cannot override is a bug, so the walk now reads the ignore verdict first and
 * lets an explicit `!pattern` escape the built-in skips for that subtree.
 *
 * This gate proves the override works, and that the defaults it overrides still hold
 * when nobody overrides them. It builds two scratch projects from the SAME fixture
 * tree — one `.bbignore` with negations, one without — indexes both with the real CLI,
 * and reads the resulting `brain_file` rows. Every contract is therefore a statement
 * about what the product did, not about what the code appears to do.
 *
 * Contracts
 * ---------
 *   WITH negations       WITHOUT negations        what it proves
 *   src/bin/tool.ts      absent                   `!src/bin/` escapes the /bin/ built-in
 *   src/gen/api.ts       absent                   `!src/gen/` escapes the skipPattern
 *   bin/launcher         absent                   `!bin/` + a node shebang escapes both
 *                                                 the /bin/ rule and the extension gate
 *   script/perf/bench.ts present                  `/perf/` no longer hides source
 *   sub/y.ts             absent                   a `.git` FILE (submodule/worktree) is a
 *                                                 project boundary
 *   sub2/z.ts            present                  ...but an ordinary subdirectory is not
 *   secret.ts            absent                   normal ignoring still works
 *
 * Usage: npx tsx script/perf/verify-discovery-overrides.ts [--keep]
 * Exit:  0 all contracts hold, 1 otherwise.
 */
import { spawn } from "node:child_process"
import { mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs"
import path from "node:path"
import Database from "better-sqlite3"

const REPO = process.cwd()
const SCRATCH = path.join(REPO, ".discovery-scratch")
const keep = process.argv.includes("--keep")

let failures = 0
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures++
}

const TS = (name: string) =>
  `export interface ${name}Shape { id: number }\nexport class ${name}Box implements ${name}Shape {\n  id = 1\n  open(): string { return "open" }\n}\nexport function ${name}Make(s: string): string { return s }\n`

function buildTree(root: string, withNegations: boolean) {
  const put = (rel: string, body: string) => {
    const full = path.join(root, rel)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, body)
  }
  // Source the built-in rules would hide.
  put("src/bin/tool.ts", TS("Bin"))
  put("src/gen/api.ts", TS("Gen"))
  // An extensionless launcher with a node shebang, one level down so the `/bin/`
  // substring rule applies to it.
  put("bin/launcher", "#!/usr/bin/env node\n// a launcher, not a build artifact\nexport const launched = true\n")
  // A perf directory: no longer hidden by default.
  put("script/perf/bench.ts", TS("Bench"))
  // A nested project boundary written the way git writes a submodule.
  put("sub/.git", "gitdir: ../.git/modules/sub\n")
  put("sub/y.ts", TS("Sub"))
  // An ordinary nested directory.
  put("sub2/z.ts", TS("Sub2"))
  // Ignored by the ignore file, never negated.
  put("secret.ts", TS("Secret"))
  put("keep.ts", TS("Keep"))

  const bbignore = [
    "# a file-level ignore, to prove normal ignoring still works",
    "secret.ts",
    ...(withNegations
      ? ["", "# the user says these built-in-skipped paths are source", "!src/bin/", "!src/gen/", "!bin/"]
      : []),
    "",
  ].join("\n")
  writeFileSync(path.join(root, ".bbignore"), bbignore)
}

function runIndex(projectDir: string, dataDir: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["tsx", "src/cli/index.ts", "index", projectDir, "--no-setup"], {
      cwd: REPO,
      env: { ...process.env, BB_DATA_DIR: dataDir },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (d) => { stdout += d.toString() })
    child.stderr.on("data", (d) => { stderr += d.toString() })
    child.on("close", (code) => resolve({ code, stdout, stderr }))
  })
}

function indexedFiles(dataDir: string, projectRoot: string): Map<string, string> {
  const projectsRoot = path.join(dataDir, "projects")
  const projectDir = path.join(projectsRoot, readdirSync(projectsRoot)[0])
  const db = new Database(path.join(projectDir, "brain.db"), { readonly: true })
  const rows = db.prepare("SELECT path, language FROM brain_file").all() as Array<{ path: string; language: string }>
  db.close()
  // `brain_file.path` stores ABSOLUTE paths (verified: 5,086 of 5,086 rows in the real
  // index). The first version of this gate compared them against project-relative
  // expectations, so every POSITIVE assertion failed while every NEGATIVE one passed
  // trivially — a gate that looked decisive and measured nothing. Keys are made
  // project-relative here.
  const prefix = projectRoot.endsWith("/") ? projectRoot : projectRoot + "/"
  return new Map(
    rows.map((r) => [r.path.startsWith(prefix) ? r.path.slice(prefix.length) : r.path.replace(/^\.\//, ""), r.language]),
  )
}

async function main() {
  console.log(`\nDISCOVERY OVERRIDES — built-in skips vs an explicit !pattern, on real index runs\n`)
  rmSync(SCRATCH, { recursive: true, force: true })

  const projectA = path.join(SCRATCH, "project-with-negations")
  const projectB = path.join(SCRATCH, "project-without-negations")
  buildTree(projectA, true)
  buildTree(projectB, false)

  const dataA = path.join(SCRATCH, "data-a")
  const dataB = path.join(SCRATCH, "data-b")
  const [ra, rb] = [await runIndex(projectA, dataA), await runIndex(projectB, dataB)]

  check("both index runs completed", ra.code === 0 && rb.code === 0, `exit ${ra.code} / ${rb.code}`)

  const a = indexedFiles(dataA, projectA)
  const b = indexedFiles(dataB, projectB)

  console.log("\n── WITH `!pattern` overrides")
  check("`!src/bin/` escapes the built-in /bin/ rule", a.has("src/bin/tool.ts"))
  check("`!src/gen/` escapes the built-in gen skipPattern", a.has("src/gen/api.ts"))
  check(
    "`!bin/` + a node shebang admits an extensionless launcher, as javascript",
    a.get("bin/launcher") === "javascript",
    `language=${a.get("bin/launcher") ?? "not indexed"}`,
  )

  console.log("\n── WITHOUT overrides (the same tree, the defaults alone)")
  check("the /bin/ rule still hides src/bin/tool.ts by default", !b.has("src/bin/tool.ts"))
  check("the gen skipPattern still hides src/gen/api.ts by default", !b.has("src/gen/api.ts"))
  check("an extensionless launcher under bin/ is still hidden by default", !b.has("bin/launcher"))

  console.log("\n── defaults that changed, and the ones that must not have")
  check("`script/perf/` is no longer hidden by a built-in rule (measured: 17 files here)", b.has("script/perf/bench.ts"))
  check("a `.git` FILE is a project boundary (submodule/worktree)", !b.has("sub/y.ts") && !a.has("sub/y.ts"))
  check("an ordinary subdirectory is not a boundary", b.has("sub2/z.ts") && a.has("sub2/z.ts"))
  check("a normally ignored file stays ignored", !b.has("secret.ts") && !a.has("secret.ts"))
  check("ordinary source is indexed in both", a.has("keep.ts") && b.has("keep.ts"))

  console.log(
    failures === 0
      ? `\nDISCOVERY OVERRIDES: ALL PASS (${a.size} files in the override project, ${b.size} without)\n`
      : `\nDISCOVERY OVERRIDES: ${failures} FAILURE(S)\n`,
  )
  if (!keep) rmSync(SCRATCH, { recursive: true, force: true })
  else console.log(`scratch kept at ${SCRATCH}\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error("harness error:", e)
  process.exit(1)
})
