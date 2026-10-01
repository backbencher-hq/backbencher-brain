// M60 LUA-09: the export-shape gap, pinned.
//
// Before this gate the ONLY shape that published an export was `return <ident>`.
// `return { a = 1, b = 2 }` — the single most common way a Lua module publishes
// its surface, 366 of Kong's 1,309 files and 33 of Luvit's 199 by grammar-based
// census (1,377 nameable exports) — published NOTHING. `return require("x")`
// likewise. Measured in script/m60/lua-export-census.ts, not estimated.
//
// The rule this gate pins, in one line: a returned table constructor publishes
// exactly the members it NAMES, and nothing else. Array entries have no name and
// publish nothing; nested tables publish their own key only; a return inside a
// function is not a module export at all (LUA-20).
//
// M59: an export's line is the line of the NAME-BEARING node — the member's own
// `name` child — not the `return` keyword's line. On a multi-line table literal
// those differ, and using the return line would put every member of a
// multi-line literal on line 1.
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const REPO = "$HOME/backbencher-brain"
const { parseWithAnalyzer } = await import(REPO + "/script/m60/lua-analyzer-direct")

let pass = 0
let fail = 0
const failures: string[] = []

const check = (ok: boolean, label: string, detail: string = ""): void => {
  if (ok) { pass++; return }
  fail++
  failures.push(`${label}${detail ? " — " + detail : ""}`)
}

const dir = mkdtempSync(join(tmpdir(), "lua-export-shapes-"))
const write = (n: string, s: string): string => {
  writeFileSync(join(dir, n), s)
  return join(dir, n)
}

const names = async (file: string): Promise<string[]> => {
  const d: any = await parseWithAnalyzer(file)
  return (d.exports ?? []).map((e: any) => e.name).sort()
}
const exportOf = async (file: string, want: string): Promise<any> => {
  const d: any = await parseWithAnalyzer(file)
  return (d.exports ?? []).find((e: any) => e.name === want)
}

// ---------------------------------------------------------------- the fix
{
  const got = await names(write("a.lua", "return { a = 1, b = 2 }\n"))
  check(
    JSON.stringify(got) === JSON.stringify(["a", "b"]),
    "named table members are published",
    `expected [a,b], got ${JSON.stringify(got)}`,
  )
}

// --- the boundary that must NOT move: unnamed array entries publish nothing.
// A synthesised name here would be pure invention, and would put names in the
// graph that no source text supports.
{
  const got = await names(write("b.lua", "return { 1, 2, 3 }\n"))
  check(got.length === 0, "array entries publish no invented names", `got ${JSON.stringify(got)}`)
}
{
  const got = await names(write("c.lua", "return {}\n"))
  check(got.length === 0, "empty table publishes nothing", `got ${JSON.stringify(got)}`)
}

// --- The positional case that a `namedChild(0)` FALLBACK would turn into
// fabrication. Mutation M1 (falling back to the first named child when there is
// no `name` field) is a no-op for `return { 1, 2 }`, because the fallback yields
// a number and the type check rejects it — which made M1 survive its first run
// and looked like gate strength. It is not: for a positional entry whose value
// is a STRING the fallback yields a string, `stringValue` strips the quotes, and
// the module would publish exports named after its own array elements. This
// block is what turns M1 from surviving into caught.
for (const [n, src] of [
  ["c1.lua", 'return { "a", "b" }\n'],
  ["c2.lua", "return { { x = 1 }, { y = 2 } }\n"],
  ["c3.lua", "return { f(), g() }\n"],
  ["c4.lua", "return { true, false, nil }\n"],
] as Array<[string, string]>) {
  const got = await names(write(n, src))
  check(got.length === 0, `no name invented from a positional ${src.trim()}`, `got ${JSON.stringify(got)}`)
}

// --- a string key is a name too, and the measured shape puts a STRING node in
// the `name` field (not an identifier), with the unquoted text one level down in
// `content`. Matching identifier-only would silently drop ["k"] = 1 keys.
{
  const got = await names(write("d.lua", 'return { ["k"] = 1, ["j"] = 2 }\n'))
  check(
    JSON.stringify(got) === JSON.stringify(["j", "k"]),
    "string keys publish unquoted",
    `expected [j,k], got ${JSON.stringify(got)}`,
  )
}
{
  const got = await names(write("e.lua", 'return { ["a.b"] = 1 }\n'))
  check(
    JSON.stringify(got) === JSON.stringify(["a.b"]),
    "a dotted string key keeps its dots",
    `expected [a.b], got ${JSON.stringify(got)}`,
  )
}

// --- mixed: named members are published, the positional one is not.
{
  const got = await names(write("f.lua", "return { a = 1, 2, b = 3 }\n"))
  check(
    JSON.stringify(got) === JSON.stringify(["a", "b"]),
    "mixed literal publishes only named members",
    `expected [a,b], got ${JSON.stringify(got)}`,
  )
}

// --- nesting is one level only. `sub` is the export; `x` is a member of sub,
// not of the module, and flattening it would invent a top-level export.
{
  const got = await names(write("g.lua", "return { sub = { x = 1, y = 2 } }\n"))
  check(
    JSON.stringify(got) === JSON.stringify(["sub"]),
    "nested table publishes its own key only",
    `expected [sub], got ${JSON.stringify(got)}`,
  )
}

