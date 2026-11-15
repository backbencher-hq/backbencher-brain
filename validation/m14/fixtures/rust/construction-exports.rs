pub struct Point {
    x: i32,
}

impl Point {
    pub fn new() -> Self {
        Self { x: 1 }
    }

    pub fn origin() -> Point {
        Point { x: 0 }
    }

    pub fn clone_it() -> Self {
        Self::new()
    }
}

// R14 (extreme review): bare `Self(..)` tuple construction resolves to the
// enclosing impl type too (the cargo str_newtype pattern: `Self(name)`
// inside `impl RegistryName` constructs RegistryName, not noise).
pub struct Wrap(i32);

impl Wrap {
    pub fn wrap(v: i32) -> Self {
        Self(v)
    }
}

pub(crate) fn internal() {}

mod m {
    pub struct Hidden;
    pub use std::io::Read;
}

pub mod n {
    pub fn f() {}
}

// RUST-D30: a BARE PascalCase callee is ambiguous against the prelude. With a local
// `struct Ok;` in the same file, `Ok(())` — which is the PRELUDE's variant — was
// resolved to that struct by the in-file filter and published `instantiates -> Ok`:
// an edge created by a name collision, naming a type the source never mentions. A
// construction resolves to a local type only when the receiver is SPELLED as that
// type. `Self(..)` is exempt because it is a keyword with exactly one meaning, and
// the two rows below are the ones a too-broad version of this rule would lose.
struct Ok;

fn uses_prelude_ok() -> Result<(), String> {
    Ok(())
}

struct Spelled;
fn constructs_spelled() {
    let _ = Spelled { a: 1 };
}
