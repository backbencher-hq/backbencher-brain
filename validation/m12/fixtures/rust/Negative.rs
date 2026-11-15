// validation/m12/fixtures/rust/Negative.rs
// M12.18 Rust negative fixture: function-local let bindings are NOT symbols;
// primitive types and generic parameters produce NO type-reference edges;
// closures and their parameters are NOT symbols; macro invocations are call
// edges to the macro name only (no symbol); lifetimes are not symbols;
// field access on a local variable is still a uses edge.
use std::fmt::Debug;

pub fn normalize<'a, T: Debug + Clone>(items: &'a [T]) -> Vec<T> {
    let mut result: Vec<T> = Vec::new();
    for item in items {
        let doubled = item.clone();
        if doubled != item {
            result.push(doubled);
        }
    }
    println!("normalized {} items", result.len());
    result
}

pub fn compute(input: i32) -> i32 {
    let local = input * 2; // function-local — NO symbol
    let tuple = (local, "label"); // function-local — NO symbol
    local + tuple.0
}

struct ForwardOnly; // NOT forward-declared here; struct with no fields is a
                    // unit struct — a real declaration (one symbol)
