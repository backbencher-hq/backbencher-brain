// RUST-MR, re-measured (2026-10-03) — a parameter of a FUNCTION-POINTER TYPE
// declares, it does not read, and the guard that says so needs exactly ONE node
// type to name.
//
// `declaration-position-reads` already pins the bare `extern "C"` shape. What it
// did not cover is the shape the dropped `parenthesized_type` literal was written
// for, and that is the whole justification for dropping it. So this file is the
// parenthesised family, plus the control that stops the guard from passing by
// suppressing reads wholesale.
//
// The guard used to test `bare_function_type`, `function_type` and
// `parenthesized_type`. The pinned tree-sitter-rust 0.24.0 grammar has neither
// of the first or the last: over the 359 admitted corpus files
// `bare_function_type` occurs **0** times and `parenthesized_type` occurs **0**
// times, and they were the two UNKNOWN node-type literals
// `audit-analyzer-grammar --lang rust` reported for this analyzer (refs=86,
// unknown=2; `verify-fixture-coverage` reported the same two as deadLiterals=2).
// A branch no input can reach is dead code.
//
// Measured on the pinned wasm, the parentheses are a `tuple_type` and never a
// `parenthesized_type`, so every shape below reaches the ONE live arm:
//
//   type F = fn(a: u32);            parameters <- function_type <- type_item
//   type F = (fn(a: u32));          parameters <- function_type <- tuple_type
//   type F = ((fn(a: u32)));        parameters <- function_type <- tuple_type
//   type F = extern "C" fn(a: u8);  parameters <- function_type <- type_item
//
// Across the same corpus the parent of a `parameters` node is `function_item`
// 9,194 times, `function_signature_item` 662, `function_type` 209, and nothing
// else. Instrument: `script/m14/rust-fnptr-grammar-probe.ts`.
//
// Every name below is imported, which is what makes these forbid rows
// LOAD-BEARING: a declaration-position name only publishes a read when it also
// RESOLVES, so a fixture whose `schema`/`cb`/`name` resolve to nothing would
// pass with the guard deleted. That is the trivially-true fixture the honesty
// contract's red-team duty hunts for, and it is why the imports are here.
use helper::schema;
use helper::cb;
use helper::paren_schema;
use helper::name;

/// Bare fn-pointer type alias. `schema` and `cb` DECLARE here.
pub type Bare = fn(schema: u32, cb: fn(u8)) -> u32;

/// Parenthesised — the form the dropped `parenthesized_type` name existed for.
pub type Paren = (fn(paren_schema: u32, cb: fn(u8)) -> u32);

/// Doubly parenthesised. Same shape: the outer parens are still a `tuple_type`.
pub type DoubleParen = ((fn( schema: u32) -> u32));

/// The shape RUST-MR was written for: an `extern "C"` fn pointer in a type alias.
pub type PasswordStore = extern "C" fn(schema: *const u32, name: &str);

/// THE CONTROL. A real function's parameter DOES declare, and it is excluded by
/// the per-function bound-name set rather than by this guard — so the same
/// imported leaf, read from a real function body, must keep publishing a `uses`
/// edge. Without this the guard could pass by over-reaching.
pub fn real_function(name: &str) -> u32 {
    name.len()
}

/// THE POSITIVE CONTROL. No parameter shadows the imported `name` here, so the
/// read resolves and must publish. This is the row that proves the forbid rows
/// above are discriminating rather than passing because nothing resolves.
pub fn control() -> u32 {
    let n = name.len();
    n
}