// RUST-D31 — `use` IS rust's import, and it is now a first-class `imports`
// relationship, not only an ImportInfo row.
//
// Before this, the lane recorded every `use` in the imports array and published
// NO relationship for it, so `imports` measured 0 edges on 110 ripgrep `.rs`
// files that carry 404 `use_declaration` nodes. The reader that answers "what
// does this module depend on" (the LSP usages file-level section,
// `relationship_type IN ('imports','exports')`) could not see a rust `use` at
// all.
//
// The SOURCE is what a `use` is scoped to, and there are three scopes, pinned
// here one per row:
//   1. file top level   -> the FILE'S OWN RUST MODULE NAME, which for
//      `use-import-edges.rs` is `use-import-edges` (rust names a file's module
//      after the file stem; `util/mod.rs` is `util` and `src/lib.rs` is the
//      crate). Not `"global"`: css rejected that spelling in exactly this
//      position as "a magic source that names no symbol in any stylesheet".
//   2. inside `mod`     -> that module's name, a real symbol of this file
//   3. inside a fn body -> that function's name, likewise a real symbol
//
// SUPERSEDED (2026-10-19, task-36 defect 3, task-9 conditions): the two paragraphs
// below described the source as "the file's own module name" and the target as the
// full written path. The declared contract the analyzer now implements is (a) the
// family's `(file)` spelling at file scope (the M60/#910 store flag rewrites it to
// the project-relative path) and (b) the MODULE PREFIX as the dependency target,
// with the bound names riding `meta.items` (the group example already worked that
// way). The full written path puts a BINDING in the target; the module prefix is
// the unit the name model and the file claims price. Function-scope `use` is now
// real: its source is the FUNCTION and it never carries fileLevel.
//
// A GROUP is not one edge: `use std::io::{Read, Write as W}` names one module
// (`std::io`) and two bindings, so the edge's `items` carry the bindings and the
// alias resolves to the name the source actually binds (`W`).

use std::collections::HashMap;
use std::io::{Read, Write as W};

pub mod inner {
    use crate::outer::Helper;

    pub fn help() -> Helper {
        Helper
    }
}

pub fn scoped() {
    use std::path::Path;

    let _p = Path::new("x");
    let _m: HashMap<u32, u32> = HashMap::new();
}

pub struct Helper;