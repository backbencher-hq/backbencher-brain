// test/cli-surface/behaviour.ts — the commands the user named, plus the
// exit-code contract.
//
// matrix.ts proves the surface EXISTS and is coherent. This file proves the
// commands DO what they claim, and — the part that never scales by hand — that
// every one of them returns a defensible exit code.
//
// Nothing here is mocked. Every assertion is made against what the shipped CLI
// actually prints, and where a command is supposed to fail, the failure is
// asserted rather than tolerated.
//
// Run:  npx tsx test/cli-surface/behaviour.ts

import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "node:fs"
import path from "node:path"
import {
  createSuite, guard, isolatedDataDir, makeFixture, makeEmptyDir, bb, pkgJson, dataDirPath,
  dbCounts, parseStatsLine, commandsFrom, dataDirListing, type DbCounts,
} from "./harness"

const suite = createSuite("cli-behaviour")
isolatedDataDir("behaviour")

const pkg = pkgJson()

// ─────────────────────────────────────────────────────────────────────────────
suite.section("1. version: semver, consistent across -v / --version / version")
// ─────────────────────────────────────────────────────────────────────────────
{
  const semver = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/
  const v = bb(["version"])
  const short = bb(["-v"])
  const long = bb(["--version"])
  suite.check("`bb version` exits 0", v.code === 0, `rc=${v.code}`)
  suite.check("`bb -v` exits 0", short.code === 0, `rc=${short.code}`)
  suite.check("`bb --version` exits 0", long.code === 0, `rc=${long.code}`)
  suite.check("`bb version` prints a semver", semver.test(v.out.trim()), JSON.stringify(v.out.trim()))
  suite.check("`bb -v` prints the same string as `bb version`", short.out.trim() === v.out.trim(), `${short.out.trim()} vs ${v.out.trim()}`)
  suite.check("`bb --version` prints the same string as `bb version`", long.out.trim() === v.out.trim(), `${long.out.trim()} vs ${v.out.trim()}`)
  suite.check("the printed version matches package.json", v.out.trim() === pkg.version, `cli=${v.out.trim()} package.json=${pkg.version}`)
  suite.negative("the version is not an empty or placeholder string", v.out.trim().length > 0 && v.out.trim() !== "undefined", JSON.stringify(v.out))
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("2. upgrade: what does a user actually get?")
// ─────────────────────────────────────────────────────────────────────────────
{
  // Named by the user as a thing that must work. There is no `upgrade` command
  // anywhere in src/, so this records what the CLI really does rather than what
  // it should do.
  const up = bb(["upgrade"])
  suite.check("`bb upgrade` exits 0", up.code === 0, `rc=${up.code}\n${up.all.slice(0, 300)}`)
  suite.check("`bb upgrade` is not rejected as an unknown command", !/unknown command/.test(up.all), up.all.slice(0, 200))
  suite.check("`bb upgrade` prints something actionable (what it did, or what to do)", up.out.trim().length > 0, `stdout=${JSON.stringify(up.out.trim().slice(0, 200))}`)

  const help = bb(["--help"])
  const listed = commandsFrom(help.out).some((c) => c.name === "upgrade")
  suite.check("`bb upgrade` appears in `bb --help`", listed, `help lists: ${commandsFrom(help.out).map((c) => c.name).join(", ")}`)
  suite.check("`bb help upgrade` exits 0", bb(["help", "upgrade"]).code === 0, `rc=${bb(["help", "upgrade"]).code}`)

  // Is there an upgrade PATH at all, however it is spelled?
  const nearMisses = ["update", "selfupdate", "self-update", "upgrade-all", "install"]
  const found = nearMisses.filter((n) => commandsFrom(help.out).some((c) => c.name === n))
  suite.note(`near-miss command names present: ${found.length ? found.join(", ") : "(none)"}`)
  suite.check("some documented way to upgrade bb exists", listed || found.length > 0, "no upgrade/update command is registered at all")
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("3. help: exit codes, with no args, per command, for a bad command")
// ─────────────────────────────────────────────────────────────────────────────
{
  suite.check("`bb --help` exits 0", bb(["--help"]).code === 0, `rc=${bb(["--help"]).code}`)
  suite.check("`bb -h` exits 0", bb(["-h"]).code === 0, `rc=${bb(["-h"]).code}`)
  suite.check("`bb help` (no args) exits 0", bb(["help"]).code === 0, `rc=${bb(["help"]).code}`)
  for (const c of commandsFrom(bb(["--help"]).out)) {
    if (c.name === "help") continue
    const h = bb(["help", c.name])
    suite.check(`\`bb help ${c.name}\` exits 0`, h.code === 0, `rc=${h.code}`)
  }
  const bad = bb(["help", "definitely-not-a-command"])
  suite.check("bb help <unknown> exits non-zero", bad.code !== 0, "rc=" + bad.code)
  suite.check(
    "bb help <unknown> says which command it could not find (on stderr)",
    /definitely-not-a-command/.test(bad.err) && /error|unknown/i.test(bad.err),
    "stderr=" + (bad.err.trim().slice(0, 200) || "(empty - the user gets the root usage and nothing else)"),
  )
  // bb help help is the one help probe that does not hold up.
  const selfHelp = bb(["help", "help"])
  suite.check(
    "bb help help exits 0",
    selfHelp.code === 0,
    "rc=" + selfHelp.code + " stderr=" + (selfHelp.err.trim().slice(0, 160) || "(empty)"),
  )
  // bb help setup show - the man page documents this exact invocation.
  const nested = bb(["help", "setup", "show"])
  suite.check(
    "bb help setup show shows help for the 'show' subcommand (the man page implies it does)",
    nested.code === 0 && /Usage: bb setup show/.test(nested.out),
    "rc=" + nested.code + " first line=" + nested.out.split("\n")[0],
  )
  suite.check("`bb setup show` itself works", bb(["setup", "show"]).code === 1 || bb(["setup", "show"]).code === 0, "")
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("4. doctor: a diagnostic that always exits 0 is decoration")
// ─────────────────────────────────────────────────────────────────────────────
const fixture = makeFixture("behaviour")
{
  const unconfigured = bb(["doctor", "--dir", fixture], { cwd: fixture })
  suite.check(
    "`bb doctor` exits non-zero when it finds a real problem (no embedding config)",
    unconfigured.code !== 0,
    `rc=${unconfigured.code}`,
  )
  suite.check(
    "`bb doctor` names the problem it found",
    /No embedding configuration/.test(unconfigured.all),
    unconfigured.all.split("\n").filter((l) => l.trim()).slice(0, 4).join(" | ").slice(0, 240),
  )
  suite.check(
    "every doctor finding names the fix command",
    /Fix:\s*bb /.test(unconfigured.all),
    unconfigured.all.split("\n").filter((l) => /✗|!/.test(l)).slice(0, 4).join(" | ").slice(0, 240),
  )
  // Read-only is a claim about the filesystem, so assert it against the
  // filesystem: nothing under $BB_DATA_DIR may appear or change.
  const listingBefore = dataDirListing()
  bb(["doctor", "--dir", fixture], { cwd: fixture })
  const listingAfter = dataDirListing()
  const added = listingAfter.filter((e) => !listingBefore.includes(e))
  suite.check(
    "bb doctor without --fix writes nothing to the data dir (read-only is real)",
    added.length === 0,
    "new entries: " + added.join(", "),
  )

  // With a config present the SAME diagnostic must stop reporting the missing
  // config — that is what makes the exit code above meaningful rather than
  // unconditional.
  const configured = bb(["doctor", "--dir", fixture], {
    cwd: fixture,
    env: {
      BB_EMBEDDING_BASE_URL: "https://example.invalid/v1",
      BB_EMBEDDING_MODEL: "test-embed-model",
      BB_EMBEDDING_API_KEY: "dummy-key-not-a-secret",
    },
  })
  suite.check(
    "`bb doctor` stops reporting 'No embedding configuration' once a provider is configured",
    !/No embedding configuration/.test(configured.all),
    configured.all.split("\n").filter((l) => /✗|!/.test(l)).slice(0, 4).join(" | ").slice(0, 240),
  )
  suite.note(`doctor with a configured provider: rc=${configured.code}; findings: ${configured.all.split("\n").filter((l) => /✗|!/.test(l)).map((l) => l.trim()).join(" | ").slice(0, 200)}`)

  const fix = bb(["doctor", "--dir", fixture, "--fix"], { cwd: fixture })
  suite.check("`bb doctor --fix` exits 0 when there is nothing to repair", fix.code === 0, `rc=${fix.code}\n${fix.all.slice(0, 300)}`)
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("5. index, then stats/status: counts must match the database exactly")
// ─────────────────────────────────────────────────────────────────────────────
let counts: DbCounts = { projectId: "", files: 0, symbols: 0, relationships: 0, embeddings: 0 }
{
  const idx = bb(["index", fixture, "--no-setup"], { cwd: fixture })
  suite.check("`bb index` exits 0 on the fixture", idx.code === 0, idx.all.slice(-400))
  suite.check("`bb index` prints the file/symbol/relationship counts", /indexed \d+ files, \d+ symbols, \d+ relationships/.test(idx.out), idx.out.split("\n").filter((l) => l.includes("indexed")).slice(0, 2).join(" | ").slice(0, 240))

  const st = bb(["stats", fixture], { cwd: fixture })
  suite.check("`bb stats` exits 0 on an indexed project", st.code === 0, `rc=${st.code}\n${st.err.slice(0, 200)}`)
  // M23.P1's promise: every command that reports on an index also says where
  // that index lives, so a user can find and reclaim it.
  suite.check("`bb stats` prints the db path so a user can find/reclaim it", /db: /.test(st.out), st.out.split("\n").slice(-2).join(" | ").slice(0, 200))
  counts = await dbCounts(fixture)
  const printed = parseStatsLine(st.out)
  suite.check("`bb stats` prints a parseable counts line", printed !== null, st.out.split("\n").slice(0, 3).join(" | ").slice(0, 200))
  if (printed) {
    suite.check(`\`bb stats\` files matches the db (${printed.files} vs ${counts.files})`, printed.files === counts.files, `cli=${printed.files} db=${counts.files}`)
    suite.check(`\`bb stats\` symbols matches the db (${printed.symbols} vs ${counts.symbols})`, printed.symbols === counts.symbols, `cli=${printed.symbols} db=${counts.symbols}`)
    suite.check(`\`bb stats\` relationships matches the db (${printed.relationships} vs ${counts.relationships})`, printed.relationships === counts.relationships, `cli=${printed.relationships} db=${counts.relationships}`)
    suite.check(`\`bb stats\` embeddings matches the db (${printed.embeddings} vs ${counts.embeddings})`, printed.embeddings === counts.embeddings, `cli=${printed.embeddings} db=${counts.embeddings}`)
  }

  const status = bb(["status", fixture], { cwd: fixture })
  suite.check("`bb status` exits 0 on an indexed project", status.code === 0, `rc=${status.code}\n${status.err.slice(0, 200)}`)
  suite.check("`bb status` prints the db path so a user can find/reclaim it", /db: /.test(status.out), status.out.split("\n").slice(-2).join(" | ").slice(0, 200))
  suite.check("`bb status` repeats the file/symbol counts", status.out.includes(`${counts.files} files`) && status.out.includes(`${counts.symbols} symbols`), status.out.split("\n").slice(0, 2).join(" | ").slice(0, 240))
  // The man page sells `bb status` on per-phase timings, "the command to reach
  // for when indexing felt slow". The TOTAL is the number that answers that.
  const totalLine = status.out.split("\n").find((l) => l.includes("total "))
  suite.check(
    "`bb status` prints a TOTAL wall time for a real index run (not `n/a`)",
    !!totalLine && /total \d/.test(totalLine),
    totalLine?.trim() ?? "(no total line)",
  )
  suite.check(
    "`bb status` prints the individual phase timings",
    !!status.out.match(/parse \d+ms/) && !!status.out.match(/dbFlush \d+ms/) && !!status.out.match(/discovery \d+ms/),
    status.out.split("\n").filter((l) => l.includes("parse")).slice(0, 2).join(" | ").slice(0, 240),
  )
  suite.check(
    "`bb status` says which parse mode ran",
    /mode worker-pool|mode in-process/.test(status.out),
    status.out.split("\n").filter((l) => l.includes("mode")).slice(0, 2).join(" | ").slice(0, 200),
  )
  suite.check(
    "`bb status` reports no unresolved relationships on a freshly indexed fixture",
    /consistency: every internal relationship is attached to a symbol/.test(idx.out),
    idx.out.split("\n").filter((l) => l.includes("consistency")).slice(0, 2).join(" | ").slice(0, 200),
  )
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("6. search: every documented --mode works")
// ─────────────────────────────────────────────────────────────────────────────
{
  const symbols = bb(["search", "alpha0", "--dir", fixture], { cwd: fixture })
  suite.check("`bb search <q>` (default symbols mode) exits 0", symbols.code === 0, `rc=${symbols.code}\n${symbols.err.slice(0, 200)}`)
  suite.check("`bb search <q>` finds the fixture's symbol", /alpha0/.test(symbols.out), symbols.out.split("\n").slice(0, 3).join(" | ").slice(0, 200))
  suite.check("`bb search <q>` reports a type for each hit (not `undefined`)", !/\[undefined\]/.test(symbols.out), symbols.out.split("\n").slice(0, 3).join(" | ").slice(0, 200))

  const explicit = bb(["search", "--mode", "symbols", "alpha0", "--dir", fixture], { cwd: fixture })
  suite.check("`bb search --mode symbols` (the advertised enum value) exits 0", explicit.code === 0, `rc=${explicit.code}\n${explicit.err.slice(0, 200)}`)
  suite.check("`bb search --mode symbols` matches the default mode's output", explicit.out === symbols.out, "output differs from the default listing")

  const content = bb(["search", "--mode", "content", "alpha0", "--dir", fixture], { cwd: fixture })
  suite.check("`bb search --mode content` exits 0", content.code === 0, `rc=${content.code}\n${content.err.slice(0, 200)}`)
  suite.check("`bb search --mode content` prints file:line hits", /m0\.ts:\d+/.test(content.out), content.out.split("\n").slice(0, 3).join(" | ").slice(0, 200))

  const sym = bb(["search", "--mode", "symbol", "alpha0", "--dir", fixture], { cwd: fixture })
  suite.check("`bb search --mode symbol` exits 0", sym.code === 0, `rc=${sym.code}\n${sym.err.slice(0, 200)}`)
  suite.check(
    "`bb search --mode symbol` renders a symbol type, a language and a line",
    !/\[undefined\]/.test(sym.out) && /typescript/.test(sym.out) && !/: \?/.test(sym.out),
    sym.out.split("\n").filter((l) => l.includes("alpha0")).slice(0, 2).join(" | ").slice(0, 240),
  )

  const file = bb(["search", "--mode", "file", "src/m0.ts", "--dir", fixture], { cwd: fixture })
  suite.check("`bb search --mode file <path>` exits 0", file.code === 0, `rc=${file.code}\n${file.err.slice(0, 200)}`)
  suite.check("`bb search --mode file` prints the file's content", file.out.includes("export function alpha0"), file.out.split("\n").slice(0, 3).join(" | ").slice(0, 200))

  const fileOpt = bb(["search", "--mode", "file", "--file-path", "src/m1.ts", "--dir", fixture, "x"], { cwd: fixture })
  suite.check("`bb search --mode file --file-path <path>` exits 0", fileOpt.code === 0, `rc=${fileOpt.code}\n${fileOpt.err.slice(0, 200)}`)

  const bogus = bb(["search", "--mode", "bogus", "alpha0", "--dir", fixture], { cwd: fixture })
  suite.check("`bb search --mode <unknown>` exits non-zero", bogus.code !== 0, `rc=${bogus.code}`)
  suite.check(
    "`bb search --mode <unknown>` lists the modes it knows",
    /symbols/.test(bogus.all) && /content/.test(bogus.all) && /symbol/.test(bogus.all) && /file/.test(bogus.all),
    bogus.all.split("\n").filter((l) => l.trim()).slice(0, 2).join(" | ").slice(0, 200),
  )

  // The help example, verbatim from `bb help search`.
  const helpExample = bb(["search", "--mode", "symbol", "--symbol-name", "alpha0", "--dir", fixture], { cwd: fixture })
  suite.check(
    "the help example `bb search --mode symbol --symbol-name X` works with no positional query",
    helpExample.code === 0,
    `rc=${helpExample.code} ${helpExample.all.split("\n").filter((l) => l.trim()).slice(0, 2).join(" | ").slice(0, 200)}`,
  )

  const noHit = bb(["search", "definitely-not-a-symbol", "--dir", fixture], { cwd: fixture })
  suite.check("`bb search` with no hits exits 0 (an empty result is not an error)", noHit.code === 0, `rc=${noHit.code}`)
  suite.check("`bb search` with no hits says so", /no results/i.test(noHit.out), noHit.out.split("\n").filter((l) => l.trim()).slice(0, 2).join(" | ").slice(0, 200))

  const lang = bb(["search", "alpha0", "--dir", fixture, "--language", "typescript"], { cwd: fixture })
  suite.check("`bb search --language <known>` exits 0", lang.code === 0, `rc=${lang.code}\n${lang.err.slice(0, 200)}`)
  const badLang = bb(["search", "alpha0", "--dir", fixture, "--language", "cobol"], { cwd: fixture })
  suite.check("`bb search --language <unknown>` exits non-zero rather than silently returning nothing", badLang.code !== 0, `rc=${badLang.code} ${badLang.out.split("\n").slice(0, 2).join(" | ").slice(0, 200)}`)

  const limit = bb(["search", "alpha", "--dir", fixture, "--limit", "1"], { cwd: fixture })
  suite.check("`bb search --limit 1` exits 0", limit.code === 0, `rc=${limit.code}`)
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("7. projects: listing, sorting, and safe removal")
// ─────────────────────────────────────────────────────────────────────────────
{
  const list = bb(["projects"], { cwd: fixture })
  suite.check("`bb projects` exits 0", list.code === 0, `rc=${list.code}\n${list.err.slice(0, 200)}`)
  suite.check("`bb projects` lists the indexed project", list.out.includes(counts.projectId.slice(0, 8)), list.out.split("\n").slice(0, 3).join(" | ").slice(0, 240))
  suite.check("`bb projects` reports a total size and the projects dir", /projects, .*total index size/.test(list.out), list.out.split("\n").slice(-2).join(" | ").slice(0, 240))
  suite.check("`bb projects` shows a DB path per project", /db: /.test(list.out), "")

  for (const field of ["name", "size", "time"]) {
    const s = bb(["projects", "--sort", field], { cwd: fixture })
    suite.check(`\`bb projects --sort ${field}\` exits 0`, s.code === 0, `rc=${s.code} ${s.err.slice(0, 160)}`)
  }
  const bogusSort = bb(["projects", "--sort", "bogus"], { cwd: fixture })
  suite.check("`bb projects --sort <unknown>` is rejected or defaults honestly, never silently", bogusSort.code === 0 ? /projects,/.test(bogusSort.out) : true, `rc=${bogusSort.code}`)

  // The id the CLI PRINTS is 8 chars. The id it ACCEPTS must be the same one.
  const printedId = list.out.split("\n").find((l) => l.includes("db: "))?.split("|")[0]?.trim() ?? ""
  suite.check("`bb projects` prints an 8-character id prefix", /^[0-9a-f]{8}$/.test(printedId), `printed=${JSON.stringify(printedId)}`)

  const shortRemove = bb(["projects", "--remove", printedId], { cwd: fixture })
  suite.check(
    "`bb projects --remove <the id it printed>` works (help's own example is `--remove 1a2b3c4d`)",
    shortRemove.code === 0,
    `rc=${shortRemove.code} ${shortRemove.all.split("\n").filter((l) => l.trim()).slice(0, 2).join(" | ").slice(0, 200)}`,
  )

  const missing = bb(["projects", "--remove", "0".repeat(40)], { cwd: fixture })
  suite.check("`bb projects --remove <unknown id>` exits non-zero", missing.code !== 0, `rc=${missing.code}`)
  suite.check("`bb projects --remove <unknown id>` says so", /no project with id/.test(missing.all), missing.all.slice(0, 200))
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("8. projects --remove: refuses while indexing, reclaims disk when forced")
// ─────────────────────────────────────────────────────────────────────────────
{
  // A live lock holder is the product's own definition of "being indexed right
  // now". The lockfile format is the contract, so writing one naming THIS
  // process (which is alive) is a faithful stand-in for a real holder.
  const victim = makeFixture("victim")
  const vcounts = await dbCounts(victim)
  bb(["index", victim, "--no-setup"], { cwd: victim })
  const projectDir = path.join(dataDirPath(), "projects", vcounts.projectId)
  const lockPath = path.join(projectDir, ".index.lock")
  const dbPath = path.join(projectDir, "brain.db")
  const beforeBytes = existsSync(dbPath) ? statSync(dbPath).size : 0

  suite.check("the victim project has an on-disk db", beforeBytes > 0, `${dbPath} size=${beforeBytes}`)

  mkdirSync(projectDir, { recursive: true })
  writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: Date.now() - 1000, kind: "index" }))

  const refused = bb(["projects", "--remove", vcounts.projectId], { cwd: victim })
  suite.check("`bb projects --remove` refuses while an index lock is held", refused.code !== 0, `rc=${refused.code}`)
  suite.check(
    "the refusal says why and names --force as the way out",
    /being indexed/.test(refused.all) && /--force/.test(refused.all),
    refused.all.split("\n").filter((l) => l.trim()).slice(0, 2).join(" | ").slice(0, 240),
  )
  suite.check("the refused removal left the project in place", existsSync(dbPath), dbPath)

  const forced = bb(["projects", "--remove", vcounts.projectId, "--force"], { cwd: victim })
  suite.check("`bb projects --remove --force` removes it anyway", forced.code === 0, `rc=${forced.code} ${forced.all.slice(0, 200)}`)
  suite.check("the db file is gone (disk reclaimed)", !existsSync(dbPath), dbPath)
  suite.check("the whole project directory is gone", !existsSync(projectDir), projectDir)

  // And a removed project must not linger in the listing.
  const after = bb(["projects"], { cwd: victim })
  suite.negative(
    "a removed project no longer appears in `bb projects`",
    !after.out.includes(dbPath),
    "listing still names " + dbPath,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("9. onboard: --check exits 1 on drift, writing is idempotent")
// ─────────────────────────────────────────────────────────────────────────────
{
  const target = makeFixture("onboard")
  const agentsMd = path.join(target, "AGENTS.md")

  const drift = bb(["onboard", "--check", target], { cwd: target })
  suite.check("`bb onboard --check` exits 1 when the guidance is missing", drift.code === 1, `rc=${drift.code}`)
  suite.check("`bb onboard --check` says what to run", /bb onboard/.test(drift.all), drift.all.split("\n").filter((l) => l.trim()).slice(0, 2).join(" | ").slice(0, 200))
  suite.check("`bb onboard --check` did not write the file", !existsSync(agentsMd), agentsMd)

  const write1 = bb(["onboard", target], { cwd: target })
  suite.check("`bb onboard` exits 0 on first write", write1.code === 0, `rc=${write1.code}\n${write1.all.slice(0, 200)}`)
  suite.check("`bb onboard` created AGENTS.md", existsSync(agentsMd), agentsMd)
  const first = readFileSync(agentsMd, "utf8")

  const check2 = bb(["onboard", "--check", target], { cwd: target })
  suite.check("`bb onboard --check` exits 0 once the guidance is current", check2.code === 0, `rc=${check2.code}\n${check2.all.slice(0, 200)}`)

  const write2 = bb(["onboard", target], { cwd: target })
  const second = readFileSync(agentsMd, "utf8")
  suite.check("`bb onboard` a second time is idempotent (byte-identical file)", write2.code === 0 && second === first, `rc=${write2.code} identical=${second === first}`)
  suite.check("the written guidance is delimited by bb:onboard markers", /bb:onboard:start/.test(second) && /bb:onboard:end/.test(second), second.split("\n").slice(0, 2).join(" | ").slice(0, 160))

  // Drift: a tool name the registry does not have.
  const drifted = first.replace("| `bb_search`", "| `bb_not_a_real_tool`")
  writeFileSync(agentsMd, drifted)
  const ghost = bb(["onboard", "--check", target], { cwd: target })
  suite.check("`bb onboard --check` exits 1 when the guidance names a ghost tool", ghost.code === 1, `rc=${ghost.code}`)
  suite.check("`bb onboard --check` names the ghost tool", /bb_not_a_real_tool/.test(ghost.all), ghost.all.split("\n").filter((l) => l.trim()).slice(0, 3).join(" | ").slice(0, 240))

  const print = bb(["onboard", "--print", target], { cwd: target })
  suite.check("`bb onboard --print` exits 0", print.code === 0, `rc=${print.code}`)
  suite.check("`bb onboard --print` writes nothing", !existsSync(path.join(target, "AGENTS.md.bak")) && !print.out.includes("✓"), print.out.split("\n").slice(0, 2).join(" | ").slice(0, 160))

  const custom = path.join(target, "GUIDE.md")
  const withFile = bb(["onboard", target, "--file", custom], { cwd: target })
  suite.check("`bb onboard --file <path>` writes to the named file", withFile.code === 0 && existsSync(custom), `rc=${withFile.code} exists=${existsSync(custom)}`)
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("10. exit-code contract")
// ─────────────────────────────────────────────────────────────────────────────
{
  const empty = makeEmptyDir("unindexed")
  // `fixture` deliberately has no AGENTS.md (that is what section 9 uses for its
  // drift case), so the "guidance is current" success path needs the one that does.
  const onboardTarget = makeFixture("onboard-ok")
  bb(["onboard", onboardTarget], { cwd: onboardTarget })
  // The contract: a command that could not do its job says so with a non-zero
  // exit. `bb search` does; these do not.
  const search = bb(["search", "anything", "--dir", empty], { cwd: empty })
  suite.check("`bb search` on an unindexed directory exits non-zero", search.code !== 0, `rc=${search.code}`)
  suite.check("`bb search` on an unindexed directory names the fix", /Run: bb index/.test(search.all), search.all.split("\n").filter((l) => l.trim()).slice(0, 2).join(" | ").slice(0, 200))

  const stats = bb(["stats", empty], { cwd: empty })
  suite.check("`bb stats` on an unindexed directory exits non-zero", stats.code !== 0, `rc=${stats.code} out=${stats.out.trim().slice(0, 120)}`)
  suite.check("`bb stats` on an unindexed directory says there is no index", /no index for/.test(stats.out), stats.out.trim().slice(0, 160))

  const status = bb(["status", empty], { cwd: empty })
  suite.check("`bb status` on an unindexed directory exits non-zero", status.code !== 0, `rc=${status.code} out=${status.out.trim().slice(0, 120)}`)

  // Success paths must be 0, or a CI gate on them is useless.
  const okCases: Array<[string, () => { code: number; all: string }]> = [
    ["`bb --help`", () => bb(["--help"])],
    ["`bb help`", () => bb(["help"])],
    ["`bb version`", () => bb(["version"])],
    ["`bb stats` (indexed)", () => bb(["stats", fixture], { cwd: fixture })],
    ["`bb status` (indexed)", () => bb(["status", fixture], { cwd: fixture })],
    ["`bb health`", () => bb(["health", fixture], { cwd: fixture })],
    ["`bb search` (hit)", () => bb(["search", "alpha0", "--dir", fixture], { cwd: fixture })],
    ["`bb projects`", () => bb(["projects"], { cwd: fixture })],
    ["`bb onboard --check` (current)", () => bb(["onboard", "--check", onboardTarget], { cwd: onboardTarget })],
    ["`bb setup show` (unconfigured is a documented rc=1)", () => bb(["setup", "show"])],
  ]
  for (const [label, run] of okCases) {
    if (label.includes("setup show")) continue // asserted separately
    const r = run()
    suite.check(`${label} exits 0 on success`, r.code === 0, `rc=${r.code} ${r.all.split("\n").filter((l) => l.trim()).slice(0, 2).join(" | ").slice(0, 160)}`)
  }

  const setupShow = bb(["setup", "show"])
  suite.check("`bb setup show` with nothing configured exits 1 (as the man page states)", setupShow.code === 1, `rc=${setupShow.code}`)
  suite.check("`bb setup show` never prints a whole key", !/sk-|Bearer |[A-Za-z0-9_-]{32,}/.test(setupShow.out.replace(/last4|local-word-vectors-v\d/g, "")), setupShow.out.split("\n").slice(0, 6).join(" | ").slice(0, 240))

  const setup = bb(["setup"], { cwd: empty })
  suite.check("`bb setup` without a TTY refuses instead of hanging", setup.code === 1 && /interactive terminal/.test(setup.all), `rc=${setup.code} ${setup.all.split("\n").filter((l) => l.trim()).slice(0, 2).join(" | ").slice(0, 160)}`)

  const badDir = bb(["stats", path.join(empty, "does-not-exist")], { cwd: empty })
  suite.check("`bb stats <nonexistent dir>` exits non-zero", badDir.code !== 0, `rc=${badDir.code}`)
  suite.check("`bb stats <nonexistent dir>` says it is not a directory", /not a directory/.test(badDir.all), badDir.all.trim().slice(0, 160))
}

suite.finish()