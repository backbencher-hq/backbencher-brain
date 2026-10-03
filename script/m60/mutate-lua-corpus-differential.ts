// Does the Lua differential actually WORK, or does it merely agree?
//
// Every number this lane reports is an agreement between the analyzer and an
// oracle. An instrument that cannot fail produces the same artifact as one that
// cannot detect anything, and the two are indistinguishable from the output
// alone. This is the check that separates them: seed a defect into the analyzer —
// a real one, drawn from the classes this lane has actually hit — and require the
// differential to go RED on REAL CODE, then restore the source byte-for-byte.
//
// Source mutation is legitimate here and was not in the earlier gate-level
// harnesses: those ran in-process, where the engine's module cache meant every
// mutant re-measured the unmutated analyzer (4 planted, 0 caught). Each mutant
// here gets its OWN PROCESS via execFileSync, which is the only reason a
// source-level mutation can bite at all. That failure is why the gate-level
// suites corrupt the OUTPUT instead.
//
// The slice is `--sample N` of the real kong corpus, not a fixture: a gate that
// only ever sees a file it was written for has not been tested against the world.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
// Derived from this file's own location, NOT hardcoded. Six of this lane's scripts
// pinned $HOME/backbencher-brain, so in a lane worktree they read a path
// that does not exist and the gate died with ENOENT instead of reporting a verdict.
// A gate that cannot execute is not a gate, and the mutant battery looked green
// only because its failure was being read as a pass.
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

