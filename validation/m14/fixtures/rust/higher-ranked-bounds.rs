// RUST-MR: a HIGHER-RANKED trait bound is still a bound.
//
// `for<'de> Deserialize<'de>` — the lifetime-generic supertrait idiom, used
// wherever a trait's implementations are parameterized by a lifetime. The
// grammar wraps the bound TYPE in a `higher_ranked_trait_bound` node, so the
// supertrait extraction's direct-child test never saw it: the bound was named by
// the source and published by nobody. serde's own
// `pub trait DeserializeOwned: for<'de> Deserialize<'de> {}` produced an
// `extends` edge for nothing.
//
// The F5 oracle had the mirror-image bug on the same construct — it read the
// BINDER's text and fabricated `extends -> "for"`, a bound no source line
// names — so both sides were wrong in opposite directions. That is why the row
// surfaced as one MISSING and the real supertrait was invisible on both sides.
// The forbid row pins the fabrication's absence, which is the half that can
// only be asserted negatively.
pub trait DeserializeOwned: for<'de> Deserialize<'de> {}

// the ordinary bound, unchanged: one `extends` per supertrait, on the bound's
// own line
pub trait Plain: Sized + Clone {}

// two bounds, one of them higher-ranked: BOTH must publish, neither may
// collapse into the other
pub trait Mixed: for<'a> AsRef<'a> + Clone {}

// a `where`-clause higher-ranked bound is a WHERE bound (R8's surface), not a
// supertrait — it must not become an `extends`
pub trait ViaWhere
where
    for<'a> FnOnce(&'a u8) -> u8,
{
}
