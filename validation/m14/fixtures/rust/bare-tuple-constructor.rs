// INCOMING_RUST — the bare TUPLE-SHAPE CONSTRUCTOR, which is decidable from one
// file, and the module scoping that decides the ambiguous half of it.
//
// RUST-D30 banned every bare single-segment callee from `instantiates` because
// `Ok(())` is the PRELUDE's variant whatever a local `struct Ok` is called. The
// ban deleted real constructions with it: ripgrep's
// `crates/globset/src/fnv.rs:15` calls `Hasher(Hasher::OFFSET_BASIS)` three
// lines below `struct Hasher(u64)`, and published `calls` and nothing else.
//
// What replaced it is not a list of prelude spellings — measured over the
// 110-file corpus, 0 of the 1,175 bare PascalCase callee sites are both a
// prelude spelling and an in-file tuple shape, so no list is load-bearing — but
// three conditions that can each be checked: the callee must name a TUPLE shape
// this file declares (a unit struct is constructed by naming it, a named-field
// struct by `Foo { .. }`), and that declaration must be VISIBLE where the call
// is written.
//
// The visibility half is the load-bearing one and it is what makes the collision
// decidable instead of merely forbidden. Rust modules scope their own items, so:
//
//   `Ok(7)` INSIDE the module that declares `struct Ok(u32)` is that tuple
//   struct — the local item shadows the prelude in its own module — and the
//   construction is publishable. `Ok(1u32)` in ANOTHER module of the same file
//   is the prelude's `Result::Ok`, and the same one-line rule is what keeps it
//   silent. No name list distinguishes those two; module scope does.
pub mod makers {
    // A tuple struct whose name is a prelude spelling, in a module of its own.
    pub struct Ok(u32);

    // DECIDABLE and CORRECT: inside `makers`, `Ok` is the local tuple struct.
    pub fn build() -> Ok {
        Ok(7)
    }
}

// PRELUDE, in a module where `makers::Ok` is not in scope: silent.
pub fn prelude_side() -> Result<u32, u32> {
    Ok(1u32)
}

// The ordinary decidable case, at file scope.
pub struct Hasher(u64);

impl Hasher {
    pub const OFFSET_BASIS: u64 = 0xcbf29ce484222325;

    pub fn seeded() -> Hasher {
        Hasher(Hasher::OFFSET_BASIS)
    }

    pub fn mixed() -> u64 {
        // A call to a tuple shape through a path, and the receiver's own type
        // referenced by name — both spelled, both decidable.
        let other: Hasher = Hasher::default_ish();
        other.0
    }

    fn default_ish() -> Hasher {
        Hasher(7)
    }
}

pub enum Kind {
    Unit,
    Tuple(u32),
    Named { n: u32 },
}

pub struct Unit;

pub fn PascalFn() -> u32 { 7 }

pub fn shapes() -> u32 {
    // The unit VARIANT of an in-file enum: no parentheses, nothing constructed.
    let _u = Kind::Unit;
    // A TUPLE variant through a path — the construction target is the VARIANT,
    // and the family contract makes that a `calls`, not an `instantiates`.
    let a = Kind::Tuple(3);
    // A FOREIGN callee: a bare name this file does not declare at all.
    let b = Foreign::make();
    // A same-named free FUNCTION is not a type.
    let c = PascalFn();
    // A UNIT STRUCT is constructed by naming it, never by calling it — and the
    // forbid half pins that the rule keys on the SHAPE, not on the kind.
    let d = Unit;
    a.0 + b + c + match d { _ => 0 }
}