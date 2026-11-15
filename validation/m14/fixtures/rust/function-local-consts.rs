// RUST-MR: a function-local `const`/`static` is a DECLARATION; a function-local
// `let` is not.
//
// The extraction guard that skips declarations inside a function body covered
// `let_declaration`, `const_item` AND `static_item` — while its own comment says
// "function-local `let` bindings are execution artifacts", which is the only one
// of the three the rule is true for. A local `const`/`static` names a value with
// a type, an initializer and a line, and is published everywhere else: the guard
// was the only thing between the form and the graph. Corpus census: 43
// function-local `const` and 22 function-local `static` at 0% coverage, against
// 200/200 module-level `const` and 15/15 associated ones — so the spec's
// `handled_verified` claim for both node types was false at the site level.
//
// `let` is the control and keeps its skip: a local binding declares nothing
// outside its body (M11.11's closure boundary), so publishing one would be noise.
pub struct Thing;

pub const TOP: u32 = 7;

impl Thing {
    pub const INNER: u64 = 3;

    pub fn m(&self) -> u64 {
        const LOCAL: u64 = 42;
        static CACHED: u64 = 9;
        let bound = 1;
        LOCAL + CACHED + bound + Thing::INNER
    }
}
