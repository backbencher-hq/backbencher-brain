// INCOMING_RUST — `overrides`: a trait method an impl block supplies.
//
// Rust has no `override` keyword, and that is a spelling fact rather than a
// semantic one. `impl Greeter for En` supplying `fn greet(&self)` IS the
// implementation of the method `trait Greeter` declares, and it replaces the
// trait's default body wherever the trait declares one. Nothing else in the
// language means override: an inherent `impl En` block overrides nothing, and
// the type-level relation already rides `implements`.
//
// MEASURED before this fixture existed: 48 method implementations of an IN-FILE
// trait across 3 files of the 110-file ripgrep corpus
// (crates/matcher/src/lib.rs 27, crates/searcher/src/sink.rs 18,
// crates/ignore/src/walk.rs 3). Nothing published any of them.
//
// SUPERSEDED CONTRACT (2026-10-19, Lead decision §21.11 via task-9): the paragraph
// below originally required the trait to be DECLARED IN THIS FILE and kept
// `impl Display for Point` silent. That is STALE — the winning `trait-override`
// contract (and the analyzer) emits a foreign/cross-file trait implementation as
// a REAL override at 0.85 with `reasonCode: cross-file-trait-signature`; only the
// IMPLEMENTING side must be a type this file names. The forbids that pinned the
// old silence matched the correct rows; they are replaced by positive
// expectations at the cross-file tier, and the mislabelling negative is preserved
// as a META-CONSTRAINED forbid (never attribute Sink's foreign `Write::flush` to
// the local `Flusher::flush`). The negatives that remain unchanged are the real
// ones: an INHERENT impl overrides nothing, a local item inside a method body is
// not a member, and a GENERIC PARAMETER (`impl<'a, M> … for &'a M`) is not a type.
//
// The two endpoint conditions the rule requires, both exercised below:
//
//   the IMPLEMENTING type must be a type this file names (the old prose said
//   "trait"; superseded above). `impl Display for Point` below therefore emits
//   `Point.fmt` at the cross-file tier. On ripgrep the foreign-trait class is 37
//   of the 85 trait impls the corpus contains and it is now measured, not silent.
//
//   the trait's OWN items only. `nested()` below is a local fn inside a method
//   body whose name matches a trait method; it is not an implementation of
//   anything, and the walk reads the impl block's direct children for that
//   reason.
pub trait Greeter {
    // a DEFAULT body — the impl that supplies this method replaces it
    fn greet(&self) -> String {
        String::from("hello")
    }

    // a BODILESS declaration (`function_signature_item`): still a declaration
    // of the method, and the only kind an impl is REQUIRED to supply
    fn name(&self) -> String;

    // a second DEFAULT body that `En` does NOT override — the local item below
    // borrows this name inside a method body, and nothing may pair them
    fn farewell(&self) -> String {
        String::from("bye")
    }
}

pub struct En;

impl Greeter for En {
    fn greet(&self) -> String {
        // a LOCAL item inside a method body, named like a trait method this impl
        // does NOT override. It is an implementation of nothing: an impl block's
        // own items are its methods, and this one is inside a body.
        fn farewell() -> String {
            String::from("local")
        }
        let _ = farewell();
        String::from("en")
    }

    fn name(&self) -> String {
        String::from("english")
    }
}

// A trait whose only required method is `name`: `greet` has a default, so an
// impl may omit it — and then there is nothing to override for it.
pub struct Fr;

impl Greeter for Fr {
    fn name(&self) -> String {
        String::from("french")
    }
}

// A SECOND trait declared in this file, so the forbid half can prove the rule
// does not pair a method with the wrong trait: `Fr::name` implements
// `Greeter::name`, never `Salut::name`.
pub trait Salut {
    fn name(&self) -> String;
}

// The trait is declared HERE, so this impl DOES override.
pub struct De;

impl Salut for De {
    fn name(&self) -> String {
        String::from("deutsch")
    }
}

// The trait is NOT declared in this file: silence, not a hopeful target.
pub struct Point {
    pub x: i32,
    pub y: i32,
}

impl std::fmt::Display for Point {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(f, "({}, {})", self.x, self.y)
    }
}

// An INHERENT impl block overrides nothing, even when the method name matches a
// trait's.
pub struct Counter {
    n: u32,
}

impl Counter {
    fn name(&self) -> String {
        String::from("counter")
    }

    fn bump(&mut self) {
        self.n += 1;
    }
}

// THE GENERIC-PARAMETER CASE — the second endpoint condition. This impl really
// does supply `Greeter::name`, but the type it supplies it FOR is one caller's
// reference to whatever `M` is bound to, and this file has no name for that:
// `M` is a locally bound parameter, not a type. Publishing `M.name ->
// Greeter.name` would name a type parameter as a type, so the rule reads the
// impl block's own `type_parameters` node and stays silent. (ripgrep has 32 such
// sites in 3 files — `impl<'a, M: Matcher> Matcher for &'a M` and its kin — and
// they are the majority of the corpus's in-file trait impls.)
pub struct Ref<M> {
    inner: M,
}

impl<'a, M: Greeter> Greeter for &'a M {
    fn name(&self) -> String {
        String::from("referent")
    }
}

// THE MISLABELLING CASE. Two traits in this file — one declared here, one not —
// and a foreign impl whose method name matches the DECLARED trait's. Rust pairs
// it with `std::io::Write`, so the only correct outcome is silence; a rule that
// falls back to "the first trait declared in the file" publishes
// `Sink.flush -> Flusher.flush`, which is a confident edge naming a relation the
// code does not have.
pub trait Flusher {
    fn flush(&self) -> u32;
}

pub struct Sink {
    written: Vec<u8>,
}

impl std::io::Write for Sink {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.written.extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}