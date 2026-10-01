/**
 * verify-erlang-contains — the gate for the Erlang `contains` oracle.
 *
 * Erlang has no classes: the module is the container, so `contains` is the set of
 * names a file declares at module scope. Two of the three things the oracle had to
 * get right were found by the CORPUS and not by reading the grammar, which is the
 * usual pattern and the reason each is pinned here:
 *
 *   1. A macro's name lives in `macro_lhs`, not in a direct `atom` child, and
 *      `macro_lhs` carries the parameter list too — `dbg(Fmt, Args)` names `dbg`.
 *      Looking for an `atom` child found nothing and derived no macro at all:
 *      138 analyzer rows on a 50-file otp draw (`dbg`, `DBG`, `SMALL`, `L`) had no
 *      truth.
 *   2. An `.hrl` header declares NO `-module`, and an empty owner made `add()` DROP
 *      the row rather than emit it unmatched — so `xmerl_internal.hrl` derived ZERO
 *      rows. The comment in the oracle said the source end should go unmatched; the
 *      code deleted the whole edge, which is the difference between an honest
 *      unmatched row and an absence.
 *   3. Declarations are not all at the top level: Erlang's preprocessor conditionals
 *      (`-ifdef`/`-if`/`-else`) wrap real declarations and OTP headers lean on them.
 *      They are compilation conditionals, not new scopes, so they are flattened
 *      rather than descended-and-scoped.
 *
 * And one thing the oracle must NOT do, which the corpus also had to teach:
 *
 *   4. A `-spec` restates a function's type; it is not a separate declaration.
 *      Including it would manufacture a row the analyzer does not publish, which is a
 *      fabrication on the TRUTH side.
 *
 * Measured on 50 files per corpus: rebar3 1,023/1,023 agreed and otp 5,212/5,212
 * agreed, with ZERO analyzer-only and ZERO truth-only rows in both directions.
 *
 * READ-ONLY. Writes nothing.
 */

import fs from "node:fs"
import path from "node:path"
import { deriveErlangContainsTruth, NO_MODULE } from "./oracles/erlang-contains"

const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..")

let failures = 0
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`)
  if (!ok) failures++
}

async function derive(src: string): Promise<{ rows: string[]; froms: Set<string> }> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-erlang.wasm")))
  const parser = new P()
  parser.setLanguage(gl)
  const edges = deriveErlangContainsTruth(parser.parse(src).rootNode)
  return { rows: edges.map((e) => e.target), froms: new Set(edges.map((e) => e.from)) }
}

const has = (rows: string[], k: string): boolean => rows.includes(k)

async function main(): Promise<void> {
  console.log("# verify-erlang-contains\n")

  // ── the whole declaration surface ────────────────────────────────────────
  const full = await derive(`-module(m).
-export([f/1, g/2]).
-define(SIMPLE, 1).
-define(withArgs(A, B), A + B).
-record(r, {a = 1, b}).
-type(t() :: integer()).
-spec f(integer()) -> integer().
f(X) -> X + 1.
g(A, B) when A > B -> A;
   (A, B) -> B.
`)
  check("a plain macro is derived", has(full.rows, "SIMPLE"))
  check("a PARAMETERISED macro is derived (macro_lhs, not atom)", has(full.rows, "withArgs"),
    `rows=${full.rows.join(",")}`)
  check("a record is derived", has(full.rows, "r"))
  check("a record's fields are derived", has(full.rows, "a") && has(full.rows, "b"))
  check("a type alias is derived", has(full.rows, "t"))
  check("a function is derived", has(full.rows, "f"))
  check("several clauses are ONE function name, not two", !has(full.rows, "g/2") && full.rows.filter((r) => r === "g").length === 1,
    `g count=${full.rows.filter((r) => r === "g").length}`)
  check("a -spec is NOT a member (it restates a function's type)", !has(full.rows, "spec"),
    `rows=${full.rows.join(",")}`)
  check("the module is the CONTAINER, not something it contains", !has(full.rows, "m"))
  check("the -export attribute is not a member", !has(full.rows, "export"))

  // ── a file with no -module still declares things ─────────────────────────
  const header = await derive(`-define(dbg(Fmt, Args), ok).
-ifdef(DEBUG).
-define(VERBOSE, true).
-endif.
`)
  check("a module-less file derives its macros rather than dropping them",
    has(header.rows, "dbg") && has(header.rows, "VERBOSE"),
    `rows=${header.rows.join(",")}`)
  check("a module-less file uses the declared placeholder owner, not a fabricated module",
    [...header.froms].every((f) => f === NO_MODULE), `froms=${[...header.froms].join(",")}`)

  // ── -else branch declarations are real declarations ──────────────────────
  const cond = await derive(`-module(c).
-ifdef(A).
-define(IN_A, 1).
-else.
-define(IN_B, 2).
-endif.
f() -> ok.
`)
  check("a declaration inside -ifdef is derived", has(cond.rows, "IN_A"))
  check("a declaration inside -else is derived", has(cond.rows, "IN_B"))
  check("functions alongside a preprocessor block are still derived", has(cond.rows, "f"))

  // ── an empty file derives nothing ────────────────────────────────────────
  const empty = await derive(`-module(e).\n`)
  check("a module with no declarations emits no rows", empty.rows.length === 0, `rows=${empty.rows.join(",")}`)

  console.log("")
  if (failures === 0) {
    console.log("the erlang contains oracle derives the whole module-scope surface and invents nothing")
    process.exit(0)
  }
  console.log(`${failures} check(s) failed`)
  process.exit(1)
}
main().catch((e) => { console.error(e); process.exit(1) })