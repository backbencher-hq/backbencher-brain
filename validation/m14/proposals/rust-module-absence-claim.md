# PROPOSAL — a module-absence claim for Rust's remaining import buckets (rust lane)

**Author:** Muhammad Ishaq Khan · **Lane:** rust (`rs`) · **Date:** 2026-10-17
**Status:** PROPOSED, NOT IMPLEMENTED. No `src/` change was made for this proposal; the arbiter half is
Lead-owned. **Companion:** `rust-namespace-claim-separator.md` (landed — `std::`/`core::`/`alloc::`).

## 1 · WHAT IS LEFT AFTER THE `::` CLAIM — AND WHAT THIS CLAIM CAN HONESTLY REACH

Cap-400 gate, after iteration 4: `imports unresolved 565` · `extOK 1,095` · `extFAIL 0`. Remaining
unclaimed rows by ROOT (census partition, `RUST-STATE.md` §3, minus the 233 `std::` now claimed):

| bucket | rows | why it is unresolved | reached by `moduleAbsence`? |
|---|---|---|---|
| **multi-segment EXTERNAL roots** (`axum::` 16 · `cargo::` 10 · `cargo_util_terminal::` 5 · `tokio::` 3 · the rest of the 88-row multi-segment external class) | **≈88** | no file answers the path; the root is a crate the workspace does not carry | **YES — this is the only prize** |
| **one-segment external crate names** (`use rand;`, root alone) | **311** | the target is a bare name, not a path | **NO — see §3 rule 2.** A bare name can be a local module OR a workspace member crate; certifying it external needs a CRATE-NAME fact space the arbiter does not have, and certifying only "no local module file" would verify while the edge can still be internal — the python hole. |
| **`crate::` with no module file found** | **101** | analyzer arithmetic (uppercase leaf, inline `mod`, `#[path]`) | **NO — internal by construction.** |
| **`super::` (leaf is an item)** | **34** | same arithmetic | **NO — internal by construction.** |
| bare `crate`/`super`/`self` group rows | **31** | same | **NO — internal by construction.** |

**PRICED CEILING: ≈88 rows** (not 311, and not 480 — the earlier draft of this proposal priced the
one-segment bucket as reachable and that was wrong). Expected movement if landed:
**`imports unresolved 565 → ≈477`, `extOK 1,095 → ≈1,183`, `extFAIL 0`, `arbitraryTwin` byte-identical
at 13,191, fixtures 26/4.** **That is a small prize for a new claim kind, and the proposal says so.**

## 2 · THE HONEST VERDICT: THE BIG PRIZE IS NOT A CLAIM-KIND PROBLEM

* **The 311 one-segment rows need a CRATE-NAME fact space**, not a file claim. The analyzer already
  knows its workspaces' member crate names (`rustWorkspaceCrates`, built and cached), so the ANALYZER
  can decide "this root is no member of my workspace" — but the ARBITER cannot verify a crate-name
  statement: its project facts carry files and symbols, not manifests. A kind it cannot verify sits at
  `ext?` forever — the defect this fleet has already paid for on hcl/json/sql. **Recommendation: either
  the Lead adds a manifest/crate-name fact source shared by rust and python, or those rows stay
  unresolved.** They must NOT be claimed file-absent and called external.
* **The 166 `crate::`/`super::`/bare rows are ANALYZER ARITHMETIC**, this lane's next in-lane work
  (inline `mod`, `#[path]`, uppercase leaves, parents outside the stride). A claim over them would be
  the §5j sound-label-wrong-substance defect: "no file" true, "external" false.
* **The ≈88 multi-segment external rows are the one reachable class**, and they could ride either a new
  `moduleAbsence` kind or an extension of the existing `sourcePath` candidate arithmetic. Given the
  Lead's "not one claim kind per lane", this proposal does not insist on a new kind for 88 rows.

## 3 · THE CLAIM KIND AND PREDICATE (IF THE LEAD WANTS THE ≈88)

**Kind: `moduleAbsence`** (shared with python's package-root class, should it be added).

```jsonc
metadata: { "moduleAbsence": ["crates/foo/src/axum/signal/mod.rs", "…"] }   // candidate PATHS, files or DIRECTORIES
```

**Verification (arbiter, against the project's admitted path set):** verifies iff **none** of the
candidate paths is present in the admitted path set (files **or directories** — python's package root
is a directory and Rust's is `foo/mod.rs`; one predicate covers both). Any admitted candidate refutes.

**Emission rules, each a refusal on failure:**
1. no file claim already (the file claim is stronger and is read first);
2. **multi-segment** target (`::` present) — a bare root is a name, not a module path;
3. root is **not** `crate`/`self`/`super`;
4. root is **workspace-external** (not a member of the importing file's workspace, and not a system
   root — those are the namespace claim's);
5. the candidate set is **enumerable** and the importing file's crate root is locatable;
6. **DISK GUARD: every candidate statted ABSENT.** A candidate present on disk — admitted or not —
   blocks the claim.

## 4 · "NO SUCH FILE" vs "THE INDEX DID NOT SEE THAT FILE" — THE ANSWER

**Do not use `ProjectIndex` for this claim at all.** At the source: the index interface
(`src/ast/project-index.ts:80-112`) has **no file-path space** — it carries `typeKinds`, `typeMembers`,
`typeBases`, `symbolNames`, `damagedFiles`, `stats`, `completion`. Its docstring defines that bit as
*"WHETHER THIS INDEX SAW THE PROJECT'S WHOLE ADMITTED FILE SET — the bit that turns 'the project declares
no such NAME' from a guess into a statement a claim may rest on"*: a **name-space** bit. A Rust module
path is a **file/directory**, exactly python's case (*a package root is a DIRECTORY, not a symbol*), so
that bit is at most necessary and never sufficient here. The distinguishing mechanism is a direct
`stat`: **disk-absent ⇒ admitted-absent**, so a candidate the admission rules exclude cannot be
certified absent (rule 6 refuses), and the arbiter's admitted-path check cannot refute an emitted claim.

## 5 · WHY IT CANNOT REFUTE (`extFAIL 0` by construction, fixed corpus)

Every emitted claim has every candidate statted absent → not admitted → arbiter verifies. Refutation can
only come from CHANGING the corpus (adding the file), which is the claim being falsified — intended.

## 6 · PRE-REGISTERED FALSIFIER

> **Any `extFAIL` on the rows this claim reaches REFUTES the emission rule.**
> **Any reached row that production resolves internally REFUTES rule 6 — the disk guard was bypassed.**
> **The flip test:** add the candidate file and the same row must move
> `externalVerified → externalRefuted` (both states measured and printed, not asserted).

## 7 · WHAT I RECOMMEND

1. **Do not add a claim kind for 88 rows yet.** First land the in-lane arithmetic work for the 166
   internal rows (`crate::`/`super::`/bare) — that is a fix, not a claim, and it is cheaper than an
   arbiter change.
2. **If the one-segment 311 are wanted, the decision is a MANIFEST FACT SOURCE** for the arbiter (crate
   names per workspace), shared with python — a bigger change than this kind, and the only honest route
   to that bucket.
3. **If the Lead still wants the ≈88**, implement `moduleAbsence` exactly as §3-§6 and this lane will
   land the analyzer half, measure `565 → ≈477`, and hand-read ten plus a refusal.
