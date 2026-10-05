// M60 LUA-29: a call target must be a NAME. The analyzer's callee() fell through
// to `functionNode.text` for any callee it had no branch for, so a call ON A CALL
// published the whole inner call as the relationship target:
// `require("some.module")()` -> target `require("some.module")`. 51 such edges on
// kong, e.g. `require("kong.tools.dns")` and `sandbox(expression)`.
//
// It survived because the ORACLE shared the defect — its calleeOf had no guard
// here either, so both sides emitted the payload and the differential read the
// agreement as confirmation. Fixing the oracle's side first is what exposed it.
//
// The rule this gate pins: a target is a name or it is not published. A payload is
// worse than a missing edge, because a missing edge is a silence and a payload is
// a claim no consumer can match, reference, or bound.
//
// Pinned as a WHITELIST in the analyzer, not a blacklist, because two blacklists
// in a row is how `table_index_expression` survived in the oracle as dead code: a
// type nobody re-measures against the grammar stays wrong forever.
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
// Derived from this file's own location, NOT hardcoded. Six of this lane's scripts
// pinned $HOME/backbencher-brain, so in a lane worktree they read a path
// that does not exist and the gate died with ENOENT instead of reporting a verdict.
// A gate that cannot execute is not a gate, and the mutant battery looked green
// only because its failure was being read as a pass.
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

const { parseWithAnalyzer } = await import(REPO + "/script/m60/lua-analyzer-direct")

let pass = 0
let fail = 0
const failures: string[] = []
const check = (ok: boolean, label: string, detail = ""): void => {
  if (ok) { pass++; return }
  fail++
  failures.push(`${label}${detail ? " — " + detail : ""}`)
}

const dir = mkdtempSync(join(tmpdir(), "lua-call-targets-"))
const SRC = `local function go(t, dao, method, context, expression, env)
  plain(1)
  obj.method()
  obj:method()
  dao["rows"]()
  require("some.module")()
  sandbox(expression)()
  dao[method or context](dao, 1)
  f(t)()
  ({ x = 1 }).x()
  return go
end
return go
`
const file = join(dir, "targets.lua")
writeFileSync(file, SRC)
const d: any = await parseWithAnalyzer(file)
const calls = (d.relationships ?? []).filter((r: any) => r.type === "calls")
const targets: string[] = calls.map((c: any) => c.target)

// ---------------------------------------------------------------- the rule
// Positive: a name-bearing callee still produces its edge. Without these the gate
// would also pass on an analyzer that emitted nothing at all.
// NOTE ON CALL-ON-CALL. `sandbox(expression)()` has TWO calls in it. The inner
// one, `sandbox(expression)`, is a real call with a real name and its edge is
// correct. The outer one is called on a RESULT and contributes nothing. So the
// expectation is `sandbox`, NOT "no target" — an earlier version of this gate
// asserted "publishes no target" and was wrong, which the gate itself caught.
for (const [want, why] of [
  ["plain", "a bare identifier call"],
  ["method", "a dot call"],
  ["rows", "a LITERAL index is a name (dao[\"rows\"]())"],
  ["x", "a call on a table constructor's field is still a name"],
  ["sandbox", "a call on a call keeps the INNER call's name (LUA-29)"],
  ["f", "a call on a call keeps the INNER call's name (LUA-29)"],
] as Array<[string, string]>) {
  check(targets.includes(want), `${why} publishes its target`, `got ${JSON.stringify(targets)}`)
}
check(
  targets.length === 6,
  // Six, not seven: `require("some.module")()` contributes NO calls edge, because
  // require is an IMPORTS edge and the outer call is called on a result. Asserted
  // here and again in the per-case block below, since both mistakes are easy.
  "exactly the six name-bearing callees are published, and no payload",
  `got ${JSON.stringify(targets)}`,
)

