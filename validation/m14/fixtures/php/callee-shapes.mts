/**
 * The PHP callee grammar — where each spelling of a CALL actually lives in the tree.
 *
 * ## Why this is committed rather than run once
 *
 * `exports-probe.mts` classifies a call by its callee, and the classification has exactly one
 * way to be silently wrong: reading the wrong FIELD. It was wrong once, in the direction that
 * matters — `$o->define('X')` and `Foo::define('X')` were classified by `fn?.type`, where `fn`
 * is `n.childForFieldName("function")`; for `member_call_expression` and
 * `scoped_call_expression` that field is **NULL** (the member name lives in a `name` field), so
 * `fnType` was the empty string and a pre-seeded shape key could never be populated. A key that
 * can never fire is the same defect as the `argument`-wrapper zero this probe's own history is
 * made of: a probe that can only read zero, printed next to counts that look measured.
 *
 * Nothing about that is visible from a count. It is visible from the tree, so the tree is
 * printed here — and ASSERTED, so a grammar change (a pinned-wasm upgrade, a different
 * tree-sitter-php build) fails loudly instead of silently reclassifying calls.
 *
 * ## The five shapes, and what each one means for a publication rule
 *
 *   `define(...)`          `name`             unqualified  -> global fallback applies
 *   `\define(...)`         `qualified_name`   fully qualified -> the global function, always
 *   `Other\define(...)`    `qualified_name`   qualified    -> current-namespace prepended
 *   `namespace\define(...)` `relative_name`   relative     -> current namespace, NO fallback
 *   `$f(...)`              `variable_name`    dynamic      -> resolves to nothing statically
 *
 * and the two that are NOT a function call at all — `$o->define(...)` (`member_call_expression`)
 * and `Foo::define(...)` (`scoped_call_expression`) — both with `function === null` and the
 * member name under `name`. PHP never routes a method call to the global function, so a
 * publication rule that classified them by `function` would be reading a field that is not there
 * and a rule that classified them by `name` would publish constants no program defines.
 *
 * Run: npx tsx validation/m14/fixtures/php/callee-shapes.mts
 * Exits non-zero on any mismatch. No corpus required.
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-php.wasm"))))

const SRC = `<?php
namespace App;
\\define('A', 1);
define('B', 2);
Other\\define('C', 3);
namespace\\define('D', 4);
define($dyn, 5);
$f('E');
$this->define('F');
Foo::define('G');
$o->define('H');
Foo::{$name}('I');
`

type Row = { call: string; field: string | null; fieldText: string | null; name: string | null; nameText: string | null }
const rows: Row[] = []
{
  const t: any = parser.parse(SRC)
  const walk = (n: any): void => {
    if (["function_call_expression", "member_call_expression", "nullsafe_member_call_expression", "scoped_call_expression"].includes(n.type)) {
      const fn = n.childForFieldName?.("function")
      const nm = n.childForFieldName?.("name")
      rows.push({
        call: n.type,
        field: fn?.type ?? null,
        fieldText: fn?.text ?? null,
        name: nm?.type ?? null,
        nameText: nm?.text ?? null,
      })
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(t.rootNode)
  t.delete?.()
}

console.log("php callee shapes — where the callee is, by spelling (the tree, printed)")
console.log(`${"#".padEnd(3)} ${"call node".padEnd(30)} ${"function field".padEnd(34)} name field`)
rows.forEach((r, i) => {
  console.log(
    `${String(i).padEnd(3)} ${r.call.padEnd(30)} ${String(r.field === null ? "—" : `${r.field}:${r.fieldText}`).padEnd(34)} ${r.name === null ? "—" : `${r.name}:${r.nameText}`}`,
  )
})

let failures = 0
const check = (name: string, got: unknown, want: unknown): void => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failures++
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name.padEnd(58)} got ${JSON.stringify(got)}${ok ? "" : `  want ${JSON.stringify(want)}`}`)
}
const shape = (i: number): [string, string | null, string | null] => [rows[i].call, rows[i].field, rows[i].fieldText]
console.log("")
// The indices are the SOURCE ORDER of SRC above, and the first call there is `\define`,
// not `define` — the first draft of these assertions was written from memory of the list
// instead of from the list, read one call late, and reported nine "changes" that were the
// pins being wrong rather than the tree. The row-count check below is what makes that class
// of mistake fail as a count instead of as a mystery.
check("the walk found every call in SRC", rows.length, 10)
check("`\\define` is a QUALIFIED_NAME (the fully qualified spelling)", shape(0), ["function_call_expression", "qualified_name", "\\define"])
check("`define` is a name node inside function_call_expression", shape(1), ["function_call_expression", "name", "define"])
check("`Other\\define` is a QUALIFIED_NAME too — text carries the namespace", shape(2), ["function_call_expression", "qualified_name", "Other\\define"])
check("`namespace\\define` is a RELATIVE_NAME, a third node type", shape(3), ["function_call_expression", "relative_name", "namespace\\define"])
check("`define($dyn)` is still a name callee — the NAME is the callee, the arg is the data", shape(4), ["function_call_expression", "name", "define"])
check("`$f(...)` is a variable_name callee", shape(5), ["function_call_expression", "variable_name", "$f"])
check("`$this->define(...)` has function === NULL", shape(6), ["member_call_expression", null, null])
check("`Foo::define(...)` has function === NULL", shape(7), ["scoped_call_expression", null, null])
check("`$o->define(...)` has function === NULL", shape(8), ["member_call_expression", null, null])
check("`Foo::{$name}(...)` has function === NULL", shape(9), ["scoped_call_expression", null, null])
check("  …and its `name` field is the variable, not a name node", [rows[9].name, rows[9].nameText], ["variable_name", "$name"])
check("the member name is under `name` on member/scoped calls", [rows[6].nameText, rows[7].nameText, rows[8].nameText], ["define", "define", "define"])

console.log("")
console.log(failures === 0 ? "all callee shapes pinned" : `${failures} SHAPE(S) CHANGED — every callee classifier in this lane needs re-reading`)
process.exit(failures === 0 ? 0 : 1)
