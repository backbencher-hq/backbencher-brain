// RSD2 regression pin: a parse error ANYWHERE in the file previously wiped
// the qualified_calls payload from EVERY function in that file (the old
// whole-file `!metadata.errors` guard). clean_caller sits in a file with a
// broken sibling fn — its payload must still contain `helper`.
pub fn clean_caller() -> u32 {
    helper() + 1
}

fn helper() -> u32 {
    2
}

// Deliberately broken: missing type after `:` produces a parse ERROR node.
pub fn broken() -> u32 {
    let x: = 1;
    x
}
