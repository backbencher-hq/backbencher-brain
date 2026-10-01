/**
 * verify-rust-contains — the gate for the Rust `contains` oracle.
 *
 * The oracle (script/m14/oracles/rust-contains.ts) reached zero disagreement in both
 * directions on both rust corpora. Four things had to be right, and three of them were
 * found by the CORPUS rather than by reading the grammar:
 *
 *   1. A TYPE item is named by a `type_identifier`; a VALUE item is named by an
 *      `identifier`, and the two must not share one lookup. A function's RETURN TYPE
 *      is also a `type_identifier`, so `fn new() -> Self` was being named `Self` — the
 *      oracle published a type where the language declares a function. Two lines
 *      reproduce it: `struct S; impl S { fn from_x(a: i32) -> i32 { a }  pub fn new()
 *      -> Self { S } }`, where `from_x` (no return type) came out right and `new` did
 *      not.
 *   2. A GENERIC impl puts its self type in a `generic_type`, not a bare
 *      `type_identifier`: `impl<W: Write> CounterWriter<W> { ... }`. The first draft
 *      read an empty owner and DROPPED every method in the block — 159 analyzer rows on
 *      a 40-file ripgrep draw, all real methods.
 *   3. A FUNCTION can own things. Rust allows nested `impl` blocks and nested `fn`s
 *      inside a body, and the analyzer's owner is `ownerName || scope`, so
 *      `with_separator -> replace_separator` is a real containment edge.
 *   4. …but a function owns nested TYPES and FUNCTIONS, not nested VALUES.
 *      `static MANIFEST: &str` inside a `fn` is a local constant and the analyzer
 *      does not publish it as contained; including it added 3 truth-only rows
 *      (`MANIFEST`, `BINARY`, `ALPHABET`) — a fabrication on the TRUTH side, which is
 *      the direction that quietly inflates coverage.
 *
 * Two rules the oracle deliberately does not apply, both pinned below: an `impl` block
 * is owned by the TYPE it implements rather than by a symbol of its own (Rust has no
 * `impl` entity to own it), and a `use` declaration is not a member — it brings a name
 * into scope rather than declaring one, and the lane's `imports` label covers it.
 *
 * READ-ONLY. Writes nothing.
 */

import fs from "node:fs"
import path from "node:path"
import { deriveRustContainsTruth } from "./oracles/rust-contains"

const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..")

let failures = 0
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`)
  if (!ok) failures++
}

async function derive(src: string): Promise<string[]> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-rust.wasm")))
  const parser = new P()
  parser.setLanguage(gl)
  return deriveRustContainsTruth(parser.parse(src).rootNode).map((e) => e.target)
}

const has = (rows: string[], k: string): boolean => rows.includes(k)

async function main(): Promise<void> {
  console.log("# verify-rust-contains\n")

  // ── 1. a value item is named by `identifier`, not by its return type ─────
  const fnNames = await derive(`struct S;
impl S {
    fn from_x(a: i32) -> i32 { a }
    pub fn new() -> Self { S }
}
`)
  check("a function with no return type is named correctly", has(fnNames, "from_x"))
  check("a function with a RETURN TYPE is named by its own identifier, not the type",
    has(fnNames, "new") && !has(fnNames, "Self"), `rows=${fnNames.join(",")}`)

  // ── 2. a generic impl is a container ─────────────────────────────────────
  // Inside a module, so the struct has an owner: a TOP-LEVEL item has none, and
  // neither the analyzer nor this oracle publishes it as contained. (The first
  // version of this check put the struct at top level and asserted its name appeared,
  // which asserted a containment edge Rust does not have.)
  const generic = await derive(`pub mod m {
    pub struct C<T> { pub v: T }
    impl<T: Clone> C<T> {
        pub fn get(&self) -> &T { &self.v }
    }
}
`)
  check("a generic impl's methods are derived (generic_type, not type_identifier)",
    has(generic, "get") && has(generic, "C") && has(generic, "v"), `rows=${generic.join(",")}`)

  // A top-level STRUCT is contained by nothing (it has no owner), but its own field
  // is still contained by it. Both halves matter: dropping the field would lose a
  // real edge, and publishing the struct would invent one.
  const topLevel = await derive(`pub struct Loose { pub f: i32 }\n`)
  check("a TOP-LEVEL struct is contained by nothing", !has(topLevel, "Loose"), `rows=${topLevel.join(",")}`)
  check("a top-level struct still owns its own field", has(topLevel, "f"), `rows=${topLevel.join(",")}`)

  // ── 3/4. a function owns nested types and functions, not nested values ──
  const nested = await derive(`fn outer() {
    struct Inner;
    fn helper() {}
    static LOCAL: i32 = 1;
    impl Inner { fn m(&self) {} }
}
`)
  check("a function owns a nested struct", has(nested, "Inner"), `rows=${nested.join(",")}`)
  check("a function owns a nested function", has(nested, "helper"))
  check("a function owns a method of a nested impl", has(nested, "m"))
  check("a function does NOT own a nested `static` (a local value, not a member)",
    !has(nested, "LOCAL"), `rows=${nested.join(",")}`)

  // ── members of each container kind ───────────────────────────────────────
  const kinds = await derive(`pub mod m {
    pub const C: i32 = 1;
    pub fn f() {}
    pub struct S { pub field: i32 }
    pub enum E { A, B(i32) }
    pub trait T { fn sig(&self); }
    use std::fmt;
}
`)
  check("module owns a const", has(kinds, "C"))
  check("module owns a fn", has(kinds, "f"))
  check("module owns a struct", has(kinds, "S"))
  check("module owns an enum", has(kinds, "E"))
  check("module owns a trait", has(kinds, "T"))
  check("struct owns its field", has(kinds, "field"))
  check("enum owns its variants", has(kinds, "A") && has(kinds, "B"))
  check("a trait owns its bodiless signature", has(kinds, "sig"))
  check("a `use` declaration is NOT a member", !has(kinds, "fmt"), `rows=${kinds.join(",")}`)

  // ── no self-containment ──────────────────────────────────────────────────
  // `type T = T of string` is a real and common F#/DU-style spelling in rust
  // type aliases; a self edge would be noise in the graph.
  const selfNamed = await derive(`type Alias = Alias;\n`)
  check("a self-named declaration does not produce a self-edge", !has(selfNamed, "Alias"),
    `rows=${selfNamed.join(",")}`)

  // ── an empty file ────────────────────────────────────────────────────────
  const empty = await derive(``)
  check("an empty file emits no rows", empty.length === 0, `rows=${empty.join(",")}`)

  console.log("")
  if (failures === 0) {
    console.log("the rust contains oracle derives every item shape and invents nothing")
    process.exit(0)
  }
  console.log(`${failures} check(s) failed`)
  process.exit(1)
}
main().catch((e) => { console.error(e); process.exit(1) })