const SRC = join(REPO, "src/ast/real-lua-analyzer.ts")
const ORACLE = join(REPO, "script/m60/lua-truth-oracle.ts")
const SAMPLE = process.argv.includes("--sample") ? Number(process.argv[process.argv.indexOf("--sample") + 1]) : 60
// --files <path> : run against a targeted list instead of the first N. The
// positional slice is alphabetical, so it contained no call-on-call and no
// literal-index call in 1,309 files' worth of trying, and the mutants for LUA-29
// and LUA-30 were untestable there. A harness pointed at a slice without the
// construct reports INCONCLUSIVE, which is honest, and a slice with the construct
// is what actually answers the question.
const FILES_ARG = process.argv.includes("--files") ? process.argv[process.argv.indexOf("--files") + 1] : undefined
const ENV = { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` }
const MUTANT_OUT = join("/tmp", `lua-mutant-oracle-${process.pid}.json`)

/**
 * M60: the harness mutates the REAL analyzer and restores it afterwards. That
 * restore lived only in a `finally`, which is correct for a normal exit and
 * worthless for a KILLED one — and this harness gets killed, because it runs for
 * a long time under an outer `timeout`. SIGKILL runs no handler and no `finally`
 * at all, so a mutant stayed in `src/ast/real-lua-analyzer.ts` and the next
 * person to read that file — or commit it — was looking at `if (false) {`
 * where the contains-edge guard used to be. Every contains edge in the
 * repository had silently become zero.
 *
 * So restoration no longer depends on this process finishing:
 *
 *   - the original is written to a sidecar BEFORE the first mutation, so there
 *     is always a copy on disk that does not require this process to be alive;
 *   - SIGINT/SIGTERM/SIGHUP restore from the sidecar and exit non-zero, so a
 *     `timeout` that does deliver a signal still cleans up;
 *   - a LEFTOVER sidecar means an earlier run died mid-mutant, so the next run
 *     repairs the source before it measures anything and says so loudly. That is
 *     the case no signal handler can cover, and it is the one that actually bit.
 */
const SRC_BACKUP = `${SRC}.m60-mutant-original`

// The order here is the whole point, and getting it wrong is worse than not
// guarding at all. An earlier version of this block read `original` from the
// file FIRST, repaired second, and then carried the MUTATED text forward as
// `original` — so the pre-flight inspected the mutant, refused to run, and the
// exit handler dutifully wrote the mutant BACK over the good file the repair had
// just restored. The repair made things worse. So: repair, and only then read.
//
// The invariant is that `original` and the file on disk are the same string, and
// everything downstream — the pre-flight anchors, the mutants, the restore, the
// byte-for-byte check — reads that one value.
if (existsSync(SRC_BACKUP)) {
  const survivor = readFileSync(SRC_BACKUP, "utf8")
  const onDisk = readFileSync(SRC, "utf8")
  if (survivor !== onDisk) {
    writeFileSync(SRC, survivor)
    const marks = (onDisk.match(/if \(false\)/g) ?? []).length
    console.log(
      `REPAIRED: an earlier run of this harness was killed mid-mutant and left ${SRC} mutated` +
        `${marks ? ` (${marks} \`if (false)\` in the file on disk)` : ""}.\n` +
        `          The analyzer has been restored from the sidecar, which holds the pre-mutation\n` +
        `          text. If a commit you already made contains a mutant, amend or revert it.`,
    )
  }
  rmSync(SRC_BACKUP, { force: true })
}

const original = readFileSync(SRC, "utf8")
writeFileSync(SRC_BACKUP, original)
const restore = () => {
  try {
    writeFileSync(SRC, original)
    rmSync(SRC_BACKUP, { force: true })
  } catch {}
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(sig, () => {
    restore()
    process.exit(130)
  })
}
process.on("exit", restore)

interface Mutant {
  id: string
  what: string
  find: string
  replace: string
  /** Which signal must move for the mutant to count as caught. */
  signal: "analyzer-missing" | "unexplained" | "line" | "exports" | "rel-spurious" | "disclosures" | "metadata"
  /**
   * A mutant the CURRENT leg provably cannot decide, with the reason. Reported
   * as INCONCLUSIVE-BY-DESIGN rather than SURVIVED, because a survivor is a claim
   * about the instrument and this is a claim about the SCOPE OF THE INSTRUMENT.
   * M17 is the case: the metadata leg asks "does this file contain a member
   * access at all?", which catches a framework claimed in a file with none. That
   * is a NARROWER defect than LUA-04, which claimed a framework from a bare
   * identifier in a file that has plenty of member accesses — and kong has 333
   * files with a bare framework-namespace identifier, every one of them with
   * member accesses elsewhere. Measured: the mutant moves
   * frameworkClaimsWithoutMemberAccess 0 -> 0 on those 333.
   *
   * Deciding LUA-04 properly needs the framework -> namespace TABLE, and taking
   * that table from the analyzer is the mirror trap this lane has paid for twice
   * (LUA-27, LUA-33): a table copied from the implementation agrees by
   * construction. So the scope is recorded rather than the gap hidden, and
   * LUA-04 keeps its dedicated gate as its real test.
   */
  knownInconclusive?: string
  /**
   * A source pattern that MUST occur in the corpus slice, or the mutant has no
   * trigger and its result is INCONCLUSIVE rather than SURVIVING.
   *
   * Without this the harness reported "survived" for mutants that could not
   * possibly fire: the first 25 kong files contain no call-on-call and no
   * literal-index call, so LUA-29 and LUA-30 were untestable there. Calling that
   * a survival is the harness grading itself on a test it never ran — the same
   * error as the no-op control, in the other direction.
   */
  trigger?: RegExp
}

// Every mutant is a defect this lane has REALLY committed and fixed. Re-introducing
// them is the honest test: a harness that can only catch invented bugs is not
// evidence about the bugs that happened.
const MUTANTS: Mutant[] = [
  {
    id: "M1",
    trigger: /\breturn\b|\blocal\s+function\b/,
    what: "LUA-01 again: a relationship's line is omitted entirely",
    find: "if (nameNode) relationship.line_number = nameNode.startPosition.row + 1",
    replace: "if (nameNode) relationship.line_number = undefined as any",
    signal: "line",
  },
  {
    id: "M2",
    trigger: /\breturn\b|\blocal\s+function\b/,
    what: "LUA-01 again: 0-based lines (off by one)",
    find: "if (nameNode) relationship.line_number = nameNode.startPosition.row + 1",
    replace: "if (nameNode) relationship.line_number = nameNode.startPosition.row",
    signal: "line",
  },
  // M3 (LUA-19, nested-function scoping) was REMOVED rather than kept. Two
  // successive versions of it were reported as survivors and in both cases the
  // MUTANT was wrong, not the instrument: `opts?.symbolRange` is passed only for
  // synthesized `contains` edges so the `??` fell straight back, and
  // `node.type === "function_declaration"` is not the pre-LUA-19 test either. A
  // mutant that cannot fail is the M0 problem in a different hat. The class is not
  // uncovered — verify-lua-member-identity plants exactly this regression as its
  // fifth mutant and catches it (6/6, verified) — so the corpus harness does not
  // need a second copy of a check that already exists and fires.
  {
    id: "M4",
    trigger: /^\s*return\s*\{/m,
    what: "LUA-09 again: the returned-table export branch is gone",
    find: 'if (target.type === "table_constructor") {',
    replace: "if (false) {",
    signal: "exports",
  },
  {
    id: "M5",
    trigger: /^\s*return\s/m,
    what: "LUA-20 again: an in-function return is published as a file export",
    find: "    if (frame.inFunction) return",
    replace: "    // mutant: guard removed",
    signal: "exports",
  },
  {
    id: "M6",
    trigger: /\)\s*\(\s*\)/,
    what: "LUA-29 again: a call on a call publishes the whole call as its target",
    find: 'if (functionNode.type === "function_call" || functionNode.type === "table_constructor" ||',
    replace: "if (false ||",
    signal: "unexplained",
  },
  {
    id: "M7",
    trigger: /\[\s*["'][^"']+["']\s*\]\s*\(/,
    what: "LUA-30 again: a literal string index publishes nothing",
    find: 'if (field?.type !== "string") return undefined',
    replace: 'if (field?.type !== "string") return undefined; return undefined',
    signal: "analyzer-missing",
  },
  {
    id: "M8",
    trigger: /^\s*local\s+function/m,
    what: "LUA-15 again: a member is filed as a member of nothing (the contains edge is dropped)",
    find: "if (owner && owner !== symbol.name) {",
    replace: "if (false) {",
    signal: "analyzer-missing",
  },
  // ── wave 2: every ANALYZER defect class this lane has actually fixed ────────
  // M1-M8 covered six classes. The lane has fixed twenty. These add the
  // relationship-level ones that were previously untested at corpus scale, so
  // "the differential would notice" is a claim about the whole set and not a
  // convenient subset.
  {
    id: "M9",
    trigger: /^\s*local\s+\w+\s*$/m,
    // LUA-13: the callee of `table . field` is the LAST named child, because the
    // FIRST is the receiver and the receiver's start is a different line. Before
    // the fix a call split across two lines was reported at the receiver's line,
    // and the old payload filter deleted it from the graph outright.
    what: "LUA-13 again: the callee is taken as the FIRST named child, so a line-broken call reports the receiver's line",
    find: "      const last = functionNode.namedChildCount > 0 ? functionNode.namedChild(functionNode.namedChildCount - 1) : undefined",
    replace: "      const last = functionNode.namedChildCount > 0 ? functionNode.namedChild(0) : undefined",
    signal: "line",
  },
  {
    id: "M10",
    trigger: /^\s*local\s+\w+\s*$/m,
    // LUA-23: a bare `local x` has NO assignment_statement, so the name list is a
    // direct child of the declaration rather than a child of the assignment. That
    // third arm is the whole fix; removing it makes every bare local vanish.
    what: "LUA-23 again: a bare `local x` with no assignment produces no symbol",
    find: '      : (first?.type === "variable_list" ? first : undefined)',
    replace: "      : undefined",
    signal: "analyzer-missing",
  },
  {
    id: "M11",
    // The trigger must match the PRECONDITION, not a near-miss. The first version
    // used `/\w+\s*=\s*\w+/` — any assignment anywhere — so the slice it selected
    // satisfied the regex without containing a single closure that assigns an
    // enclosing local, and M11 was reported SURVIVED when it had simply never run.
    // A trigger that fires is not a trigger that can fire, and the difference is
    // invisible unless the pattern encodes what the mutant actually needs.
    trigger: /function[\s\S]{0,300}?[a-z_]\w*\s*=\s*[^=]/,
    // LUA-21: a closure's frame is seeded from the enclosing frame's locals. That
    // inheritance is what a closure IS, and its absence made every upvalue
    // assignment look like a fresh declaration.
    what: "LUA-21 again: a closure's frame does not inherit the enclosing scope's locals",
    find: "        const locals = new Set<string>(frame.localNames)",
    replace: "        const locals = new Set<string>()",
    // `unexplained`, NOT `analyzer-missing`. The mutation ADDS edges the oracle
    // does not derive — `contains bump -> counter` for an upvalue write — so it
    // moves the unexplained count, not the missing one. Assigned the wrong signal
    // it read as a survivor while the run underneath it showed UNEXPLAINED 1 -> 43.
    // A survivor is a claim about the instrument, and this one was a claim about
    // the harness's own bookkeeping.
    signal: "unexplained",
  },
  {
    id: "M12",
    trigger: /\[\s*["'][^"']+["']\s*\]|\[\s*\w+\s*\]/,
    // LUA-22: a computed index has no name. The whitelist returns undefined for
    // every non-string field; a mutant that publishes the field's text brings back
    // the original defect — an EXPRESSION used as a relationship target.
    what: "LUA-22 again: a computed index publishes its expression as the target",
    find: '      if (field?.type !== "string") return undefined',
    replace: '      if (field?.type !== "string") return { name: field?.text ?? functionNode.text, nameNode: field ?? functionNode }',
    signal: "unexplained",
  },
  {
    id: "M13",
    // Same lesson as M11: the trigger is the setmetatable's own precondition — a
    // SECOND argument that is a table literal. `/setmetatable\s*\(/` matched every
    // setmetatable in the repo, so the slice was full of NAMED metatables the
    // mutant cannot touch, and M13 read as a survivor.
    trigger: /setmetatable\s*\([^,]+,\s*\{/,
    // LUA-32: both setmetatable endpoints must be names. The nameBearing guard is
    // the fix; a mutant that drops it republishes the whole table constructor as
    // the extends target, which is the five-line payload the pipeline filters out
    // and which was therefore invisible until the seam probe found it.
    what: "LUA-32 again: an inline metatable table is published as the extends target",
    // BOTH the guard AND the body. The first version widened the condition but left
    // `addRelationship(ctx, srcName, mtName, …)` in place, so the mutant changed
    // nothing at all and was reported as a survivor — a mutant that cannot fire.
    // Reintroducing the defect means publishing `target.text`/`metatable.text`,
    // which is what the pre-LUA-32 code did.
    find: "      if (target && metatable && !this.isTableNode(target) && srcName && mtName) {\n        this.addRelationship(ctx, srcName, mtName, ASTEngine.RelationshipType.Extends, { luaSpecific: true, relationshipType: \"lua_metatable\" }, metatable)\n      }",
    replace: "      if (target && metatable && !this.isTableNode(target)) {\n        this.addRelationship(ctx, target.text, metatable.text, ASTEngine.RelationshipType.Extends, { luaSpecific: true, relationshipType: \"lua_metatable\" }, metatable)\n      }",
    // `rel-spurious`: a payload target the tree never derived. It is invisible to
    // the pipeline comparison because pool-worker drops newline-bearing targets,
    // so it shows up ONLY on the direct-path relationship leg (LUA-34).
    signal: "rel-spurious",
  },
  {
    id: "M14",
    trigger: /return\s+setmetatable\s*\(/m,
    // LUA-35: `return setmetatable(M, mt)` publishes M. Deleting the arm makes the
    // three kong files that genuinely name M publish nothing — a recall loss, not a
    // precision one, which is the distinction M13 exists to test on the other side.
    what: "LUA-35 again: return setmetatable(<name>, mt) publishes nothing",
    find: "        if (named) {\n          ctx.exports.push({ name: named, isDefault: true, range: this.nodeToRange(first!), metadata: { luaSpecific: true, viaMetatable: true } })\n        } else {",
    replace: "        if (false) {\n          ctx.exports.push({ name: named, isDefault: true, range: this.nodeToRange(first!), metadata: { luaSpecific: true, viaMetatable: true } })\n        } else {",
    signal: "exports",
  },
  {
    id: "M15",
    trigger: /return\s+(require|")/m,
    // The disclosure half of LUA-35: a nameless surface must be DISCLOSED, and the
    // disclosure must not invent a name. Deleting it makes the disclosure disappear —
    // silence, which is the state LUA-35 exists to end.
    what: "LUA-35 again: a nameless surface is silent instead of disclosed",
    // The `?? null` is load-bearing for the anchor, not decoration: `detail` is
    // typed `string | null` and `stringValue` can return `undefined`, which is a
    // typecheck error. tsc rejects it, so the anchor below has to carry the
    // coalesce — and the pre-flight exists precisely to fail loudly when an anchor
    // drifts, which is what happened when this line was tightened for types.
    find: '        ctx.unpublishedSurface.push({ shape: "re-export", detail: path ?? null, line: target.startPosition.row + 1, why: "the surface is another module\'s, not this module\'s" })',
    replace: '        void path',
    signal: "disclosures",
  },
  {
    id: "M16",
    trigger: /coroutine\.(create|wrap)/,
    // LUA-02: the coroutine count was structurally always zero. The metadata leg
    // did not exist when that shipped — the differential compared relationships
    // and exports and nothing else, so a metadata defect had one test instead of
    // two, and one test is how it got through.
    what: "LUA-02 again: coroutineUsage is structurally always 0",
    find: "  private countCoroutineSymbols(ctx: LuaContext): number {\n    return ctx.coroutineCalls",
    replace: "  private countCoroutineSymbols(ctx: LuaContext): number {\n    return 0 * ctx.coroutineCalls",
    signal: "metadata",
  },
  {
    id: "M17",
    trigger: /\b(use|setup|GetTime|love|vim)\b/,
    // LUA-04: framework detection fired on BARE IDENTIFIERS, so a variable named
    // `use` labelled a file a framework. The guard that rejects an unqualified name
    // is the whole fix, and deleting it is the whole defect.
    what: "LUA-04 again: a bare identifier names a framework",
    find: '    if (!text.includes(".")) return',
    replace: '    if (false) return',
    signal: "metadata",
    knownInconclusive: "the metadata leg's framework rule is coarser than LUA-04 (see the interface doc). LUA-04 remains covered by verify-lua-published-claims; this mutant documents the limit rather than pretending the leg decides it.",
  },
]

// ── pre-flight: EVERY anchor must exist before a single mutant runs ───────────
// The first version of this harness carried `line_number: line,` as M1's anchor.
// It has zero occurrences in the analyzer, the mutant was reported SKIPPED, and
// the run still ended with a confident-looking summary. A harness that skips
// silently is indistinguishable from one that passed, which is the same failure
// as a gate that cannot fail. Missing anchors are now fatal.
{
  const missing = MUTANTS.filter((m) => !original.includes(m.find))
  if (missing.length) {
    console.error("PRE-FLIGHT FAILED — these anchors do not exist in the analyzer, so the mutant would silently skip:")
    for (const m of missing) console.error(`  ${m.id}: ${JSON.stringify(m.find)}`)
    console.error("\nRefusing to run. A skipped mutant is reported like a caught one unless this is fatal.")
    process.exit(2)
  }
  const dupes = MUTANTS.filter((m, i) => MUTANTS.findIndex((o) => o.id === m.id) !== i)
  if (dupes.length) {
    console.error(`PRE-FLIGHT FAILED — duplicate mutant ids: ${dupes.map((d) => d.id).join(", ")}`)
    process.exit(2)
  }
}

// The oracle EXITS 1 when it finds analyzer-attributable missing edges — which is
// the detection working. The first version of this harness called a non-zero exit
// "the analyzer did not even run" and reported those mutants as ERRORS, i.e. it
// read its own success signal as a crash. Both stdout and the throw are handled so
// a detection and a genuine crash are distinguishable: a crash has no parseable
// MISSING line, a detection always does.
interface OracleRun {
  analyzerMissing: number
  unexplained: number
  lineAccuracy: number
  lineWrong: number
  exportMissed: number
  exportSpurious: number
  exportTruth: number
  relSpurious: number
  relMissed: number
  disclosures: number
  coroMismatches: number
  frameworkSpurious: number
  scoreDistinct: number
}

const runOracle = (): OracleRun => {
  let out = ""
  try {
    // --out into a temp file, ALWAYS. Without it every one of these ~10 narrowed
    // passes wrote to validation/m60/results/lua-truth-oracle-kong.json and the
    // last one — a 14-file slice from a MUTATED analyzer — became the committed
    // "corpus" evidence. A harness that mutates the thing it measures must never
    // write to the measured thing's canonical artifact.
    const argv = [ORACLE, "--repo", "kong", "--out", MUTANT_OUT]
    if (FILES_ARG) argv.push("--files", FILES_ARG)
    else argv.push("--sample", String(SAMPLE))
    out = execFileSync("bun", argv, {
      cwd: REPO, encoding: "utf8", env: ENV, stdio: ["ignore", "pipe", "pipe"],
    })
  } catch (e: any) {
    const so = e?.stdout ?? ""
    if (typeof so === "string" && so.includes("MISSING=")) out = so
    else {
      const msg = `${e?.message ?? e}\n${String(e?.stderr ?? "")}`.trim()
      // A mutant that does not COMPILE is a bad mutant, not a gap in the
      // instrument, and conflating the two is how a broken harness gets to report
      // a clean run. The first M3 replaced `nameNode` with `node`, which is not
      // in scope inside addRelationship — TypeScript refused it and the harness
      // correctly said the analyzer did not run. The lesson recorded is that the
      // MUTANT was wrong, and the distinction is now explicit in the output.
      throw new Error(/SyntaxError|ReferenceError|not defined|Unexpected/.test(msg) ? `MUTANT-DID-NOT-COMPILE: ${msg.slice(0, 160)}` : msg || "oracle produced no output")
    }
  }
  const m = out.match(/MISSING=\d+ \(analyzer=(\d+),[^)]*\) UNEXPLAINED=(\d+)/)
  const l = out.match(/lines: checked=\d+ exact=\d+ wrong=(\d+) accuracy=(\S+)/)
  // The DIRECT-path export comparison. Added after M4 and M5 — both export
  // mutants — survived a harness that was already watching three signals: the
  // oracle had begun to exit 1 on an export defect and the harness never read the
  // number that moved. A detector nobody reads is not a detector. This line was
  // also the second silent no-op replacement in this file, which is why every
  // edit to it is now made with the edit tool rather than a script.
  const x = out.match(/exports \(DIRECT path, (\d+) files\): truth=(\d+) hit=(\d+) missed=(\d+) spurious=(\d+)/)
  const rl = out.match(/relationships \(DIRECT path, (\d+) files\): truth=(\d+) hit=(\d+) missed=(\d+) SPURIOUS=(\d+)/)
  const dc = out.match(/disclosures \(nameless surfaces\): files=(\d+) total=(\d+)/)
  const md = out.match(/coroutineMismatches=(\d+) frameworkClaimsWithoutMemberAccess=(\d+) scoreDistinctValues=(\d+)/)
  return {
    analyzerMissing: m ? Number(m[1]) : -1,
    unexplained: m ? Number(m[2]) : -1,
    lineWrong: l ? Number(l[1]) : -1,
    lineAccuracy: l ? Number(l[2]) : -1,
    exportTruth: x ? Number(x[2]) : -1,
    exportMissed: x ? Number(x[4]) : -1,
    exportSpurious: x ? Number(x[5]) : -1,
    relSpurious: rl ? Number(rl[5]) : -1,
    relMissed: rl ? Number(rl[4]) : -1,
    disclosures: dc ? Number(dc[2]) : -1,
    coroMismatches: md ? Number(md[1]) : -1,
    frameworkSpurious: md ? Number(md[2]) : -1,
    scoreDistinct: md ? Number(md[3]) : -1,
  }
}

// ---- baseline. Refuse to mutate anything unless the unmutated lane is clean on
// the signals the mutants are supposed to move; otherwise "caught" would be
// indistinguishable from "already broken".
// The exact file list the oracle will read, so trigger presence is checked against
// the same set and not against an approximation of it.
const sliceFiles: string[] = (() => {
  // The oracle lists files with `git -C <repoRoot> ls-files`, and repoRoot is the
  // PER-REPO clone directory, not the repositories/ parent — the parent is not a
  // git repository, which is what the first version of this helper discovered the
  // hard way.
  const REPOS = "$HOME/fixtures/repositories/kong"
  const out = execFileSync("bun", ["-e", `
    const { execFileSync } = require("node:child_process")
    const { readFileSync } = require("node:fs")
    const list = execFileSync("git", ["-C", "${REPOS}", "ls-files", "*.lua", "*.luau"], { encoding: "utf8", maxBuffer: 1<<28 })
    const all = list.split("\\n").filter(Boolean)
    const want = ${JSON.stringify(FILES_ARG ?? null)}
    const chosen = want ? readFileSync(want, "utf8").split("\\n").map(s=>s.trim()).filter(Boolean) : all.slice(0, ${SAMPLE})
    process.stdout.write(chosen.join("\\n"))
  `], { encoding: "utf8", env: ENV })
  return out.split("\n").filter(Boolean).map((f) => `${REPOS}/${f}`)
})()

const base = runOracle()
console.log(`baseline (unmutated, kong --sample ${SAMPLE}):`)
console.log(`  analyzer-attributable missing: ${base.analyzerMissing}`)
console.log(`  unexplained:                   ${base.unexplained}`)
console.log(`  line accuracy:                 ${base.lineAccuracy}  (wrong ${base.lineWrong})`)
console.log(`  direct-path exports missed:    ${base.exportMissed}  (spurious ${base.exportSpurious}, of ${base.exportTruth} truth)`)
console.log(`  direct-path relationships:     missed ${base.relMissed}  SPURIOUS ${base.relSpurious}`)
console.log(`  surface disclosures:           ${base.disclosures}`)
console.log(`  metadata: coro mismatches ${base.coroMismatches} | framework-without-member ${base.frameworkSpurious} | score distinct ${base.scoreDistinct}`)
if (base.lineAccuracy !== 1) {
  console.error("refusing to mutate: the baseline is not line-clean, so a line mutant proves nothing")
  process.exit(2)
}
console.log()

let survived = 0
let skipped = 0
let inconclusive = 0
let designInconclusive = 0
const results: string[] = []
try {
  for (const m of MUTANTS) {
    if (!original.includes(m.find)) {
      skipped++
      results.push(`  ${m.id.padEnd(4)} SKIPPED  anchor not found — the analyzer moved on; fix the harness`)
      continue
    }
    if (m.knownInconclusive) {
      designInconclusive++
      results.push(`  ${m.id.padEnd(4)} INCONCLUSIVE-BY-DESIGN  ${m.what}\n        ${m.knownInconclusive}`)
      continue
    }
    if (m.trigger) {
      let fired = false
      for (const f of sliceFiles) {
        if (m.trigger.test(readFileSync(f, "utf8"))) { fired = true; break }
      }
      if (!fired) {
        inconclusive++
        results.push(`  ${m.id.padEnd(4)} INCONCLUSIVE  the slice contains no ${m.trigger} — the mutant has no trigger here, which is not the same as surviving`)
        continue
      }
    }
    writeFileSync(SRC, original.replace(m.find, m.replace))
    let r: ReturnType<typeof runOracle>
    try {
      r = runOracle()
    } catch (e: any) {
      writeFileSync(SRC, original)
      results.push(`  ${m.id.padEnd(4)} ERROR    the analyzer did not even run: ${String(e.stderr ?? e).slice(0, 120)}`)
      survived++
      continue
    }
    writeFileSync(SRC, original)

    let caught = false
    let how = ""
    if (m.signal === "line") {
      caught = r.lineAccuracy !== 1 || r.lineWrong > 0
      how = `line accuracy ${base.lineAccuracy} -> ${r.lineAccuracy} (wrong ${r.lineWrong})`
    } else if (m.signal === "analyzer-missing") {
      caught = r.analyzerMissing > base.analyzerMissing
      how = `analyzer-attributable ${base.analyzerMissing} -> ${r.analyzerMissing}`
    } else if (m.signal === "metadata") {
      caught = r.coroMismatches > base.coroMismatches || r.frameworkSpurious > base.frameworkSpurious
      how = `coroutine mismatches ${base.coroMismatches} -> ${r.coroMismatches}, framework claims with no member access ${base.frameworkSpurious} -> ${r.frameworkSpurious}`
    } else if (m.signal === "disclosures") {
      caught = r.disclosures < base.disclosures
      how = `surface disclosures ${base.disclosures} -> ${r.disclosures}`
    } else if (m.signal === "rel-spurious") {
      caught = r.relSpurious > base.relSpurious
      how = `direct-path relationship SPURIOUS ${base.relSpurious} -> ${r.relSpurious}`
    } else if (m.signal === "exports") {
      caught = r.exportMissed > base.exportMissed || r.exportSpurious > base.exportSpurious
      how = `direct-path exports missed ${base.exportMissed} -> ${r.exportMissed}, spurious ${base.exportSpurious} -> ${r.exportSpurious}`
    } else {
      caught = r.unexplained > base.unexplained
      how = `unexplained ${base.unexplained} -> ${r.unexplained}`
    }
    if (!caught) survived++
    results.push(`  ${m.id.padEnd(4)} ${caught ? "caught  " : "SURVIVED"}  ${how}   ${m.what}`)
  }
} finally {
  writeFileSync(SRC, original)
}

for (const line of results) console.log(line)

// ---- the harness must also prove IT can fail: a mutant that changes nothing
// observable has to be reported as surviving, not quietly counted as caught.
{
  // A no-op that is SYNTACTICALLY INERT. The first version appended a comment
  // INSIDE a method signature (`private callee( // no-op`), which is not a no-op —
  // it changes the parse, so the "mutant" moved the numbers and the harness
  // reported it CAUGHT, which is the harness congratulating itself for detecting
  // its own typo. A control that cannot be distinguished from a real mutant is not
  // a control.
  const noopAnchor = "  private callee(functionNode: Node): { name: string; nameNode: Node } | undefined {"
  if (!original.includes(noopAnchor)) {
    console.error("  M0    ERROR    the no-op anchor is gone; the harness cannot prove it can tell a no-op from a mutant")
    survived++
  } else {
  const noop: Mutant = { id: "M0", what: "a no-op: the harness must report this as SURVIVING", find: noopAnchor, replace: noopAnchor + "\n    // harness no-op", signal: "analyzer-missing" }
  writeFileSync(SRC, original.replace(noop.find, noop.replace))
  const r = runOracle()
  writeFileSync(SRC, original)
  const noopSurvived = r.analyzerMissing === base.analyzerMissing && r.unexplained === base.unexplained && r.lineAccuracy === 1 && r.exportMissed === base.exportMissed && r.exportSpurious === base.exportSpurious && r.relSpurious === base.relSpurious && r.relMissed === base.relMissed && r.disclosures === base.disclosures && r.coroMismatches === base.coroMismatches && r.frameworkSpurious === base.frameworkSpurious && r.scoreDistinct === base.scoreDistinct
  console.log()
  console.log(`  M0    ${noopSurvived ? "SURVIVED" : "caught"}    a no-op mutant ${noopSurvived ? "correctly reported as surviving — the harness does not call everything caught" : "WRONGLY REPORTED CAUGHT — the harness is broken"}`)
  if (!noopSurvived) survived++
  }
}

const restored = readFileSync(SRC, "utf8")
console.log()
// Clear the sidecar too, so a later run does not "repair" a file that was never
// actually mutated and report a phantom incident.
rmSync(SRC_BACKUP, { force: true })
console.log(`analyzer restored byte-for-byte: ${restored === original ? "YES" : "NO — INVESTIGATE"}`)
// The canonical corpus artifact is never this file's business.
console.log(`mutant runs wrote only to ${MUTANT_OUT}; validation/m60/results/lua-truth-oracle-kong.json untouched`)
console.log(`${MUTANTS.length - skipped - inconclusive - designInconclusive} run, ${inconclusive} inconclusive (no trigger in the slice), ${designInconclusive} inconclusive by design, ${skipped} skipped, ${survived} survived`)
console.log(`A survivor is a real gap in the instrument. An INCONCLUSIVE is a gap in the SLICE — widen it with --sample or --files.`)
process.exit(survived === 0 && restored === original ? 0 : 1)
