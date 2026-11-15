// INCOMING_RUST — the MODULE SURFACE: `imports` + `exports`.
//
// Written before the analyzer change was run, from Rust's own grammar, because
// this surface is the one an INBOUND query is made of and the lane measured 0
// edges of both kinds over 110 real `.rs` files of ripgrep through the
// production entry. Every form below is a spelling Rust actually accepts.
//
// The one thing asserted hardest is the NEGATIVE half: an `exports` edge whose
// target is not a name this file publishes is a target no index can join, and
// SUPERSEDED (2026-10-19, task-36 defect 4, task-9 conditions): R7/R10 used to
// forbid publishing a re-exported foreign name. A `pub use` publishes exactly the
// names a consumer imports THROUGH this module, and the project index joins them
// at their declaring file — so those names ARE exports now, pinned with
// `relationshipType: re_export` so the distinction from a file-declared `pub` item
// is kept. The old prose follows.
//
// R7/R10 forbid publishing one. `pub use flags::Flag` re-exports an item the
// file does not declare, so the export edge must be refused while the IMPORT
// edge (the path it depends on) is published — the two are different facts and
// conflating them is how `exports -> flags::Flag` would have happened.

use std::io::{Read, Write as W};
use crate::flags::Flag;
use super::util::*;
use ::libc::c_int;
use std::{env, path::PathBuf};

/// The local item a re-export below names. If the re-export were published
/// against a name the file does not declare, this is the name that would go
/// missing.
pub struct LocalThing {
    pub id: u32,
}

pub fn helper() -> u32 {
    1
}

pub mod inner {
    pub fn nested() {}
}

// `pub(crate)` is NOT an external importable unit (D3: unrestricted `pub`
// only), so it must produce no `exports` edge.
pub(crate) fn crate_only() {}

// No `pub` at all, and not at file top level under a module: rides `contains`.
pub fn reexported_marker() {}

// A RE-EXPORT of a name this file publishes. `reexported_marker` is declared
// above, so the re-export edge resolves; `Flag` is imported and NOT declared
// here, so its re-export edge is refused while `crate::flags` still imports.
pub use crate::flags::Flag;
pub use self::reexported_marker;

// A `use` inside a module belongs to that module, so its `imports` SOURCE is
// the module and not the file.
mod scoped {
    use std::collections::HashMap;
    pub fn uses_a_map() {}
}

// The axum/actix route `exports` edge that already existed keeps its own
// target shape (a route, not a symbol); this pin proves the new `pub` surface
// did not collide with it.
fn routed() {}

// TASK-41 / §21.19 NAMED DEFECT: a top-level `pub type` alias is a declaration, is public, and is
// importable (`use crate::PublishedAlias;`), so it joins the exports surface exactly like a pub struct.
// It previously had a type_alias SYMBOL but no exports row (the type_item branch never pushed
// ctx.exports). A `pub(crate)` alias is crate-visible only and must NOT be published outside.
pub type PublishedAlias = u32;
pub(crate) type RestrictedAlias = u32;
