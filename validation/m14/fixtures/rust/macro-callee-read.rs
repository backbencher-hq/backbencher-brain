// RUST-MR: a macro INVOCATION's NAME is a callee.
//
// `bail!("…")` names a macro. The lane already publishes `calls -> bail` for it
// (RUST-D2), and R1's read contract explicitly excludes callees — a call's
// `function` field is skipped by a span-matched guard, and a macro name is the
// same position in the same grammar. Before the fix the read sweep had no such
// guard for `macro_invocation`, so a USE-IMPORTED macro published TWO edges for
// one name at one line: `calls -> bail` AND `uses -> bail`.
//
// The function control matters: an imported FUNCTION called by name publishes
// `calls` only, because the callee guard already covered `call_expression`. So
// the asymmetry was the macro shape alone, and the F5 `uses` oracle mirrored it
// (its only macro rule skips identifiers under a macro DEFINITION, stopping at
// `macro_invocation`), which is why the differential could not see it — both
// sides agreed on the fabrication.
use anyhow::bail;
use helper::do_thing;

pub fn go(n: usize) -> usize {
    // an imported FUNCTION invoked by name: `calls` only, before and after
    do_thing(n);
    // an imported MACRO invoked by name: `calls` only, after the fix
    let v = match n {
        0 => bail!("zero"),
        other => other,
    };
    v
}

// The macro's ARGUMENTS are genuine reads and must KEEP publishing `uses` —
// the guard is for the invocation's NAME, not its arguments. `LIMIT` is a
// file-visible const, so the read is resolvable and the edge is owed.
pub const LIMIT: usize = 3;

pub fn arg_reads(items: &[usize]) -> usize {
    let total = sum_all!(items, LIMIT);
    total
}
