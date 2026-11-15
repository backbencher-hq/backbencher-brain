// RUST-MR: a DECLARATION's name is not a read.
//
// Three container shapes were missing from the read sweep's declaration-position
// guards, and each published a `uses` edge for a name that only DECLARES:
//
//   1. a trait method declaration is a `function_signature_item` (no body). The
//      sweep's `isItemNamePosition` listed `function_item` only, so the name
//      fell through — and when it also resolved (a use-imported leaf of the same
//      name) it published a SELF-EDGE, `uses current_dir -> current_dir` at
//      cargo-test-support/src/lib.rs:1477. The IMPLEMENTATION of the same method
//      never did, which is what made the class look like a trait quirk instead
//      of a missing node type.
//   2. a parameter of a FUNCTION-POINTER TYPE declares: there is no body and
//      therefore no per-function bound-name set to exclude it by, so
//      `type Store = extern "C" fn(schema: *const SecretSchema)` published
//      `uses -> schema`.
//
// The IMPLEMENTATIONS and the REAL parameters are the controls: they keep
// publishing exactly what they published before, so the guards cannot be
// "passing" by suppressing reads wholesale.
use helper::current_dir;
use helper::env;
use helper::schema;
use helper::on_stdout_line;

pub const SCHEMA: u32 = 1;

pub trait Builder {
    // (1) declaration: no `uses` for the name below
    fn current_dir<S: AsRef<std::path::Path>>(self, path: S) -> Self;
    fn env<S: AsRef<std::ffi::OsStr>>(self, key: &str, value: S) -> Self;
}

// (2) a fn-pointer type's parameters declare: no `uses` for `schema` below
pub type Callback = extern "C" fn(schema: *const u8, flag: bool);

// (2b) a TRAIT method SIGNATURE's parameter declares as well, and for the same
// reason: there is no body, so no per-function bound-name set exists to exclude
// it. Found at FULL extent, not by the 550-file sample — cargo's
// src/compiler/mod.rs:142 publishes `uses -> on_stdout_line` for this shape.
pub trait Runner {
    fn exec(&self, on_stdout_line: &mut dyn FnMut(&str) -> u32) -> u32;
}

pub struct Real;
impl Builder for Real {
    // the control: a DEFINITION's name is already excluded, and a real
    // parameter still reads (SCHEMA is a file-visible const)
    fn current_dir<S: AsRef<std::path::Path>>(self, _path: S) -> Self {
        let _ = SCHEMA;
        self
    }
    fn env<S: AsRef<std::ffi::OsStr>>(self, _key: &str, _value: S) -> Self {
        self
    }
}
