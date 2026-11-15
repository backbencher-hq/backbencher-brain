// part-of-include-macro.rs — pins rust's `part_of` R3 emission (2026-10-23).
//
// THE CONSTRUCT: `include!("…")` is TEXTUAL FILE INCLUSION — the included file's tokens
// land in the INCLUDING file's scope, it imports nothing, and the fragment has no module
// identity at all. That is the Dart `part` relation and cpp's `#include` in Rust spelling.
// `mod` is NOT part_of (fleet ruling L-2026-10-21-06: ownership/split, and `mod` resolves
// as `x::item` — a resolvable unit is the opposite of a fragment).
//
// THE CAUSAL DIRECTION THIS FIXTURE PINS: the part_of edge exists ONLY because the
// include! macro invocation reaches the analyzer as a real `macro_invocation` node whose
// token_tree carries a `string_literal`. A build that lexes the directive as recovery text
// emits nothing, and this expectation fails. The two near-miss refusals are pinned beside
// it: `include_str!` is DATA inclusion (no part_of row), and a non-literal argument is
// refused (no part_of row) — a wrong implementation that emitted either would fail here.
//
// `helper()` is called from `connect()` so the file exercises a normal calls edge too;
// the expectation pins that the part_of emission does not disturb it.

include!("included-part.rs");

fn connect() -> bool {
    helper()
}

#[test]
fn data_inclusion_is_not_part_of() {
    let _s: &str = include_str!("data.txt");
}
