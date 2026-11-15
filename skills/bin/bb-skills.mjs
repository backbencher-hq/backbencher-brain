#!/usr/bin/env node
/**
 * bb-skills — install/verify the Backbencher Brain agent skills.
 *
 * The package ships one directory per skill (`skills/<name>/SKILL.md`) and this
 * installer copies those directories into a host's skills directory, writing a
 * manifest so a re-run is idempotent and never touches directories it did not create.
 *
 * Hosts (project scope by default):
 *   claude  -> <cwd>/.claude/skills
 *   agents  -> <cwd>/.agents/skills
 *   copilot -> <cwd>/.github/skills
 *   user-claude -> ~/.claude/skills
 *   --dir <path> -> any directory the caller names
 *
 * Plain ESM, no dependencies, Node >= 18.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "..")
const SRC = join(ROOT, "skills")
const MANIFEST = ".bb-skills.json"

function pkg() {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))
}
function skillNames() {
  return readdirSync(SRC, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(SRC, d.name, "SKILL.md")))
    .map((d) => d.name)
    .sort()
}
function usage(exitCode = 0) {
  const text = `bb-skills ${pkg().version} — install agent skills for Backbencher Brain (bb)

Usage:
  bb-skills install [options]      copy every skill into a host skills directory
  bb-skills verify [options]       check an installed directory against this package
  bb-skills list                   list the skills in this package
  bb-skills --help | --version

Options:
  --host <name>    claude | agents | copilot | user-claude   (default: detect)
  --scope <name>   project | user                            (default: project)
  --dir <path>     explicit skills directory (overrides --host/--scope)
  --dry-run        print the actions without writing anything
  --force          re-copy skill directories even when the manifest matches
  --json           machine-readable output
`
  process.stdout.write(text)
  process.exit(exitCode)
}
function argsOf(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--dry-run" || a === "--force" || a === "--json") out[a.slice(2)] = true
    else if (a === "--help" || a === "-h") out.help = true
    else if (a === "--version" || a === "-v") out.version = true
    else if (a === "--host" || a === "--scope" || a === "--dir") out[a.slice(2)] = argv[++i]
    else out._.push(a)
  }
  return out
}
function projectScopeDir(host, cwd) {
  const map = { claude: ".claude/skills", agents: ".agents/skills", copilot: ".github/skills" }
  return map[host] ? join(cwd, map[host]) : null
}
function resolveTarget(o, cwd) {
  if (o.dir) return resolve(cwd, o.dir)
  if (o.host === "user-claude") return join(homedir(), ".claude", "skills")
  if (o.host) return projectScopeDir(o.host, cwd)
  // Detect: prefer an existing conventional directory, project scope.
  for (const host of ["agents", "claude", "copilot"]) {
    const base = projectScopeDir(host, cwd)
    const parent = dirname(base)
    if (existsSync(parent)) return base
  }
  for (const [host, dir] of Object.entries({ claude: join(homedir(), ".claude", "skills") })) {
    if (existsSync(dirname(dir))) return dir
    void host
  }
  return null
}
function readManifest(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, MANIFEST), "utf8"))
  } catch {
    return null
  }
}
function install(o) {
  const cwd = process.cwd()
  const target = resolveTarget(o, cwd)
  if (!target) {
    process.stderr.write(
      "bb-skills: no conventional host skills directory found. Pass --host claude|agents|copilot, --host user-claude, or --dir <path>.\n",
    )
    process.exit(2)
  }
  const names = skillNames()
  const version = pkg().version
  const before = readManifest(target)
  const actions = []
  for (const name of names) {
    const from = join(SRC, name)
    const to = join(target, name)
    const exists = existsSync(to)
    if (exists && before && before.skills?.includes(name) && !o.force) {
      actions.push({ skill: name, action: "unchanged" })
      continue
    }
    if (exists && !before?.skills?.includes(name)) {
      // Never overwrite a directory this installer did not create.
      actions.push({ skill: name, action: "skipped (not installed by bb-skills)" })
      continue
    }
    actions.push({ skill: name, action: exists ? "replaced" : "installed" })
    if (!o["dry-run"]) {
      if (o.force && exists) rmSync(to, { recursive: true, force: true })
      cpSync(from, to, { recursive: true })
    }
  }
  if (!o["dry-run"]) {
    mkdirSync(target, { recursive: true })
    writeFileSync(
      join(target, MANIFEST),
      JSON.stringify({ package: pkg().name, version, skills: names, installedAt: new Date().toISOString() }, null, 2) + "\n",
    )
  }
  if (o.json) process.stdout.write(JSON.stringify({ target, version, actions }, null, 2) + "\n")
  else {
    process.stdout.write(`bb-skills ${version} -> ${target}${o["dry-run"] ? "  (dry run, nothing written)" : ""}\n`)
    for (const a of actions) process.stdout.write(`  ${a.skill}: ${a.action}\n`)
  }
  return 0
}
function verify(o) {
  const cwd = process.cwd()
  const target = resolveTarget(o, cwd)
  if (!target || !existsSync(target)) {
    process.stderr.write("bb-skills: install target not found; pass --dir or --host.\n")
    return 2
  }
  const names = skillNames()
  const manifest = readManifest(target)
  const failures = []
  if (!manifest) failures.push(`missing ${MANIFEST}`)
  for (const name of names) {
    const file = join(target, name, "SKILL.md")
    if (!existsSync(file)) {
      failures.push(`${name}: SKILL.md missing`)
      continue
    }
    const text = readFileSync(file, "utf8")
    if (!/^description:\s*Use when/m.test(text)) failures.push(`${name}: description is not a "use when" line`)
    if (!text.includes("agent-report.yml")) failures.push(`${name}: report line missing`)
  }
  if (o.json) process.stdout.write(JSON.stringify({ target, failures, ok: failures.length === 0 }, null, 2) + "\n")
  else if (failures.length) {
    for (const f of failures) process.stdout.write(`FAIL ${f}\n`)
  } else process.stdout.write(`OK ${target}: ${names.length}/${names.length} skills installed by ${manifest.package}@${manifest.version}\n`)
  return failures.length ? 1 : 0
}
const o = argsOf(process.argv.slice(2))
if (o.help) usage(0)
if (o.version) {
  process.stdout.write(`${pkg().version}\n`)
  process.exit(0)
}
const cmd = o._[0] ?? "install"
if (cmd === "list") {
  for (const n of skillNames()) process.stdout.write(`${n}\n`)
  process.exit(0)
}
if (cmd === "install") process.exit(install(o))
if (cmd === "verify") process.exit(verify(o))
process.stderr.write(`bb-skills: unknown command '${cmd}'\n`)
usage(2)
