# PROPOSAL — a `::`-aware `languageNamespace` claim matcher (rust lane)

**Author:** Muhammad Ishaq Khan · **Lane:** rust (`rs`) · **Date:** 2026-10-17
**Owner of the change:** the Lead (`script/m14/incoming-rule.ts` is SHARED; this lane does not edit it)
**Status:** **ADOPTED AND MEASURED (2026-10-17).** The Lead landed the `::` segment split in
`incoming-rule.ts` (ROUND 3), and the lane emits `metadata.languageNamespace` for `std::`/`core::`/
`alloc::` import paths (see `RUST-STATE.md` §10). Measured at cap 400: **234 claims emitted
(`std` 233 · `core` 1), 234 verified, 0 refuted**, imports unresolved **799 → 565**, imports extOK
**861 → 1,095**, TOTAL unresolved **22,776 → 22,542**, `resolved`/`ambiguous`/`arbitraryTwin`
byte-identical, fixtures 26/4 unchanged. Whole population (2,532 files): imports 11,703 edges /
5,879 extOK / **0 extFAIL**. The pre-registered falsifier did NOT fire. The rest of this file is kept
as the record of what was proposed and why — the acceptance table in §2 is the ruling the Lead used.

---

## 1 · What is blocked, measured

The arbiter already has the one claim kind whose authority is the analyzer's own declared list and
**never the project's declaration table**: `languageNamespace` (`NAMESPACE_CLAIM_KEY`,
`namespaceMatchOf` in `script/m14/incoming-rule.ts`). Its four properties are exactly the shape the
rust residual needs — it is refutable by construction (a root the analyzer did not declare reads
`externalRefuted`), it can never refute a name the project declares, and it is cross-tabbed with
every other claim (`extOK` / `extFAIL`).

It cannot reach Rust because its matcher splits the target on `.` only:

```ts
export function namespaceRootOf(tgt: string): string {
  const dot = tgt.indexOf(".")
  return (dot > 0 ? tgt.slice(0, dot) : tgt).trim()
}
export function namespaceMatchOf(tgt: string, roots: readonly string[]): string | null {
  const segs = tgt.split(".")
  …
}
```

Rust spells paths with `::`. On the cap-400 gate population the claim would reach:

| class | unresolved rows | target shape | reachable by the claim? |
| --- | --- | --- | --- |
| `imports` with a `std::`/`core::`/`alloc::` root | **233** | `std::fs`, `std::io`, `core::fmt`, … | YES — the target IS a path |
| `calls` whose receiver is a std path (`std::fs::read()`) | (part of the 13,423 qualified-call bucket) | target = **bare leaf** (`read`), the path lives in `metadata.qualified` | NO — a claim is read against the edge's TARGET |

Source of the 233: `validation/m14/fixtures/rust/import-claim-census-after3.txt` — the residual table
after the file claim landed (`std::` 233 unresolved and unclaimed). The 233 are the concrete prize;
the larger std/prelude share of `calls` is **not** claimed by this mechanism and §4 says why.

## 2 · The proposed matcher change (one function, additive)

Treat BOTH separators as segment boundaries, so a multi-segment entry matches on the target's
leading segments exactly as the protobuf adoption already requires, and a single-segment entry
keeps the hcl behaviour:

```ts
/** Split a target into namespace SEGMENTS: `.` (dotted languages) and `::` (rust). */
export function namespaceSegmentsOf(tgt: string): string[] {
  return tgt.split(/::|\./).filter((s) => s.length > 0)
}
export function namespaceRootOf(tgt: string): string {
  return namespaceSegmentsOf(tgt)[0] ?? ""
}
export function namespaceMatchOf(tgt: string, roots: readonly string[]): string | null {
  if (tgt.length === 0 || roots.length === 0) return null
  const segs = namespaceSegmentsOf(tgt)
  for (let n = segs.length; n >= 1; n--) {
    const cand = segs.slice(0, n).join(".")   // entries are canonicalised with dots
    if (roots.includes(cand.replace(/::/g, "."))) return cand
  }
  return null
}
```

