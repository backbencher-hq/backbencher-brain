// fixture: rust/callsite-lines-825 — M59 (#825).
// A relationship's line_number is the line of the node that NAMES it, never the
// line of the construct that contains it. Rust emitted NO line at all before this
// pin (0 of 65,390 edges on a 200-file draw of cargo+ripgrep), so the pre-fix
// state is "unlined". Every trap below is valid Rust, each is the site of a REAL
// edge, and each is a place where a construct-start line is a line too early:
//
//   1. a CALL CHAIN BROKEN BEFORE THE DOT — `repo` + newline + `.find(1)` parses
//      (a `field_expression` starts at its VALUE, the callee leaf is the field);
//   2. the same shape as a plain FIELD ACCESS (`self` + newline + `.items`);
//   3. WRAPPED SUPERTRAIT BOUNDS — the `trait` keyword line is not where the
//      bound is written;
//   4. a WRAPPED TRAIT REFERENCE in an impl header — the edge NAMES the trait,
//      which is written on its own line after `impl`;
//   5. a `Self`-returning constructor: the target is the enclosing type, which is
//      written only as the keyword `Self` on the signature's line.
pub trait Repository
{
    fn find(&self, id: u32) -> u32;
}

pub trait Service:
    Repository
    + Clone
{
    fn name(&self) -> String;
}

pub struct Repo {
    items: Vec<u32>,
}

impl Repository for Repo {
    fn find(&self, id: u32) -> u32 {
        id
    }
}

impl
    Repository
    for Repo
{
    fn extra(&self) -> u32 {
        0
    }
}

impl Repo {
    pub fn new() -> Self {
        Repo { items: Vec::new() }
    }

    fn first(&self) -> u32 {
        let n = self
            .items
            .len();
        n
    }

    fn read(&self, repo: &Repo) -> u32 {
        let n = repo
            .find(1);
        n
    }
}
