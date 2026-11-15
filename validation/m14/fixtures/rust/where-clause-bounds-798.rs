// R16 (rust review #798, cargo full extent): three holes in R8's own words —
// "a bound that names one of the enclosing generic parameters is locally bound".
//
//   (a) `function_signature_item` (a TRAIT method declaration, no body) was not
//       in the item list, so the climb skipped the signature and stopped at the
//       trait — whose type_parameters are the TRAIT's. `try_borrow_with`'s own
//       `<F, E>` were therefore invisible and `where F: ...` emitted
//       `references -> F` (cargo: once.rs, paths.rs, package_id_spec.rs).
//   (b) the climb took the FIRST enclosing item and STOPPED, so a bound naming
//       an OUTER parameter (`impl<N, E> Graph<N, E>` with `where N: Borrow<Q>`
//       on a method) was read as a file type (cargo: src/util/graph.rs).
//   (c) the bounded side published RAW TEXT, so a scoped path became a target no
//       consumer can resolve — here `where anyhow::Error: From<E>` published the
//       MODULE `anyhow` (cargo: src/compiler/job_queue/mod.rs) instead of the
//       NAME `Error`, i.e. the c/cpp #924 name-surface class.
//
// `String: PartialEq` is the CONTROL: a real path bound that is not locally
// bound still emits, exactly as relationship-kinds pins it.
use std::borrow::Borrow;

trait Try {
    fn try_borrow_with<F, E>(&self, f: F) -> Result<u32, E>
    where
        F: FnOnce() -> Result<u32, E>;
}

struct Graph<N, E> {
    node: N,
    edge: E,
}

impl<N, E> Graph<N, E> {
    fn bound<Q>(&self, q: Q) -> u32
    where
        N: Borrow<Q>,
        String: PartialEq,
    {
        let _ = q;
        0
    }
}

fn parse<E>(raw: &str) -> u32
where
    anyhow::Error: From<E>,
{
    let _ = raw;
    0
}
