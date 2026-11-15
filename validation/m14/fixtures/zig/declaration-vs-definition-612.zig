// #612 store-phase: DECLARATION vs DEFINITION for zig.
//
// This grammar parses `extern fn f() c_int;` and `pub fn g() c_int { ... }`
// as the SAME node type (`function_declaration`) — measured with a tree dump on
// 2026-09-25. The body is the discriminator: a `block` child means definition,
// its absence means declaration. The walk already used that to decide scope;
// without publishing it, the `extern` form was indistinguishable from the
// definition implementing it in another file.
//
//   ffi_decl  — `extern fn`, no body: DECLARATION
//   body_fn   — a `pub fn` with a body: DEFINITION
//   Sig.call  — a method with a body: DEFINITION (the flag must not leak to
//               bodies just because they are container members)

extern fn ffi_decl() c_int;

pub fn body_fn() c_int {
    return 0;
}

const Sig = struct {
    pub fn call(self: *const Sig) c_int {
        return 1;
    }
};
