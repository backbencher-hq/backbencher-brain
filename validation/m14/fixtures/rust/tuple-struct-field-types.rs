// R14 (rust review #798, ripgrep full extent): a TUPLE struct's field types
// emit `references`. `struct Foo(Bar);` declares a field of type Bar exactly as
// `struct Foo { b: Bar }` does, but it has no `field_declaration` child — its
// fields sit in an `ordered_field_declaration_list`, and only the ENUM branch
// walked that. Measured before the fix on the ripgrep full extent: 13 missing
// `references` edges over 10 files, every one a tuple struct
// (`pub struct StandardStream(StandardStreamKind);`,
// `struct LiteralStrategy(fnv::HashMap<..>);`).
//
// Authored from the contract BEFORE the analyzer run: the single-field tuple
// struct, the multi-field one with per-field visibility, a scoped path, a
// generic argument (outer AND inner leaves), the generic-parameter EXCLUSION
// (`struct Generic<T>(T, ...)` must not reference T — locally bound, the R8
// rule), a union with tuple fields, and a UNIT struct that declares nothing.
pub struct Inner {
    n: u32,
}

pub struct Wrapped(Inner);

pub struct Pair(pub Inner, pub Vec<Inner>);

pub struct Scoped(modu::Inner);

pub struct Generic<T>(T, Inner);

pub union Either {
    a: Inner,
    b: u32,
}

pub struct Unit;

impl Wrapped {
    fn get(&self) -> Inner {
        self.0
    }
}
