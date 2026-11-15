// R7_AUDIT_FLEET — the AMBIGUITY RULE, as a fixture.
//
// R7 (validation/m60/ledger.json): "No analyzer may NAME something with a
// placeholder literal. When a fallback has nothing truthful to say the honest
// state is ABSENCE, not the string 'unknown' — a literal in a name-bearing field
// becomes a symbol (or an edge endpoint) that does not exist in the source."
//
// This file contains the four shapes that produced 1,280 of the 29,660 ripgrep
// edge endpoints that named the literal `global`, written BEFORE the analyzer
// change so the pins below are expectations rather than a transcript.
//
//   1. `static`/`const` at file scope with a macro invocation in its initializer
//      — the initializer is CODE, and the const is the declaration that owns it.
//   2. a `macro_invocation` written at file scope whose body is a closure
//      containing calls and field reads — Rust declares NOTHING that owns those
//      edges, so the honest state is ABSENCE. This is the shape that cannot be
//      fixed by naming an owner, which is why it is here and not only the easy
//      cases.
//   3. `use super::x` / `use crate::y::Z` — a two-segment path rooted at a Rust
//      PATH KEYWORD. `super`, `crate` and `self` are relative anchors, not
//      crates and not modules, so leaf-dropping onto one published a keyword.
//   4. a `pub` item — the export's source is the FILE that publishes it, spelled
//      `(file)` with `metadata.fileLevel: true` so the store names the
//      importing file (M60/#910) instead of writing the literal `global`.

// ---- (1) a file-scope static/const OWNS its initializer's reads and calls ----

/// A struct with fields, so the array initializer below has field reads.
pub struct Choice {
    pub name: &'static str,
    pub help: &'static str,
}

pub static CHOICES: &[Choice] = &[
    Choice { name: "line", help: "matches" },
    Choice { name: "word", help: "words" },
];

// A `let` inside a closure inside that initializer binds LOCALLY and declares
// nothing outside its body (M11.11), so it publishes no symbol. This line is the
// regression guard for the narrow form of that rule: once a `static` became an
// owner, `let mut aliases` began publishing a Variable owned by CHOICES.
pub static ALIASES: &[&str] = &{
    let mut acc: Vec<&str> = Vec::new();
    acc.push("line");
    acc.push("word");
    acc
};

pub fn read_choices() -> usize {
    CHOICES.len()
}

// ---- (2) a file-scope macro invocation: no declaration owns its body ----

// `rgtest!` is the shape ripgrep's own tests/ and fuzz/ use: a macro
// invocation at file scope carrying a closure whose body calls and reads.
// `calls`/`uses` edges for the body have no owner, and the honest state is
// ABSENCE — the `forbidRelationships` below says so.
bodyprobe!(|dir: Dir, mut cmd: TestCommand| {
    dir.create_bytes("hay", HAY);
    cmd.args(&["--mmap"]);
});

// A macro invocation's argument is an opaque `token_tree` to tree-sitter-rust, so
// `SHERLOCK_MARKER` below is a TOKEN the macro is handed, not a read this file
// performs. The macro may discard it. `forbidRelationships` says no `uses` edge
// may name it -- 205 such reads in one ripgrep file became 36 published edges
// before RUST-D2 was extended from a macro's body to its argument.
bodyprobe_reads!(|hay: &[u8]| {
    let marker = SHERLOCK_MARKER;
});

// ---- (3) path roots: the target is the whole written path ----

use crate::hay::SHERLOCK_MARKER;
use super::sibling::{Alpha, Beta};
use crate::flags::Flag;
use self::local_marker;

// ---- (4) a pub item: the export's source is the FILE ----

pub struct Widget {
    pub id: u32,
}

pub fn make_widget() -> Widget {
    Widget { id: 1 }
}

pub mod inner {
    pub fn nested() -> u32 {
        0
    }
}