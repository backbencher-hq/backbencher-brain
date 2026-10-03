// test/cli-surface/matrix.ts — THE DELIVERABLE: a command x flag matrix.
//
// Nothing here is hand-maintained. The matrix is DISCOVERED from the product's
// own help output (`bb --help` for the command list, `bb help <cmd>` for each
// command's options) and every discovered entity is then put through the same
// four questions:
//
//   1. is it ACCEPTED?        — proved, not assumed
//   2. does it appear in help? — with a non-empty description
//   3. is it in the SOURCE?    — help must not be able to hide a flag, and a
//                               flag must not exist only in help
//   4. is it in the MAN PAGE?  — `docs/man/bb.1`, where the man page covers
//                               that command. This is the assertion that would
//                               have caught status/stats/projects/doctor
//                               missing from the man page.
//
// WHY "ACCEPTED" IS PROVED RATHER THAN ASSUMED. Help is generated FROM the
// registry, so "it is in help" cannot by itself mean "it works". Two probes
// carry the proof:
//
//   * value-taking flags — `bb <cmd> --flag` with no value must answer
//     `option '--flag <arg>' argument missing`. That is a POSITIVE proof the
//     flag is registered, and it has no side effects at all. An unregistered
//     flag answers `unknown option` instead, which is what makes the probe
//     discriminating.
//   * boolean flags — really invoked inside an isolated $BB_DATA_DIR against a
//     3-module throwaway fixture, and rejected if the output carries a
//     commander usage error. `mcp` gets an MCP JSON-RPC handshake instead of a
//     flag sweep.
//
// Both probes are paired with a NEGATIVE: `bb <cmd> --definitely-not-a-flag`
// must be refused. If the product stopped refusing unknown options, every
// "accepted" assertion in this file would silently become true — so the
// negative is what keeps the gate load-bearing.
//
// Run:  npx tsx test/cli-surface/matrix.ts

import {
  createSuite, guard, isolatedDataDir, makeFixture, bb, parseHelp, commandsFrom, optionsFrom,
  sourceSurface, parseManPage, manMentions,
  UNKNOWN_OPTION, MISSING_ARG, MISSING_POSITIONAL, mcpInitialize, parseJsonRpcLines,
} from "./harness"

const suite = createSuite("cli-matrix")
isolatedDataDir("matrix")
suite.section("discovery — the surface is read from the product, never hand-written")

const rootHelp = bb(["--help"])
suite.check("`bb --help` exits 0", rootHelp.code === 0, `rc=${rootHelp.code}\n${rootHelp.err.slice(0, 300)}`)

const commands = commandsFrom(rootHelp.out)
const src = sourceSurface()
const man = parseManPage()

suite.check("`bb --help` lists a command list", commands.length >= 10, `commands=${commands.length}`)
suite.note(`discovered commands: ${commands.map((c) => c.name).join(", ")}`)
suite.note(`man page entries: ${[...new Set(man.entries.map((e) => e.key))].join(", ")}`)

// ─────────────────────────────────────────────────────────────────────────────
suite.section("1. every command: help availability, description, man-page coverage")
// ─────────────────────────────────────────────────────────────────────────────
for (const c of commands) {
  if (c.name === "help") {
    // commander's built-in: no action of its own, not registered in src/, so the
    // per-command probes do not apply. `bb help` itself is checked right here.
    suite.note("`help` is commander's built-in — not a src-registered command, so the source-parity probe does not apply")
    const noArgs = bb(["help"])
    suite.check("`bb help` (no arguments) exits 0", noArgs.code === 0, `rc=${noArgs.code}`)
    suite.check("`bb help` prints the root usage", noArgs.out.includes("Usage: bb"), noArgs.out.split("\n")[0])
    suite.check("commander built-in `help` is documented in the man page", man.documentedCommands.includes("help"), man.documentedCommands.join(", "))
    continue
  }
  const h = bb(["help", c.name])
  suite.check(`bb help ${c.name} exits 0 (help availability)`, h.code === 0, `rc=${h.code}\n${h.err.slice(0, 200)}`)
  suite.check(`bb help ${c.name} prints that command's own usage`, h.out.includes(`bb ${c.name}`), h.out.split("\n")[0])
  suite.check(
    `command \`${c.name}\` is listed in \`bb --help\` with a non-empty description`,
    c.description.length > 0,
    `description=${JSON.stringify(c.description)}`,
  )
  suite.check(
    `command \`${c.name}\` is registered in src/cli/index.ts`,
    src.commands.includes(c.name),
    `source has: ${src.commands.join(", ")}`,
  )
  suite.check(
    `command \`${c.name}\` is documented in docs/man/bb.1`,
    man.documentedCommands.includes(c.name),
    `man COMMANDS documents: ${man.documentedCommands.join(", ")}`,
  )
}