Entry canonicalisation must be decided by the Lead (either normalise entries the same way, or have
`externalClaimOf` normalise the roots array). The worked cases the change must keep:

| entry | target | verdict |
| --- | --- | --- |
| `count` | `count.index` | match (unchanged, hcl) |
| `count` | `counter.x` | no match (boundary, not prefix text — unchanged) |
| `google.protobuf` | `google.protobuf.Timestamp` | match (unchanged, protobuf) |
| `google.protobuf` | `google.api.Annotations` | no match (unchanged) |
| **`std`** | **`std::fs`** | **match (new)** |
| **`std`** | **`stdx::fs`** | **no match (new — boundary, not prefix)** |
| **`std::fs`** | **`std::fs::read`** | **match (new, multi-segment)** |
| **`std`** | **`standard::x`** | **no match (new)** |

The change is additive for every existing adopter: no lane emits `::` today except rust, the dotted
matcher is unchanged for dotted targets, and an entry without `::` behaves identically when the
target has no `::`.

## 3 · The analyzer half (this lane, after the matcher lands)

In `handleUseDeclaration`, when the `imports` target's root is `std`, `core` or `alloc`, attach:

```ts
metadata: {
  …,
  languageNamespace: ["std"],   // or ["core"], ["alloc"] — the root the target actually starts with
}
```

**Expected measured effect:** imports unresolved 863 → **630**, `extOK` 797 → **1,030**, `extFAIL`
stays **0**. Derivation: exactly 233 unresolved rows have a `std::` target and none has a
`core::`/`alloc::` root in this sample (census table); the claim replaces the file claim on those
rows (they carry none today — the file claim refuses `std` roots).

**Why a refutation is impossible from this lane's own emissions:** the claim is attached ONLY when
the target's first segment is one of `std`, `core`, `alloc`, and the roots list is exactly those
three. `std` cannot name a project declaration (a project cannot declare a crate named `std`), and
the matcher consults the list, not the key space. A refutation would mean the list and the emitted
root disagreed — i.e., a bug the 233-row arithmetic would show immediately.

**Falsifier (pre-registered):** after the matcher lands, `bun run script/m14/incoming-gate.ts rust
rs 400` must read `imports extOK +233`, `extFAIL 0`, resolved/amb/arbitraryTwin byte-identical. Any
`extFAIL > 0` on those rows refutes the emission rule, not the matcher.

## 4 · What this does NOT claim, and why the alternative was refused

* **The std/prelude share of `calls` (the largest residual) is NOT reachable this way.** A call edge
  publishes the BARE LEAF as its target (`read`, `clone`, `fmt`); the path is only in
  `metadata.qualified`, and the arbiter reads the claim against the target. A list that declared
  `read`/`clone` as "namespaces" would be verified for every name it lists and refutable only by
  omitting the name the analyzer chose to list — the vacuous claim `RUST-FIX.md` §9 refused when the
  `owner` marker showed `claimOK 22,590 · claimFAIL 0` for the same reason.
* **Re-spelling std call targets to full paths was priced and REFUSED.** It would move existing
  resolved/ambiguous edges whose bare leaf collides with a project name into `unresolved` (the gate's
  resolved count would FALL), change fixture pins, and hand production a target no declaration can
  answer. It buys the claim only at the cost of the two axes this lane is measured on.
* **External crates (`serde`, `axum`, …) stay unresolved.** No project file names them, and no list
  of crates.io names is evidence the project carries them. Their honest state is the residual.

## 5 · What the Lead needs to decide

1. Adopt the segment split (or an equivalent) in `namespaceMatchOf` / `namespaceRootOf`, with the
   worked cases in §2 as the acceptance rows.
2. Decide whether entries are canonicalised with dots (recommended: canonicalise both sides, so a
   lane writes the spelling its language uses).
3. Return the ruling; this lane will emit the claim, re-measure the 233, and re-run the census
   control (`import-claim-census.mts`) so the number is checked per row, not net.
