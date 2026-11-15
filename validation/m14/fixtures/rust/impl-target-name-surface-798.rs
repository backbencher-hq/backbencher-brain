// R10 (M60 standing rule, rust #798) — the impl-target NAME surface.
//
// An impl symbol is named after the type it implements, and a
// reference/pointer/parenthesized wrapper does not change what that type is
// NAMED. The pre-fix rule took `typeNode.text` verbatim, so for a wrapped type
// it published SOURCE TEXT as a name — on the impl symbol, on the `implements`
// edge's source and (through `Self`) on every `references` target inside the
// block. The M60 target-spelling census convicted rust for exactly this (6
// `references` targets over 2 files: `&mut ProcessBuilder` x5, `&mut Execs`
// x1), and the differential could never see it because its truth derives from
// the same rule — both sides spelled the fabrication identically.
//
// Five shapes, each paired with the PRE-FIX spelling it must refuse:
//   (a) `&mut ProcessBuilder`  a WRAPPED nominal type -> the impl is named
//                              `ProcessBuilder` (the type), not the wrapper
//   (b) `&'static str`         a wrapped primitive   -> `str`
//   (c) `std::io::Error`       a QUALIFIED type      -> the symbol keeps its
//                              qualification (`std::io::Error`), while `Self`
//                              resolves to the LEAF (`Error`), because a
//                              `references` TARGET is a leaf (#419-B). This
//                              asymmetry is pre-existing and deliberate: the
//                              deferred constructor filter reads in-file SYMBOL
//                              names, so flattening a foreign `io::Error` to
//                              `Error` would make `Error::new()` look local.
//   (e) `Self(0)`              a constructor called through the KEYWORD `Self`
//                              -> the callee's name is the ENCLOSING impl
//                              type's (`Wrap`), and `Self` is never published
//                              as a target on any surface. Found by the F14
//                              gate when it was extended to rust: `calls ->
//                              Self` was the one place the literal survived
//                              (6 rows on cargo from `Ok(Self(name))` in
//                              cargo-util-schemas/src/manifest/mod.rs).
//   (d) `[u8]` and `(T, U)`    types with NO nominal name -> the impl block is
//                              published under the family's declared synthetic
//                              `anonymous_impl` with the source spelling kept
//                              in `metadata.implementedType`, and `Self`
//                              resolves to ABSENCE (R7: the honest state is
//                              absence, not a placeholder). A synthetic NAME
//                              is never substituted for the type when a
//                              TARGET is asked for.
pub struct ProcessBuilder;

pub trait ChannelChangerCommandExt {
    fn env(&self) -> Self;
}

impl ChannelChangerCommandExt for &mut ProcessBuilder {
    fn env(&self) -> Self {
        todo!()
    }
}

pub trait IntoUrl {
    fn into_url(&self) -> Self;
}

impl IntoUrl for &'static str {
    fn into_url(&self) -> Self {
        todo!()
    }
}

pub trait MyFrom {
    fn my_from(&self) -> Self;
}

impl MyFrom for std::io::Error {
    fn my_from(&self) -> Self {
        todo!()
    }
}

pub trait ToTupleId {
    fn to_tuple_id(&self) -> &Self;
}

impl<T: Clone, U: Clone> ToTupleId for (T, U) {
    fn to_tuple_id(&self) -> &Self {
        self
    }
}

pub trait ToSliceId {
    fn to_slice_id(&self) -> &Self;
}

impl ToSliceId for [u8] {
    fn to_slice_id(&self) -> &Self {
        self
    }
}

pub struct Wrap(pub u32);

pub trait WrapNew {
    fn wrap_new() -> Self;
}

impl WrapNew for Wrap {
    fn wrap_new() -> Self {
        Self(0)
    }
}