// The predicate, stated once and applied to every edge: a target is a name.
const PAYLOAD = /[()\[\]"'\n]/
for (const t of targets) {
  check(!PAYLOAD.test(t), `target ${JSON.stringify(t)} is a name, not a payload`, "contains a bracket, paren, quote or newline")
}

// The specific regressions, named, so a reintroduction is legible.
for (const [n, src, why, want] of [
  ["a", 'require("some.module")()\n', "require yields imports, and the outer call yields nothing", []],
  ["b", "sandbox(expression)()\n", "a call on a call with a bare-identifier callee", ["sandbox"]],
  ["c", "f(t)()\n", "a call on a call, minimal", ["f"]],
  ["d", "dao[method or context](dao, 1)\n", "a computed index publishes nothing (LUA-22)", []],
  ["e", "dao[k](v)\n", "a computed index, single letter", []],
  ["f", "f()()()\n", "a call on a call on a call", ["f"]],
] as Array<[string, string, string, string[]]>) {
  const p = join(dir, n + ".lua")
  writeFileSync(p, src)
  const r: any = await parseWithAnalyzer(p)
  const ts = (r.relationships ?? []).filter((x: any) => x.type === "calls").map((x: any) => x.target)
  check(
    JSON.stringify([...new Set(ts)].sort()) === JSON.stringify([...new Set(want)].sort()),
    why,
    `expected ${JSON.stringify(want)}, got ${JSON.stringify(ts)}`,
  )
  for (const t of ts) check(!PAYLOAD.test(t), `no payload target from ${JSON.stringify(src.trim())}`, `got ${JSON.stringify(t)}`)
  // `require("x")` is an IMPORTS edge, not a calls edge, so a call-on-require
  // publishes no calls target at all. Asserted rather than left implicit: an
  // earlier version of this gate expected ["require"] here and was wrong, because
  // it assumed require produces a calls edge. It does not.
  if (n === "a") {
    const imps = (r.relationships ?? []).filter((x: any) => x.type === "imports").map((x: any) => x.target)
    check(
      JSON.stringify(imps) === JSON.stringify(["some.module"]),
      "require inside a call-on-call still yields its imports edge",
      `got ${JSON.stringify(imps)}`,
    )
  }
  rmSync(p, { force: true })
}

// ── mutation: the gate must be RED on the pre-fix analyzer ────────────────────
// F7 requires the gate to have been red BEFORE the fix. This is that proof, run
// after the fact: the LUA-29 whitelist is deleted from callee(), the gate is
// re-run, and it must fail. If it passes, the gate is not testing the fix.
{
  const SRC_PATH = REPO + "/src/ast/real-lua-analyzer.ts"
  const original = readFileSync(SRC_PATH, "utf8")
  const anchor = `    if (functionNode.type === "function_call" || functionNode.type === "table_constructor" ||`
  if (!original.includes(anchor)) {
    console.log("  MUTATION SKIPPED — the LUA-29 whitelist is not where it was; fix the mutation")
    fail++
  } else {
    const i = original.indexOf(anchor)
    const j = original.indexOf("    if (functionNode.text) return", i)
    try {
      writeFileSync(SRC_PATH, original.slice(0, i) + original.slice(j))
      let red = false
      try {
        execFileSync("bun", [join(REPO, "script/m60/verify-lua-call-targets.ts")], {
          cwd: REPO, encoding: "utf8",
          env: { ...process.env, PATH: process.env.HOME + "/.local/bin:" + process.env.PATH },
        })
      } catch {
        red = true
      }
      check(red, "the gate is RED on the pre-fix analyzer (F7)", "it passed without the LUA-29 whitelist")
    } finally {
      writeFileSync(SRC_PATH, original)
    }
    const restored = readFileSync(SRC_PATH, "utf8")
    check(restored === original, "analyzer restored byte-for-byte after the mutant run", "SOURCE DIFFERS")
  }
}

// M60 LUA-32: the same rule on the `setmetatable` path, which LUA-29's callee
// whitelist never touched. `setmetatable(self, { __index = super })` published
// `extends self -> { __index = super }` — a whole table constructor as a
// relationship TARGET. The one at kong/cmd/utils/log.lua:88 spans five lines, and
// because pool-worker rejects any target containing a newline the edge never
// reached the store: through the pipeline the defect was INVISIBLE, the edge
// merely absent. It surfaced only from the direct-vs-pipeline seam probe.
{
  const mt = async (src: string): Promise<string[]> => {
    const p = join(dir, `mt-${Buffer.from(src).toString("hex").slice(0, 24)}.lua`)
    writeFileSync(p, src)
    const r: any = await parseWithAnalyzer(p)
    return (r.relationships ?? []).filter((x: any) => x.type === "extends").map((x: any) => `${x.source}->${x.target}`)
    }
  check(
    JSON.stringify(await mt('local A = {}\nlocal M = {}\nsetmetatable(A, M)\nreturn A\n')) === JSON.stringify(["A->M"]),
    "a named metatable still yields extends",
    "the legitimate setmetatable edge must survive the fix",
  )
  for (const [why, src] of [
    ["an inline metatable table", 'local A = {}\nsetmetatable(A, { __index = M })\nreturn A\n'],
    ["a metatable built by a call", 'local A = {}\nsetmetatable(A, make_meta())\nreturn A\n'],
    ["a multi-line metatable table", 'local A = {}\nsetmetatable(A, {\n  __index = M,\n  __call = function(_, ...)\n    return A\n  end,\n})\nreturn A\n'],
  ] as Array<[string, string]>) {
    const got = await mt(src)
    check(got.length === 0, `${why} publishes no extends target`, `got ${JSON.stringify(got)}`)
    for (const g of got) check(!/\n/.test(g), `no multi-line target from ${why}`, JSON.stringify(g))
  }
}

console.log(`verify-lua-call-targets: ${pass} passed, ${fail} failed`)
for (const f of failures) console.log(`  FAIL ${f}`)
rmSync(dir, { recursive: true, force: true })
process.exit(fail === 0 ? 0 : 1)
