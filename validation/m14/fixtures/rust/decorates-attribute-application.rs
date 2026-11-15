// decorates-attribute-application.rs — pins rust's `decorates` R3 emission (2026-10-23).
//
// WHY THIS IS decorates AND NOT A RULING: csharp ruled its attributes passive metadata and named
// its falsifier — "a runtime callable-wrapper construct — there is none in the grammar." IN RUST
// THAT FALSIFIER FIRES: `#[tokio::main]` transforms the declaration it is applied to, and
// `#[proc_macro_attribute]` macros take the item and return a replacement. A RULING TRANSFERS
// ONLY WHEN ITS FALSIFIER DOES NOT FIRE IN THE NEW LANGUAGE, so rust implements decorates.
//
// BOTH CLASSES ARE PUBLISHED, split by metadata.attributeKind: "builtin_directive" (the
// compiler's own set — derive, allow, …) and "applied_callable_candidate" (an ecosystem path
// like tokio::main). The causal direction: the edge exists ONLY because the attribute reaches
// the analyzer as a real `attribute_item` node whose next named sibling is the declaration —
// recovery text emits nothing and this expectation fails.
//
// The `#[inline]` on `helper` pins the third builtin; `dead_code` in the allow tree is an
// argument, not a second attribute, so exactly ONE decorates row comes from `allow`.
//
// THE INNER ATTRIBUTE ON THE LINE BELOW PINS THE D1 REFUSAL CLASS: `#![allow(unused)]` decorates
// the MODULE, not a declaration — it must emit ZERO decorates rows and must be COUNTED in
// metadata.unattributedEdges as `decorates:inner_attribute`. The `expectMetadata` pin holds both
// directions: a regression that starts emitting a row for an inner attribute fails the count
// assertions, and one that goes back to dropping it silently fails the metadata pin.

#![allow(unused)]

#[derive(Debug)]
struct Config {
    name: String,
}

#[allow(dead_code)]
fn helper() -> u32 {
    42
}

#[inline]
fn fast() -> u8 {
    1
}

#[tokio::main]
async fn run() {
    let _c = Config { name: String::new() };
    let _ = helper();
    let _ = fast();
}
