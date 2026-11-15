// #612 store-phase: DECLARATION vs DEFINITION for rust.
//
// The grammar already told the analyzer which is which — a `function_item`
// carries a body, a `function_signature_item` does not — but only the node type
// was used (for scope); nothing was published. Both forms emitted an
// indistinguishable `function` symbol, so an `extern "C"` declaration could win
// name resolution against the definition implementing it elsewhere.
//
// Two declaration forms and one definition, so the fixture fails whether the
// flag is missing or applied to everything:
//   ffi_decl   — `extern "C" { fn ffi_decl(); }`: DECLARATION
//   sig_only   — a trait method signature, no body: DECLARATION
//   body_fn    — a free function with a body: DEFINITION

extern "C" {
    fn ffi_decl() -> i32;
}

pub trait Runnable {
    fn sig_only(&self) -> i32;
}

pub fn body_fn() -> i32 {
    7
}
