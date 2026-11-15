# PHP — ORACLE PATCH PROPOSAL for `mixes_in` and `part_of` (Lead applies)

**From the php lane, 2026-10-23. The analyzer half is landed and pinned; these three hunks are the
arbiter half, which is the Lead's file. The lane does not edit `script/m14/differential.ts`.**

## What the analyzer now emits (already committed, lane-owned)

Two 1:1 RELABELS at rung **R3, no grammar change** — the shape the fleet already publishes for
ruby's include/extend/prepend and javascript's call-shaped heritage:

| construct | was | now | row shape (all preserved) |
|---|---|---|---|
| trait composition `class C { use T; }` (`src/ast/real-php-analyzer.ts`, `use_declaration` branch) | `uses` | **`mixes_in`** | source = composing type, target = trait leaf, confidence 1.0, line = trait name, `metadata.isTraitUse`, evidenceClass **structural** (the tier follows the construct — ruby's RUBY-D1 precedent) |
| `include`/`require`/`include_once`/`require_once` (`emitInclude`) | `imports` | **`part_of`** | source = `global` (file scope), target = the include path, confidence 0.9, line = directive, `metadata.partRole: "library"` (MANDATORY, contract types.ts:178-183), `metadata.relationshipType: "include_path"`, `metadata.includeType` = which of the four directives, evidenceClass **import_based** (fsharp's `#load` precedent) |

The `ImportInfo` directive list is still pushed for includes (it is not a relationship; it is the
parsed directive list persisted into `brain_import`), and the include file claim
(`metadata.importProjectFile`, measured verify 145 / REFUTE 0 on the old arm) is still attached:
`claimResolvableIncludes` now accepts `PartOf` as well as `Imports`, because the claim pass is
about the WRITTEN CONSTRUCT (`metadata.relationshipType`), not the stored label.

## The patch — THREE hunks in `script/m14/differential.ts`

### Hunk 1 — the oracle's trait-use truth (`derivePhpEdges`, ~`13831`)

```ts
      // Trait use inside a class body
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && (c.type === "name" || c.type === "qualified_name")) push("uses", leafName(c.text))
      }
```

→

```ts
      // Trait use inside a class body — `mixes_in` since the 2026-10-23 R3 relabel (the analyzer's
      // `use_declaration` branch). The oracle must move WITH the analyzer or every composition row
      // reads unexplained; this is the same 1:1 relabel ruby's include/extend/prepend took.
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && (c.type === "name" || c.type === "qualified_name")) push("mixes_in", leafName(c.text))
      }
```

### Hunk 2 — the oracle's include truth (`derivePhpEdges`, ~`13888`)

```ts
      const p = extractPhpIncludePath(n)
      if (p) push("imports", p)
```

→

```ts
      const p = extractPhpIncludePath(n)
      // `part_of` since the 2026-10-23 R3 relabel (the analyzer's `emitInclude`): the target is a
      // PATH, the directive is written by the file that includes the part, and no module binding is
      // created. `push` keys on (label, target); the path rule itself (`extractPhpIncludePath`,
      // shared with the analyzer) is unchanged, so the spelling contract this oracle already
      // enforces — six static shapes, four refused — does not move.
      if (p) push("part_of", p)
```

### Hunk 3 — admit the two labels to php's compared set (the allowlist chain, ~`25360`)

Insert immediately after the existing php `exports` entry:

```ts
          ...(lang === "php" ? ["exports"] : []),
```

→

```ts
          ...(lang === "php" ? ["exports"] : []),
          // 2026-10-23: `mixes_in` and `part_of` join php's compared set, in the same change as
          // the truth derivation above. Both halves are required and neither is optional — this
          // file's own rule, stated three times: an oracle with no entry compares nothing, and an
          // entry with no oracle turns every analyzer row into a fabrication. Until this lands the
          // two labels are stored, compared against nothing, which is the DERIVATION debt
          // `rel-type-coverage-gate` charges.
          ...(lang === "php" ? ["mixes_in", "part_of"] : []),
```

## Why there is NO red window between the analyzer commit and this patch

The compared-label allowlist filters the ANALYZER side too (the file records that failure in five
different languages). So today php's `mixes_in`/`part_of` rows are dropped before the comparison
and the truth is not derived — the differential reads CLEAN and BLIND on these two labels. The
moment all three hunks land, both sides are live at once. That is why the patch can be applied at
the Lead's convenience without an intermediate failing state, and why applying only hunks 1–2 (or
only hunk 3) WOULD create one: hunk 3 without 1–2 reads every analyzer row as unexplained; 1–2
without 3 is silently blind.

## What the patched comparison must show (the falsifier)

`derivePhpEdges` must produce, for the two labels:

- `mixes_in`: one truth row per direct `name`/`qualified_name` child of a `use_declaration` whose
  PARENT is a class/interface/trait/enum body — target = `leafName(child.text)`, matching the
  analyzer's rows exactly (the analyzer emits source = owning type; the differential compares
  (label, target) per the file's site-agnostic match, so the leaf spelling is what must agree).
- `part_of`: one truth row per static include path from `extractPhpIncludePath` — the analyzer's
  own function, already shared, so the spelling cannot drift.

FALSIFIER: over the whole admitted population (`BB_CORPUS_ROOT=$PWD/.corpus`, 6,424 admitted
files), the php differential must read **0 missing and 0 unexplained for both labels**. A
non-zero `unexplained mixes_in` means an analyzer edge the oracle does not derive (a shape the
oracle misses); a non-zero `missing part_of` means the oracle derives a row the analyzer does not
emit. Either one is a real finding and reopens the relabel's completeness — it does not get
counted as a tie-break.

## Two things the Lead should expect when running the fleet instruments after the patch

1. `bun script/m14/verify-oracle-coverage.ts` will report php's compared set GAINED two labels.
   That is the improvement note its own rule records ("compared label(s) ADDED (improvement, record
   it in the baseline)"); the baseline needs the two entries recorded or the next run reports them
   again.
2. `rel-type-coverage-gate` / DERIVATION: the two labels stop being derivation debt the moment the
   oracle derives them. Run it before and after to see the row move; the before-number is the debt
   this patch pays, not a regression.

## Evidence the patch's two labels are already consumer-safe (measured, not assumed)

- **`part_of` is already a recognised file-level dependency in product readers** — the cpp lane's
  R3 relabel landed that vocabulary on 2026-10-22: `src/lsp/graph_request.ts` (`relationship_type IN
  ('imports','exports','part_of')`, and the file-level section's `('imports','part_of')`),
  `src/lsp/graph_usages.ts` (`row.relationshipType === "imports" || row.relationshipType ===
  "part_of"`), `src/lsp/evidence_tier.ts` (`IMPORT_KINDS`). So php include edges leave the LSP
  readers' `imports` branch and enter the branch that was built for exactly this construct — no
  reader change is needed and no edge is lost from the product's file-level sections.
- **`mixes_in` is a stored domain value and an admitted evidence tier**: `src/ast/graph.ts:78`
  (`MixesIn = "mixes_in"`), `src/lsp/evidence_tier.ts:116` admits `mixes_in` beside
  `extends`/`implements`. The vocabulary's own rule — every consumer that enumerates types must
  admit it — was discharged when ruby/dart/javascript landed the value.
- **The incoming gate needs NO patch for the relabel**: its claim routing is label-agnostic —
  `externalClaimOf` in `script/m14/incoming-rule.ts` reads `metadata[FILE_CLAIM_KEY]` (and the
  binding/remote/export claims) before any population marker, so a `part_of` row carrying
  `metadata.importProjectFile` verifies exactly as an `imports` row did. The 147 verified include
  claims move with their rows instead of falling into `otherUnresolved`.

## The lane's pinned evidence for the patch (all committed, all passing)

- `validation/m14/fixtures/php/trait-mixins.php` + `.expectation.json` — six required `mixes_in`
  rows (multi-trait, trait-composes-trait, adaptation form, qualified leaf, enum), the forbidden
  old `uses` row (the negative half of the relabel), and three impostors pinned apart (namespace
  import stays `imports`, closure capture stays a `uses` read, adaptation alias/method names never
  become composition targets).
- `include-paths`, `namespace-containment`, `payload-and-complexity`, `line-contract`,
  `member-value-reads` — updated to `part_of`/`mixes_in` with `meta.partRole`,
  `meta.includeType` (the four-way split the Lead required), and evidence-tier pins.
- `script/m14/php-mutants.ts` — four new result-level mutants: label revert for each relabel, the
  multi-trait collapse, and the lost `partRole`/`includeType`. **The lane's harness reads `all 27
  mutants caught, clean baseline 0 problems`.**
- `validation/m14/fixtures/php/recovery-swallowed-members.expectation.json` — a STALE PIN the
  mutant run exposed: its `equals: 0` row still spelled the pre-owner-qualification target
  `swallowedB` while the analyzer publishes `Swallower.swallowedB`, so `php/re-walk-recovered-subtrees`
  had been surviving on a spelling that no longer matched its subject. Repaired (owner-qualified
  target + the count half), and the mutant is caught.