// --- the whole reason the guard `if (frame.inFunction) return` exists (LUA-20):
// a return inside a function is a function's value, not the file's export.
{
  const got = await names(write("h.lua", "local f = function()\n  return { a = 1 }\nend\nreturn f\n"))
  check(
    JSON.stringify(got) === JSON.stringify(["f"]),
    "a return inside a function is not a module export",
    `expected [f], got ${JSON.stringify(got)}`,
  )
}
{
  const got = await names(write("i.lua", "local M = {}\nfunction M.go()\n  return { a = 1 }\nend\nreturn M\n"))
  check(
    JSON.stringify(got) === JSON.stringify(["M"]),
    "a method's return is not a module export",
    `expected [M], got ${JSON.stringify(got)}`,
  )
}

// --- the pre-existing shape must not regress.
{
  const got = await names(write("j.lua", "local M = {}\nreturn M\n"))
  check(JSON.stringify(got) === JSON.stringify(["M"]), "return <ident> still publishes", `got ${JSON.stringify(got)}`)
}

// --- shapes measured in the census that this fix deliberately does NOT publish.
// Pinned so a future change that starts inventing these is caught here rather
// than showing up as unexplained recall loss in the oracle.
for (const [n, src] of [
  ["k.lua", 'return require("other.module")\n'],
  ["l.lua", 'return "a string"\n'],
  ["m.lua", "return function() end\n"],
] as Array<[string, string]>) {
  const got = await names(write(n, src))
  check(got.length === 0, `no invented name for ${JSON.stringify(src.trim())}`, `got ${JSON.stringify(got)}`)
}

// --- M59: the line is the NAME-BEARING node's line. A multi-line literal puts
// its members on different lines, and anchoring on the `return` would collapse
// all of them onto line 1.
{
  const f = write("n.lua", "return {\n  alpha = 1,\n  beta = 2,\n}\n")
  const alpha = await exportOf(f, "alpha")
  const beta = await exportOf(f, "beta")
  check(alpha?.range?.startLine === 2, "first member's line is its own", `alpha startLine=${alpha?.range?.startLine}, expected 2`)
  check(beta?.range?.startLine === 3, "second member's line is its own", `beta startLine=${beta?.range?.startLine}, expected 3`)
}

// --- A file-scope `do` is `do_statement > block > …`, and an `if` branch is a
// `block` too, so a module return can sit two levels below chunk. Both real
// corpus files depend on this and NEITHER shape was in this gate when the
// corpus-scale check first ran: luvit/deps/tls/lcrypto.lua returns from inside a
// terminal if/else, and kong/kong/init.lua returns from inside a file-scope `do`.
// The census reported the analyzer's (correct) exports as spurious because the
// EXPECTATION walk was too narrow — so both directions are pinned here.
{
  const got = await names(write("o.lua", "do\n  if cond then\n    return { init = f }\n  end\nend\nreturn Kong\n"))
  check(
    JSON.stringify(got) === JSON.stringify(["Kong", "init"]),
    "a return inside a file-scope do block is a module export",
    `expected [Kong,init], got ${JSON.stringify(got)}`,
  )
}
{
  const got = await names(write("p.lua", "if cond then\n  return { a = 1 }\nelse\n  return { b = 2, c = 3 }\nend\n"))
  check(
    JSON.stringify(got) === JSON.stringify(["a", "b", "c"]),
    "a terminal if/else publishes the union of both branches",
    `expected [a,b,c], got ${JSON.stringify(got)}`,
  )
}
// The counterpart: a `do` block INSIDE a function is still a function.
{
  const got = await names(write("q.lua", "local function f()\n  do\n    return { hidden = 1 }\n  end\nend\nreturn f\n"))
  check(
    JSON.stringify(got) === JSON.stringify(["f"]),
    "a do block inside a function is not a module export",
    `expected [f], got ${JSON.stringify(got)}`,
  )
}
// A return inside a LOOP is the same union rule as if/else, not a special case.
// Lua's `return` exits the enclosing function, and at chunk level that ends the
// module load, so a `for` body's return is a genuine possible module surface:
// the loop running gives one module, falling through gives the other. The
// analyzer's rule is uniformly "a return reachable WITHOUT ENTERING A FUNCTION
// is a file-scope return", and this pins that rule rather than a narrower one —
// an earlier version of this gate asserted loops were excluded, and the
// analyzer disagreed, which is a disagreement about the RULE and not a defect.
{
  const got = await names(write("r.lua", "for _, v in ipairs(t) do\n  return { looped = 1 }\nend\nreturn M\n"))
  check(
    JSON.stringify(got) === JSON.stringify(["M", "looped"]),
    "a loop-body return is part of the module's possible surface",
    `expected [M,looped], got ${JSON.stringify(got)}`,
  )
}
// ...and the rule's actual boundary is the FUNCTION, not the block structure.
{
  const got = await names(write("s.lua", "for _, v in ipairs(t) do\n  local function g()\n    return { deep = 1 }\n  end\nend\nreturn M\n"))
  check(
    JSON.stringify(got) === JSON.stringify(["M"]),
    "a return inside a function nested in a loop is not a module export",
    `expected [M], got ${JSON.stringify(got)}`,
  )
}


