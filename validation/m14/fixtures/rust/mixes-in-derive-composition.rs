// mixes-in-derive-composition.rs — pins rust's `mixes_in` R3 emission (2026-10-23).
//
// WHY derive IS mixes_in: the contract's discriminator says a mixin composes behaviour into a
// type's supertype chain WITHOUT declaring conformance — not `implements` (no conformance is
// declared), not `extends` (no single base). `#[derive(Serialize)]` composes trait
// implementations the source never declares: there is no `impl Serialize for Config` here,
// and the derived methods arrive at build time.
//
// THE QUALIFIED-PATH CASE IS THE ONE THIS FIXTURE EXISTS FOR: `serde::Serialize` flattens in
// this grammar to TWO sibling identifier nodes inside the token_tree (probe-measured), and the
// first version of the emitter read them separately — producing Config->serde AND
// Config->Serialize for ONE derive argument. The correct emission is ONE row for the
// RIGHTMOST segment: Config->Serialize. A regressed implementation fails the equals-1 pin.
//
// THE REFUSALS ARE PINNED AT equals: 0: `use std::fmt::Debug as _;` mixes a NAME into a SCOPE
// (the measured alternative, 67 use_as_clause of which 21 are `as _`) and must not emit a
// mixes_in row — it is not this relation and names no composing type.

use std::fmt::Debug as _;

#[derive(Debug, Clone, serde::Serialize)]
struct Config {
    name: String,
}

#[derive(Default)]
enum Mode {
    #[default]
    Auto,
}

fn main() {
    let c = Config { name: String::new() };
    let m = Mode::Auto;
    println!("{:?} {:?} {:?}", c, m, c.name);
}