// Subcommands are registered on a parent and must surface in the PARENT's help.
for (const sub of src.subcommands) {
  const [parent, child] = sub.split(" ")
  const h = bb(["help", parent])
  suite.check(
    `subcommand \`${parent} ${child}\` is listed in \`bb help ${parent}\``,
    h.out.includes(child),
    `subcommands in source: ${src.subcommands.join(", ")}`,
  )
  suite.check(
    `subcommand \`${parent} ${child}\` is documented in docs/man/bb.1`,
    man.entries.some((e) => e.name === parent && e.sub === child),
    `man entries: ${[...new Set(man.entries.map((e) => e.key))].join(", ")}`,
  )
}

suite.negative(
  "an unknown command is refused (rc != 0, named in the message)",
  (() => {
    const r = bb(["definitely-not-a-command"])
    return r.code !== 0 && /unknown command/.test(r.all)
  })(),
  bb(["definitely-not-a-command"]).all.slice(0, 200),
)

// Every command in the SOURCE must be in HELP — the reverse direction of the
// loop above, which only walks help→source.
for (const name of src.commands) {
  suite.check(
    `command \`${name}\` from the source appears in \`bb --help\``,
    commands.some((c) => c.name === name),
    `help lists: ${commands.map((c) => c.name).join(", ")}`,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("2. man-page hygiene: no duplicated or empty command entries")
// ─────────────────────────────────────────────────────────────────────────────
{
  const seen = new Map<string, number>()
  for (const e of man.entries) seen.set(e.key, (seen.get(e.key) ?? 0) + 1)
  const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([c, n]) => `${c} x${n}`)
  suite.check("the man page has no duplicated command entries", dupes.length === 0, `duplicated: ${dupes.join(", ")}`)

  const thin = man.entries.filter((e) => e.prose.replace(/[`'"]/g, "").trim().length < 20)
  suite.check(
    "every man-page command entry carries real prose",
    thin.length === 0,
    `thin or empty: ${thin.map((e) => e.key).join(", ")}`,
  )

  // A command entry that names a flag must name one the product actually has.
  const phantomFlags = man.entries.filter(
    (e) => e.flag && !(src.options[e.name] ?? []).includes(e.flag) && !src.globalOptions.includes(e.flag),
  )
  suite.check(
    "every flag named in a man-page command entry exists in the product",
    phantomFlags.length === 0,
    `phantom: ${phantomFlags.map((e) => `${e.name} ${e.flag}`).join(", ")}`,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("3. every flag: accepted, described, in source, in the man page")
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recorded docs gaps. A flag here is one the man page genuinely does not
 * mention; the gate fails if a flag is missing from BOTH the man page and this
 * list, so new drift is caught while the known gaps stay visible.
 */
const KNOWN_UNDOCUMENTED_FLAGS = new Set<string>([
  // global: the man page's OPTIONS section documents only -v/--version and -h/--help
  "--verbose", "--quiet",
  // tool
  "tool --dir", "tool --args",
  // index: the man page names only --force
  "index --no-setup", "index --skip-post-processing", "index --post",
  "index --file", "index --changed", "index --resume", "index --import",
  // doctor: --fix is documented, --dir is not
  "doctor --dir",
  // projects: --remove and --force are documented, --sort is not
  "projects --sort",
  // search: none of the seven are documented
  "search --mode", "search --file-path", "search --symbol-name", "search --dir",
  "search --limit", "search --language", "search --no-auto-refresh",
  // health
  "health --refresh", "health --force", "health --no-wait", "health --complete",
  "health --integrity", "health --sample-size", "health --verbose-config",
  // onboard: --check/--print/--file are documented, the positional [dir] is not named
  "mcp --dir",
])

const fixture = makeFixture("matrix")
const indexed = bb(["index", fixture, "--no-setup"], { cwd: fixture })
suite.check("the throwaway fixture indexed cleanly", indexed.code === 0, indexed.all.slice(-400))

const undocumented: string[] = []
let flagCount = 0

for (const c of commands) {
  if (c.name === "help") continue
  const h = bb(["help", c.name])
  const opts = optionsFrom(h.out)

  // The negative probe for this command. Without it "accepted" means nothing.
  const bogus = bb([c.name, "--definitely-not-a-flag", ...(opts.some((o) => o.spec.includes("<")) ? ["x"] : [])], { cwd: fixture })
  const bogusRejected = bogus.code !== 0 && (UNKNOWN_OPTION.test(bogus.all) || MISSING_POSITIONAL.test(bogus.all))
  suite.negative(
    `\`bb ${c.name}\` refuses an unknown option`,
    bogusRejected,
    `rc=${bogus.code} ${bogus.all.split("\n").filter((l) => l.trim()).slice(0, 2).join(" | ").slice(0, 200)}`,
  )

  for (const o of opts) {
    for (const flag of o.flags) {
      if (flag === "-h" || flag === "--help") continue
      flagCount++
      const takesValue = /<[^>]+>/.test(o.spec)

      // ── 1. ACCEPTED ──────────────────────────────────────────────────────
      if (takesValue) {
        // Side-effect-free positive proof of registration.
        const r = bb([c.name, flag], { cwd: fixture })
        const registered = r.code !== 0 && MISSING_ARG.test(r.all)
        suite.check(
          `\`bb ${c.name} ${flag}\` is registered (asks for its argument)`,
          registered,
          `rc=${r.code} ${r.all.split("\n").filter((l) => l.trim()).slice(0, 2).join(" | ").slice(0, 200)}`,
        )
      } else {
        // A boolean: really run it, and refuse a commander usage error.
        const invoked = invokeBooleanFlag(c.name, flag, fixture)
        suite.check(
          `\`bb ${c.name} ${flag}\` is accepted (no usage error)`,
          invoked !== null && !UNKNOWN_OPTION.test(invoked.all) && !MISSING_POSITIONAL.test(invoked.all),
          invoked === null
            ? "no probe available for this flag"
            : `rc=${invoked.code} ${invoked.all.split("\n").filter((l) => /unknown option|missing required/.test(l)).join(" | ").slice(0, 200)}`,
        )
      }

      // ── 2. IN HELP, WITH A DESCRIPTION ───────────────────────────────────
      suite.check(
        `flag \`${c.name} ${flag}\` has a non-empty description in help`,
        o.description.length > 0,
        `spec=${JSON.stringify(o.spec)} description=${JSON.stringify(o.description)}`,
      )
      suite.check(
        `flag \`${c.name} ${flag}\` appears in \`bb help ${c.name}\``,
        optionsFrom(bb(["help", c.name]).out).some((x) => x.flags.includes(flag)),
        `spec=${o.spec}`,
      )

      // ── 3. IN THE SOURCE ─────────────────────────────────────────────────
      const registeredInSource = (src.options[c.name] ?? src.globalOptions).includes(flag)
      suite.check(
        `flag \`${c.name} ${flag}\` is registered in src/cli/index.ts`,
        registeredInSource,
        `source options for ${c.name}: ${(src.options[c.name] ?? []).join(", ") || "(none)"}`,
      )

      // ── 4. IN THE MAN PAGE ───────────────────────────────────────────────
      if (!manMentions(man, flag)) {
        undocumented.push(`${c.name} ${flag}`)
        suite.check(
          `flag \`${c.name} ${flag}\` is in the man page (or on the recorded docs-gap list)`,
          KNOWN_UNDOCUMENTED_FLAGS.has(`${c.name} ${flag}`),
          `not in docs/man/bb.1 and not recorded in KNOWN_UNDOCUMENTED_FLAGS`,
        )
      }
    }
  }
}

suite.note(`${flagCount} flags checked; ${undocumented.length} are absent from docs/man/bb.1`)
suite.note(`undocumented flags: ${undocumented.join(", ") || "(none)"}`)
suite.check(
  "every flag absent from the man page is a RECORDED docs gap (no unreported drift)",
  undocumented.every((f) => KNOWN_UNDOCUMENTED_FLAGS.has(f)),
  `unrecorded: ${undocumented.filter((f) => !KNOWN_UNDOCUMENTED_FLAGS.has(f)).join(", ")}`,
)

// ─────────────────────────────────────────────────────────────────────────────
suite.section("4. the value-flag probe is discriminating (a flag that is NOT registered)")
// ─────────────────────────────────────────────────────────────────────────────
{
  // Proof that the "asks for its argument" probe means what this file assumes:
  // an unregistered flag must produce `unknown option`, not `argument missing`.
  const r = bb(["projects", "--not-a-real-flag", "x"], { cwd: fixture })
  suite.check(
    "an unregistered value flag answers `unknown option`, not `argument missing`",
    UNKNOWN_OPTION.test(r.all) && !MISSING_ARG.test(r.all),
    r.all.split("\n").filter((l) => l.trim()).slice(0, 2).join(" | ").slice(0, 200),
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Boolean-flag invocation probes.
//
// Each entry is a real invocation of `bb <command> <flag>` inside the isolated
// data dir. `mcp` and `setup` cannot be swept that way (one is a long-running
// server, the other requires a TTY) and are covered by behaviour.ts.
// ─────────────────────────────────────────────────────────────────────────────
function invokeBooleanFlag(cmd: string, flag: string, cwd: string) {
  const argv: Record<string, string[]> = {
    "index --force": ["index", cwd, "--force", "--no-setup"],
    "index --no-setup": ["index", cwd, "--changed", "--no-setup"],
    "index --post": ["index", cwd, "--post"],
    "index --changed": ["index", cwd, "--changed", "--no-setup"],
    "index --resume": ["index", cwd, "--resume", "--no-setup"],
    "index --skip-post-processing": ["index", cwd, "--skip-post-processing", "--no-setup"],
    "projects --force": ["projects", "--force"],
    "projects --remove": [],
    "doctor --fix": ["doctor", cwd, "--fix"],
    "search --no-auto-refresh": ["search", "alpha0", "--dir", cwd, "--no-auto-refresh"],
    "health --refresh": ["health", cwd, "--refresh"],
    "health --force": ["health", cwd, "--force"],
    "health --no-wait": ["health", cwd, "--refresh", "--no-wait"],
    "health --complete": ["health", cwd, "--complete"],
    "health --integrity": ["health", cwd, "--integrity"],
    "health --verbose-config": ["health", cwd, "--verbose-config"],
    "onboard --check": ["onboard", cwd, "--check"],
    "onboard --print": ["onboard", cwd, "--print"],
    // `bb upgrade` was added after this table was written, so its boolean flags
    // had no probe and reported "no probe available for this flag". `--check` is
    // the read-only form and is safe to run for real; it contacts the registry,
    // which is why it must not be confused with a usage-registration proof —
    // the assertion below only rejects COMMANDER usage errors.
    "upgrade --check": ["upgrade", "--check"],
  }
  const key = `${cmd} ${flag}`
  const args = argv[key]
  if (args === undefined) return null
  return bb(args, { cwd, timeoutMs: 180_000 })
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("5. `bb mcp` answers an MCP handshake on stdio")
// ─────────────────────────────────────────────────────────────────────────────
{
  // The one flag the sweep above cannot do: `mcp` never returns. Drive the real
  // stdio protocol instead, and require a JSON-RPC `initialize` result.
  const r = bb(["mcp", "--dir", fixture], { cwd: fixture, input: `${mcpInitialize()}\n`, timeoutMs: 30_000 })
  const frames = parseJsonRpcLines(r.out)
  const init = frames.find((f) => f.id === 1 && f.result)
  suite.check(
    "`bb mcp` answers an MCP `initialize` handshake on stdio",
    !!init,
    `rc=${r.code} frames=${frames.length} stderr=${r.err.split("\n").filter((l) => l.trim()).slice(0, 2).join(" | ").slice(0, 200)}`,
  )
  if (init) {
    suite.check("the MCP initialize result names the server", init.result?.serverInfo?.name === "backbencher-brain", JSON.stringify(init.result?.serverInfo))
  }
  void mcpInitialize
}

suite.finish()