// ── LUA-35: the shapes that carry no NAME, and the one that does ─────────────
// `return setmetatable(M, mt)` names M. The module's surface IS M, exactly as in
// `return M`, which the analyzer already handles — so this is the one silent
// shape that has a defensible name and was simply not wired.
//
// The other three carry no name at all, and the payload must not invent one:
//   return require("x")     the surface is x's, not this module's
//   return "literal"        a value, and a value is not a name
//   return f()              the result of a call, statically unknowable
//
// For those the useful thing is a DISCLOSURE, not an export. "No exports" today
// means two indistinguishable things — this module defines nothing, and this
// module's surface exists but has no name — and a consumer cannot tell them
// apart. The disclosure separates them while publishing no name, which is the
// only honest option: an export called "x" for a re-export of x would be a
// fabricated name, and this lane has refused that in every other case.
{
  const surfaceOf = async (src: string): Promise<{ exports: string[]; disclosures: any[] }> => {
    const p = join(dir, `s${Math.random().toString(36).slice(2)}.lua`)
    writeFileSync(p, src)
    const d: any = await parseWithAnalyzer(p)
    rmSync(p, { force: true })
    return {
      exports: (d.exports ?? []).map((e: any) => e.name).sort(),
      disclosures: d.metadata?.unpublishedSurface ?? [],
    }
  }

  // 1. the fixable shape: a NAME is present and must be published
  {
    const { exports, disclosures } = await surfaceOf('local Account = {}\nlocal AccountMeta = {}\nsetmetatable(Account, AccountMeta)\nreturn setmetatable(Account, AccountMeta)\n')
    check(
      exports.includes("Account"),
      "return setmetatable(<name>, mt) publishes the name it carries",
      `got ${JSON.stringify(exports)}`,
    )
    check(
      !disclosures.some((d: any) => d.shape === "call-result" && d.detail === "setmetatable"),
      "a setmetatable whose first argument is a name is not disclosed as unnameable",
      JSON.stringify(disclosures),
    )
  }
  // the same, reached through a dot index: `setmetatable(kong.Account, mt)`
  {
    const { exports } = await surfaceOf('local Account = {}\nlocal M = {}\nsetmetatable(M, { __index = Account })\nreturn setmetatable(M, {})\n')
    check(exports.includes("M"), "a dot-index first argument is still a name", `got ${JSON.stringify(exports)}`)
  }
  // 2. the nameless shapes: NO export, and a disclosure that says why
  for (const [shape, src, why] of [
    ["re-export", 'return require("kong.tools.dns")\n', "the surface is another module's"],
    ["value-literal", 'return "a string"\n', "a value is not a name"],
    ["call-result", "return Schema.define({})\n", "the result of a call is statically unknowable"],
  ] as Array<[string, string, string]>) {
    const { exports, disclosures } = await surfaceOf(src)
    check(exports.length === 0, `${shape} publishes no invented name`, `got ${JSON.stringify(exports)}`)
    const d = disclosures.find((x: any) => x.shape === shape)
    check(!!d, `${shape} is disclosed rather than silent`, `disclosures: ${JSON.stringify(disclosures)}`)
    if (d) {
      check(typeof d.why === "string" && d.why.length > 0, `${shape}'s disclosure states why`, JSON.stringify(d))
      check(typeof d.line === "number" && d.line >= 1, `${shape}'s disclosure carries the line of the return`, `line=${d.line}`)
    }
  }
  // a re-export's disclosure must name the module it defers to — that is the
  // information a consumer actually wanted, and it is derived from the source.
  {
    const { disclosures } = await surfaceOf('return require("kong.tools.dns")\n')
    const d = disclosures.find((x: any) => x.shape === "re-export")
    check(d?.detail === "kong.tools.dns", "a re-export disclosure names the module deferred to", `got ${JSON.stringify(d?.detail)}`)
  }
  // 3. a module that DOES name things carries no disclosure
  {
    const { exports, disclosures } = await surfaceOf("return { alpha = 1, beta = 2 }\n")
    check(exports.length === 2 && disclosures.length === 0, "a fully-named module discloses nothing", `exports ${JSON.stringify(exports)} disclosures ${JSON.stringify(disclosures)}`)
  }
  // 4. a function's return is never a module surface (LUA-20), so no disclosure
  {
    const { exports, disclosures } = await surfaceOf('local f = function()\n  return require("x")\nend\nreturn f\n')
    check(exports.length === 1 && !disclosures.some((d: any) => d.shape === "re-export"), "an in-function return discloses nothing", `exports ${JSON.stringify(exports)} disclosures ${JSON.stringify(disclosures)}`)
  }
}

rmSync(dir, { recursive: true, force: true })

console.log(`verify-lua-export-shapes: ${pass} passed, ${fail} failed`)
for (const f of failures) console.log(`  FAIL ${f}`)
process.exit(fail === 0 ? 0 : 1)
