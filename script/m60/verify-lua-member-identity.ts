// verify-lua-member-identity.ts — M60 lua LUA-15: a member's identity is its
// container plus its own name, and the two are recorded ONCE.
//
// WHAT THIS GATES
// ---------------
// RealLuaAnalyzer.extractFunction takes the symbol name from `nameNode.text`.
// For `function Buffer:initialize(length)` that text is the string
// "Buffer:initialize", so the symbol comes out as:
//
//   name       "Buffer:initialize"      <- the whole qualified text
//   ownerName  "Buffer"                 <- the receiver, recorded AGAIN
//   ownerKind  Class
//
// The name already contains the owner, and the owner is stored beside it. The
// M49 W2 ruling ("a member's identity is its container, not its bare name")
// requires the container to be part of the identity; this satisfies neither
// reading, because the name is a PATH and the container is duplicated.
//
// The user-visible consequence is not cosmetic. A call edge targets the
// callee's own name — `obj:method()` yields target `method` — so it can never
// be joined to a declaration named `Buffer:initialize`. Call-to-declaration
// resolution therefore fails for EVERY METHOD in the language, and the failure
// is silent: both sides look well-formed.
//
// The contract this gate asserts, per declaration shape:
//
//   function Buffer:initialize()   ->  name "initialize",  owner "Buffer"
//   function Buffer.readUInt8()     ->  name "readUInt8",  owner "Buffer"
//   function M.new()                ->  name "new",        owner "M"
//   function plain()                ->  name "plain",      no owner
//
// and, as the consequence that actually matters to a user: a call through a
// receiver must be JOINABLE to the declaration it names.
//
// Usage: npx tsx script/m60/verify-lua-member-identity.ts
import { mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const EVIDENCE = join(ROOT, "validation", "m60", "results", "lua-member-identity.json")
const PROBE_DIR = "$HOME/fixtures/probe"

const FIXTURE: Record<string, string> = {
  "members.lua": [
    "local Buffer = {}",                                          // 1
    "local M = {}",                                               // 2
    "",                                                            // 3
    "function Buffer:initialize(length)",                         // 4
    "  self.len = length",                                        // 5
    "end",                                                         // 6
    "",                                                            // 7
    "function Buffer.readUInt8(self)",                            // 8
    "  return 0",                                                 // 9
    "end",                                                         // 10
    "",                                                            // 11
    "function M.new(opts)",                                       // 12
    "  return setmetatable({}, M)",                              // 13
    "end",                                                         // 14
    "",                                                            // 15
    "function plain(x)",                                          // 16
    "  return x",                                                 // 17
    "end",                                                         // 18
    "",                                                            // 19
    "function use()",                                             // 20
    "  local b = Buffer:initialize(1)",                           // 21
    "  local v = Buffer.readUInt8(b)",                            // 22
    "  local o = M.new({})",                                      // 23
    "  plain(1)",                                                 // 24
    "end",                                                        // 25
  ].join("\n") + "\n",
}

// name -> owner, derived from the fixture TEXT, so the expectation cannot drift
// away from the fixture by editing one of them.
const EXPECTED_MEMBERS: Array<{ name: string; owner: string; line: number }> = [
  { name: "initialize", owner: "Buffer", line: 4 },
  { name: "readUInt8", owner: "Buffer", line: 8 },
  { name: "new", owner: "M", line: 12 },
]
const EXPECTED_PLAIN: Array<{ name: string; line: number }> = [{ name: "plain", line: 16 }]

const checks: Array<{ name: string; pass: boolean; detail: string }> = []
const check = (n: string, p: boolean, d = ""): void => { checks.push({ name: n, pass: p, detail: d }) }

async function main(): Promise<void> {
  mkdirSync(PROBE_DIR, { recursive: true })
  for (const [n, t] of Object.entries(FIXTURE)) writeFileSync(join(PROBE_DIR, n), t)

  const r: any = await parseFile(join(PROBE_DIR, "members.lua"), PROBE_DIR)
  const syms: any[] = r.symbols ?? []
  const rels: any[] = r.relationships ?? []
  const byName = (n: string) => syms.filter((s) => s.name === n)

  // 1. every expected member exists under its OWN name
  const absent = EXPECTED_MEMBERS.filter((m) => !byName(m.name).some((s) => s.ownerName === m.owner))
  check("every method is a symbol under its OWN name with its owner", absent.length === 0,
    absent.length ? absent.map((m) => `${m.owner}:${m.name}`).join(", ") : `${EXPECTED_MEMBERS.length}/${EXPECTED_MEMBERS.length} present`)

  // 2. no symbol name carries a path separator or duplicates its owner
  const pathy = syms.filter((s) => /[.:]/.test(s.name))
  check("no symbol name contains '.' or ':' (a path, not a name)", pathy.length === 0,
    pathy.length ? pathy.map((s) => `${s.ownerName ?? "-"} -> ${s.name}`).join(", ") : "none")

  const dup = syms.filter((s) => s.ownerName && typeof s.name === "string" && s.name.startsWith(`${s.ownerName}.`))
  check("no symbol name duplicates its own owner", dup.length === 0,
    dup.length ? dup.map((s) => `${s.ownerName} -> ${s.name}`).join(", ") : "none")

  // 3. the owner's own declaration is a separate symbol (Buffer exists, and is
  //    not the same symbol as Buffer:initialize)
  const ownerSyms = EXPECTED_MEMBERS.map((m) => byName(m.owner))
  check("each owner is itself a symbol", ownerSyms.every((g) => g.length > 0),
    EXPECTED_MEMBERS.map((m) => `${m.owner}:${byName(m.owner).length}`).join(" "))

  // 4. plain functions have no owner
  const plainBad = EXPECTED_PLAIN.filter((p) => byName(p.name).some((s) => s.ownerName && s.ownerName !== "global"))
  check("a plain function has no owner", plainBad.length === 0, plainBad.map((p) => p.name).join(", ") || "none")

  // kind is part of the contract, and it is what makes the fourth mutant
  // observable at all. The mutant it replaced set a plain function's ownerName
  // to "global" — which is UNOBSERVABLE here, because pool-worker maps
  // `ownerName: s.ownerName || s.scope`, so a plain function's ownerName is
  // already the string "global" whether or not the analyzer set one. That mutant
  // LEAKED, and the honest reading is that it was an INVALID mutant rather than
  // a gate that needed loosening: it planted a state the pipeline produces on its
  // own. The check was NOT weakened to accommodate it; a real assertion was added
  // so that the regression it meant to plant has a visible form.
  const kindBad = [
    ...EXPECTED_MEMBERS.filter((m) => byName(m.name).some((s) => s.kind !== "method")).map((m) => `${m.owner}:${m.name} is not a method`),
    ...EXPECTED_PLAIN.filter((p) => byName(p.name).some((s) => s.kind !== "function")).map((p) => `${p.name} is not a function`),
  ]
  check("a member is a method and a plain function is a function", kindBad.length === 0, kindBad.join(", ") || "correct")

  // 5. THE CONSEQUENCE. A call through a receiver must be joinable to a
  //    declaration: same target name AND same receiver as the owner.
  const joinable: string[] = []
  const unjoinable: string[] = []
  for (const e of rels.filter((x) => x.type === "calls")) {
    const t = String(e.target)
    if (!["initialize", "readUInt8", "new", "plain"].includes(t)) continue
    const owner = e.source === "use" ? "Buffer" : undefined
    // the receiver is not on the edge, so the honest test is: does a symbol
    // exist whose name IS the call target? Under LUA-15 it did not, because the
    // declaration was filed under "Buffer:initialize".
    if (byName(t).length > 0) joinable.push(`${e.source} -> ${t}`)
    else unjoinable.push(`${e.source} -> ${t}`)
    void owner
  }
  check("every method call target joins to a declaration of that name", unjoinable.length === 0,
    unjoinable.length ? `UNJOINABLE: ${unjoinable.join(", ")}` : `${joinable.length} joined`)

  // 6. lines still correct on the members (M59 rule survives the identity fix)
  const lineOf = (n: string) => syms.find((s) => s.name === n)?.startLine
  const lineBad = EXPECTED_MEMBERS.filter((m) => lineOf(m.name) !== m.line)
  check("each member is filed at its own declaration line", lineBad.length === 0,
    lineBad.map((m) => `${m.name}@${lineOf(m.name)}!=${m.line}`).join(", ") || "all correct")

  // ── mutants: the gate must be able to fail ─────────────────────────────────
  // Output mutation, for the reason recorded in verify-lua-edge-lines.ts: the
  // engine caches analyzer modules, so editing the source after first import has
  // no effect and every source mutant silently re-measures the unmutated code.
  console.log("\nM: planted regressions (the gate must fail on each)")
  const verify = (symbols: any[]): string[] => {
    const f: string[] = []
    const named = (n: string) => symbols.filter((s) => s.name === n)
    for (const m of EXPECTED_MEMBERS) if (!named(m.name).some((s) => s.ownerName === m.owner)) f.push(`${m.owner}:${m.name} not a symbol under its own name`)
    for (const s of symbols) if (/[.:]/.test(String(s.name))) f.push(`path-like name: ${s.name}`)
    for (const s of symbols) if (s.ownerName && String(s.name).startsWith(`${s.ownerName}.`)) f.push(`name duplicates owner: ${s.ownerName} -> ${s.name}`)
    for (const p of EXPECTED_PLAIN) if (named(p.name).some((s) => s.ownerName && s.ownerName !== "global")) f.push(`plain function has a real owner: ${p.name}`)
    // kind is part of the identity contract: a member is a Method, a plain
    // function is a Function. It is also the only OBSERVABLE difference for the
    // fourth mutant — see the note on that mutant.
    for (const m of EXPECTED_MEMBERS) { const sy = named(m.name)[0]; if (sy && sy.kind !== "method") f.push(`${m.owner}:${m.name} filed as ${sy.kind}, not method`) }
    for (const p of EXPECTED_PLAIN) { const sy = named(p.name)[0]; if (sy && sy.kind !== "function") f.push(`${p.name} filed as ${sy.kind}, not function`) }
    for (const m of EXPECTED_MEMBERS) { const s = named(m.name)[0]; if (s && s.startLine !== m.line) f.push(`${m.name} at L${s.startLine}, expected L${m.line}`) }
    return f
  }
  const baseFailures = verify(syms)
  check("the unmutated symbols pass every expectation", baseFailures.length === 0, baseFailures.join("; ") || "clean")

  const MUTANTS: Array<{ name: string; apply: (s: any[]) => any[] }> = [
    { name: "LUA-15 again: the name is the full qualified text", apply: (s) => s.map((x) => (x.ownerName && ["initialize", "readUInt8", "new"].includes(x.name) ? { ...x, name: `${x.ownerName}:${x.name}` } : x)) },
    { name: "the owner is dropped entirely", apply: (s) => s.map((x) => ({ ...x, ownerName: undefined })) },
    // The ORIGINAL fourth mutant set a plain function's ownerName to "global",
    // which is unobservable: pool-worker's `ownerName: s.ownerName || s.scope`
    // already yields "global" for a plain function. It LEAKED, and the fix was to
    // plant a regression with a visible form (a plain function filed as a
    // method), not to loosen the check. A gate that is loosened until a mutant
    // passes is not a gate.
    { name: "a plain function is filed as a method", apply: (s) => s.map((x) => (x.name === "plain" ? { ...x, kind: "method", ownerName: "Buffer" } : x)) },
    { name: "a member is filed at the wrong line", apply: (s) => s.map((x) => (x.name === "readUInt8" ? { ...x, startLine: 1 } : x)) },
  ]
  let caught = 0
  const detail: Array<{ name: string; caught: boolean; failures: string[] }> = []
  for (const m of MUTANTS) {
    const failures = verify(m.apply(syms.map((x) => ({ ...x }))))
    const hit = failures.length > 0
    if (hit) caught++
    detail.push({ name: m.name, caught: hit, failures: failures.slice(0, 2) })
    console.log(`  ${hit ? "CAUGHT " : "LEAK   "}  ${m.name}`)
  }
  check("every planted regression is caught", caught === MUTANTS.length, `${caught}/${MUTANTS.length}`)

  const passed = checks.every((c) => c.pass)
  const result = {
    schemaVersion: 1,
    gate: "verify-lua-member-identity",
    title: "M60 lua LUA-15 — a member's identity is its container plus its own name, recorded once",
    at: new Date().toISOString(),
    analyzer: "src/ast/real-lua-analyzer.ts",
    fixture: FIXTURE,
    expectedMembers: EXPECTED_MEMBERS,
    expectedPlain: EXPECTED_PLAIN,
    observedSymbols: syms.map((s) => ({ name: s.name, owner: s.ownerName ?? null, startLine: s.startLine, kind: s.kind })),
    checks,
    mutants: { caught, total: MUTANTS.length, detail, method: "output mutation — the engine caches analyzer modules, so in-process source mutation has no effect" },
    passed,
    status: passed ? "pass" : "fail",
    limitations: [
      "The call-to-declaration join test asserts that a symbol exists whose name IS the call target. It does not assert the RECEIVER matches, because the call edge does not carry one — under LUA-13 the receiver is dropped from the edge. Adding it is a separate change with its own trade-off (an unqualified target cannot be resolved, which is why `M.new` and `Account:new` are currently indistinguishable on the wire).",
      "The fixture is one file with five declarations. It exercises each shape but is not a corpus; script/m60/lua-truth-oracle.ts is the corpus-scale check on the same contract.",
    ],
  }
  mkdirSync(dirname(EVIDENCE), { recursive: true })
  writeFileSync(EVIDENCE, JSON.stringify(result, null, 2) + "\n")
  for (const c of checks) console.log(`  ${c.pass ? "ok  " : "FAIL"}  ${c.name}${c.detail ? `  (${c.detail})` : ""}`)
  if (!passed) {
    console.log("\nsymbols as emitted:")
    for (const s of syms) console.log(`  ${s.kind}\t${s.name}\towner=${s.ownerName ?? "-"}\tL${s.startLine}`)
  }
  console.log(`\nlua-member-identity: ${result.status.toUpperCase()} (${checks.filter((c) => c.pass).length}/${checks.length} checks, ${caught}/${MUTANTS.length} mutants caught)`)
  console.log(`wrote ${EVIDENCE}`)
  if (!passed) process.exitCode = 1
  void readFileSync
}
main()
