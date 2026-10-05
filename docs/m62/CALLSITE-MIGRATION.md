# Call-site truth: the migration spec for `navigation.ts` and `call_hierarchy.ts`

> Written by M62 lane 7 (call-site truth), 2026-10-05, at commit `a0ed9eade`.
> **Nothing in this document is implemented.** It is the specification for the two
> lanes that own `src/lsp/navigation.ts` and `src/lsp/call_hierarchy.ts`, written
> so those lanes can execute it without re-deriving the reasoning. Every claim
> about current behaviour below is measured and cited; every claim about what
> SHOULD happen is marked as a decision.

The authority for every "must" below is §15.3 of `docs/IDE-HONESTY-CONTRACT.md`:

> A range handed to the editor points at the call site it names, never at a
> declaration, never at a body, never at a fabricated line. A stored position that
> cannot be resolved from source is a declared approximation, and an unresolvable
> relation is omitted and declared — never emitted with a plausible-looking range.

The mechanism is already built and gated. `src/intelligence/graph/line-address.ts`
owns what a stored line IS (`deriveCallSiteAddress`, `formatAddress`,
`addressLine0`, `isExactAddress`), `CallSiteAddress` rides on every graph edge
(`src/intelligence/contracts.ts:307`), and `src/intelligence/graph/graph-engine.ts:772`
/ `:988` populate it for both directions. The gap is that these two surfaces do
not read it.

---

## 1. THE TRUTH TABLE — what is available today, per language

Measured by `script/m62/verify-consumers.ts` R7 on a real index at the commit
above: one purpose-built file per routed extension, indexed fresh by the real
indexer, over the **80 source-side stored relationship rows** (the side a
call-site line describes). Evidence: `validation/m62/results/A2.json` →
`perLanguageCallSiteTruth`.

| language | stored rows | real line | NULL | legacy `0` | usage rows | usage rows with a real line | on the marked invocation line | out of file | call-site | declaration | unknown |
|---|---|---|---|---|---|---|---|---|---|---|---|
| bash | 3 | 3 | 0 | 0 | 1 | 1 | 1 | 0 | 3 | 0 | 0 |
| c | 1 | 1 | 0 | 0 | 1 | 1 | 1 | 0 | 1 | 0 | 0 |
| csharp | 3 | 3 | 0 | 0 | 1 | 1 | 1 | 0 | 3 | 0 | 0 |
| dart | 4 | 4 | 0 | 0 | 4 | 4 | 2 | 0 | 4 | 0 | 0 |
| elixir | 3 | 3 | 0 | 0 | 1 | 1 | 1 | 0 | 3 | 0 | 0 |
| erlang | 5 | 5 | 0 | 0 | 1 | 1 | 1 | 0 | 5 | 0 | 0 |
| fsharp | 3 | 3 | 0 | 0 | 1 | 1 | 1 | 0 | 3 | 0 | 0 |
| go | 4 | 4 | 0 | 0 | 2 | 2 | 2 | 0 | 4 | 0 | 0 |
| groovy | 3 | 3 | 0 | 0 | 1 | 1 | 1 | 0 | 3 | 0 | 0 |
| haskell | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 |
| java | 3 | 3 | 0 | 0 | 1 | 1 | 1 | 0 | 3 | 0 | 0 |
| kotlin | 5 | 5 | 0 | 0 | 3 | 3 | 1 | 0 | 5 | 0 | 0 |
| lua | 5 | 5 | 0 | 0 | 4 | 4 | 2 | 0 | 5 | 0 | 0 |
| perl | 1 | 1 | 0 | 0 | 1 | 1 | 1 | 0 | 1 | 0 | 0 |
| php | 4 | 4 | 0 | 0 | 4 | 4 | 2 | 0 | 4 | 0 | 0 |
| python | 13 | 13 | 0 | 0 | 13 | 13 | 1 | 0 | 13 | 0 | 0 |
| ruby | 1 | 1 | 0 | 0 | 1 | 1 | 1 | 0 | 1 | 0 | 0 |
| rust | 1 | 1 | 0 | 0 | 1 | 1 | 1 | 0 | 1 | 0 | 0 |
| scala | 5 | 5 | 0 | 0 | 3 | 3 | 1 | 0 | 5 | 0 | 0 |
| solidity | 8 | 8 | 0 | 0 | 4 | 4 | 2 | 0 | 8 | 0 | 0 |
| swift | 1 | 1 | 0 | 0 | 1 | 1 | 1 | 0 | 1 | 0 | 0 |
| typescript | 2 | 2 | 0 | 0 | 2 | 2 | 2 | 0 | 2 | 0 | 0 |

**Denominator, stated because the contract bans an unscoped "all languages"
(§1):** 22 routed extensions of the ~60 in `src/ast/language-detection.ts`. The
fixture is one file per language, so this is a **PRESENCE** measurement, not a
coverage measurement on real repositories.

**What this changes about the earlier record.** `validation/m59/results/probe-line-absence-by-language.json`
(at commit `295f6fa0`, 2026-09-17) measured python `0 of 4 321`, rust `0 of
6 490` and go `0 of 2 895` relationships carrying a line, with java and scala at
100 %. On this fixture all 22 measured languages now carry a real line on every
one of their 80 stored rows. **Do not carry that older table forward.** Re-run
`npx tsx script/m62/verify-consumers.ts`; the table is in the evidence and
regenerates.

**What this does NOT establish, and must not be claimed.** 22 files of one shape
each is not a corpus. A language can emit a real line for `z = target(y)` and
still emit nothing for a call inside a macro, a template, or a decorator chain —
`script/m59/verify-868-js-oracle-decorator.ts` exists precisely because the
JavaScript oracle has that gap. Per-language coverage on real repositories remains
M59.A7's / M60's claim and is **not** re-measured here.

**Consequence for this migration.** Because the honest outcome for a
`kind: "unknown"` address is a DECLARED ABSENCE rather than a position, the two
surfaces below must be built so that absence is a first-class, renderable result
and not an error path nobody wrote. Neither surface may assume it will always
receive `kind: "call-site"`.

---

## 2. `src/lsp/navigation.ts` — `textDocument/references`

### 2.1 What it does today (measured, at the commit above)

| site | fact |
|---|---|
| `src/lsp/navigation.ts:440-455` | the query deliberately does **not** select `r.line_number`; the comment at `:431-439` says why |
| `src/lsp/navigation.ts:482-488` | each location is built from the **referencing symbol's own** `source_line_start` / `source_byte_start` — i.e. the declaration of the calling symbol |
| `src/lsp/navigation.ts:469-479` | rows are filtered by `isUsageSiteRow` from `src/lsp/relations.ts` (the one relation vocabulary, M55.T3) |
| `src/lsp/navigation.ts:490-492` | deduplicated by `path:line:character` |
| `validation/m62/results/A2.json` → `declaredNotChanged` | the M62 record already declares: "references/call-hierarchy keep navigating to the referencing symbol's own indexed location (byte-accurate) — no line-only call-site position is claimed there" |

So references is **not lying about what it claims** — it claims a symbol
location and delivers one. It is, however, answering a different question than
the one a developer asks, and §15.3 is about the question the range points at:
the editor's "find references" highlight lands on `function main()` when the user
asked "where is `greet` called".

### 2.2 The exact change

**Add a second, declared location kind — do NOT repurpose the existing one.**

`NavigationLocation` (`:35-46`) is consumed by `src/lsp/rich_hover.ts` (through
`edgeLocation`, `:364-400`, exported for exactly that reason) and by
`script/m26/verify-impact-mode.ts:370`. Changing what `line` means would break the
hover's usage links without telling it. So:

```ts
export interface NavigationLocation {
  // …unchanged…
  /** §15.3: WHAT this position points at.
   *  "call-site"      — the stored relationship row's line; the editor opened the
   *                     invocation.
   *  "declaration"    — the store names no call-site line, so the REFERENCING
   *                     SYMBOL's own indexed location is shown INSTEAD. The
   *                     address owner's substitute note travels with it.
   *  "unknown"        — no position may be shown at all. `line` is null (never 0,
   *                     never 1) and `note` says which absence it is.
   *  Absent means the pre-M62 shape: this surface made no call-site claim. Absent
   *  is NOT "exact". */
  callSite?: CallSiteAddress
}
```

The SELECT at `:440-455` adds the address owner's declared column pair, never the
column literal:

```ts
import { STORED_LINE_SELECT, deriveCallSiteAddress, addressLine0 } from "../intelligence/graph/line-address"
// …
`SELECT r.id, r.source_symbol_id, r.target_symbol_id,
        r.confidence, r.relationship_type,
        ${STORED_LINE_SELECT},
        ss.line_start AS caller_line,
        COALESCE(sf.relative_path, sf.path, '') AS caller_file,
        sf.path AS source_path, ss.byte_start AS source_byte_start, …`
```

`src/lsp/navigation.ts` is in `DISPLAY_SURFACES` (`script/m62/verify-consumers.ts:55`),
so the P6 lint at `:201-212` will reject the column written literally. The
constant is the only way through, and P10b keeps that constant single-owner.

**Then, in the row loop at `:460-496`:** derive the address, and branch on the
owner, never on a raw value:

```ts
const address = deriveCallSiteAddress({
  storedLine: storedLineFromRow(edge as unknown as Record<string, unknown>),
  file: edge.caller_file,
  callerDeclaration: { line: edge.caller_line },
})
if (address.kind === "call-site") {
  const line0 = addressLine0(address)            // the owner's 1-based → 0-based rule
  if (line0 === null) continue                  // unreachable by construction; refuse anyway
  // A line-only range is what the store can give. §15.3 forbids fabricating a
  // column, so character 0 is the honest choice ONLY because the note says the
  // range is line-only — see 2.3, decision D1.
  const loc: NavigationLocation = {
    path: address.file, line: line0, character: 0,
    endLine: line0, endCharacter: firstTokenWidth(address.file, line0, symbol.name),
    callSite: address,
  }
  …
}
```

**Omission + declaration (§15.3's last clause).** When the store names no line
AND the referencing symbol's own declaration cannot be resolved from source
(`edgeLocation` returns `null` at `:489`), the row is currently `continue`d
silently. That is the "omitted AND declared" violation. The result object
(`:79-89`) needs one more field, and the omission must be counted in it:

```ts
/** Locations that EXIST as relations but carry no resolvable position. Reported
 *  so an omission is never silent (M62 §15.3). */
omittedUnpositionable: number
```

**Deduplication changes.** `:490` keys on `path:line:character`. With two
different call sites in one function, both are now `path:line` with
`character: 0` and they would COLLAPSE into one — turning a truth into a lie in
the other direction. The key must include the row identity: `path:line:rowId`.
This is a behaviour change §15.1 requires (the count changes), so it must be
declared in the same release as the new field, and the m24 navigation gate's
count assertions must be updated in the same commit.

### 2.3 The decisions the owning lane must make (I am not making them)

- **D1 — a call-site line with no column.** The store carries a line, never a
  column. A range handed to the editor for a line-only position is
  `{character: 0, endCharacter: <width of the target's name token>}`, which is a
  real range the editor can highlight. §15.3 permits it ("points at the call site
  it names") but it is an APPROXIMATION within the line and must be labelled.
  Options: (a) always `character: 0, endCharacter: 0` and let the caller declare
  it; (b) read the source and measure the name token (exact columns, one file
  read per reference set — the cost is real and the reference set is capped at
  `MAX_LOCATIONS = 200`). My recommendation is (b) with (a) as the declared
  fallback when the file cannot be read, because call_hierarchy already does
  exactly this (`nameTokenRange`, `src/lsp/call_hierarchy.ts:329-354`) and §13.7
  wants ONE renderer/measurement core.
- **D2 — LSP's own semantics.** `textDocument/references` is defined by the
  protocol as "the locations where the symbol is DECLARED OR USED". Returning a
  call site is MORE correct against the spec than today's declaration
  positions, but a client that assumed one-location-per-symbol will now see N
  locations for one caller. That is the right answer and a compatibility
  question; it belongs to the owning lane and to §12.1's "nothing unclickable"
  (every new location must be index-differentially checked).
- **D3 — `includeDeclaration`.** `:498-509` adds the declaration when asked.
  Under the new shape it should keep doing so, and the declaration location
  should carry `callSite: { kind: "declaration", …, note: ADDRESS_NOTES.substitute }`
  so a reader can tell the two apart. That reuses the owner's vocabulary rather
  than inventing one.

### 2.4 The tests `navigation.ts` needs

1. **Differential against the owner, over a REAL index.** For every reference row
   served, `location.callSite` must equal `deriveCallSiteAddress(storedLine, file,
   callerDeclaration)` for the SAME row id. Not a re-derivation in the test —
   the same import, as A2's R2 does for the hub.
2. **The three store states, end to end.** A fixture with a real line, a legacy
   `0`, and a NULL must yield `call-site` / `declaration`+note / `declaration`+note
   or `unknown`+note. Assert the note, not just the kind.
3. **No fabrication.** No served location may have `line < 0`, and an `unknown`
   address may not produce a location at all. Plant `line: 0` in the loop and
   prove the check catches it.
4. **Two call sites in one function are two locations.** The regression the
   `path:line:rowId` key change exists to prevent. Assert `locations.length === 2`
   where today it is 1.
5. **Omission is counted.** A row whose source file is missing increments
   `omittedUnpositionable` and adds no location. Plant a deleted file and assert.
6. **§15.1 count agreement.** `totalCount` must equal the number of distinct
   served locations plus the omitted count, and must agree with
   `relations.countUsageSites` and with the hover's usage count on the same
   fixture — the three already share `isUsageSiteRow`, so this is a count
   assertion, not a new predicate.
7. **A negative for the lint.** Prove `P6` catches a literal `line_number` in
   `navigation.ts` (it does today — the file is in `DISPLAY_SURFACES`, and the
   planted-read negative at `verify-consumers.ts:363` is the shape).

---

## 3. `src/lsp/call_hierarchy.ts` — the OTHER approach, and why I am not
##    prescribing it

`call_hierarchy.ts` **already** satisfies §15.3, and it does it by a different
route. Measured facts:

- `:20-31` (M55.T2, issue #771): "fromRanges are the INVOCATION sites found in
  the caller's own source — every occurrence of the target being invoked. **No
  position is ever taken from the stored relationship row's line**: that column
  is the address owner's to interpret."
- `:280-325` `resolveInvocations` scans the caller's 0-based line range for the
  target name, requires `(` or a preceding `new`, strips comments
  (`codeBeforeComment`, `:240-244`), and returns exact UTF-16 columns through
  `createPositionMapper` / `indexToLsp` — the §5 position owner.
- `:169-170` `callSitesResolved` / `callSitesApproximate` are published on the
  response, and the item `detail` says "position approximate".
- `:124` / `:129` `fromRanges` therefore never contain a declaration range: the
  fallback is the caller's NAME TOKEN, labelled.
- The file selects no stored relationship column at all, which is why
  `verify-consumers.ts` R5 already passes on it.

**So call hierarchy does not need the migration.** It needs one thing from the
address owner, and that is a DECISION for its lane, not a fix:

### 3.1 The open question (D4): two sources of truth for "where is the call"

There are now two independent answers to one question:

| approach | source of the position | strength | failure mode |
|---|---|---|---|
| call hierarchy (M55.T2) | the caller's SOURCE TEXT | exact columns, finds every invocation, never reads the store | needs the file; a macro/template/dynamic call is invisible; a name that appears twice on one line yields two ranges for one store row |
| graph/hub/impact/MCP (M62) | the stored `line_number`, via the address owner | works without the source; names the row; handles a call the source scan cannot see | line-only; a column-less range is an approximation |

They can disagree, and when they do **both are currently right about different
things**. §15.1 requires the difference to be declared. The options:

- **(a) Cross-check and declare.** Where a call-hierarchy range and a stored
  line exist for the same row, assert they agree on the LINE; where they do not,
  publish both with their provenance (`source-resolved` vs `index-stored`) and
  count the disagreement on the response. This is the honest option and it is
  what §15.1 literally asks for.
- **(b) Source-first, store as the fallback** for `fromRanges`, with the store
  line used only when the scan resolves nothing. This makes the stored line a
  labelled substitute — precisely `kind: "declaration"` in the owner's vocabulary
  — and it deletes the current name-token fallback.
- **(c) Keep them separate and say so in the legend.** Weakest; it defers the
  reconciliation to a reader and to §13.9's "one legend explains every badge".

**My recommendation is (a), then (b).** It is the only one that makes the
disagreement measurable, and the measurement is cheap: both positions are
already computed.

### 3.2 The tests `call_hierarchy.ts` needs (whatever D4 resolves to)

1. **A store line that disagrees with the source scan.** Seed a row whose stored
   line is the caller's DECLARATION line while the source clearly invokes the
   target elsewhere. Whichever approach D4 picks, the response must not present
   the declaration as a call site, and the disagreement must be counted.
2. **The stored `0` / NULL path.** `fromRanges` must not contain a range derived
   from a stored `0`. Today the file does not read the column, so this is a
   regression guard against D4=(b) reintroducing the read. If D4=(b) lands, this
   test is the one that keeps the A2 P6 lint satisfied too.
3. **`callSitesResolved + callSitesApproximate == fromRanges.length`.** §13.4:
   the counts equal what is rendered. Nothing currently asserts this, and it is
   the cheapest §13.4 assertion on this surface.
4. **A name appearing twice on one line** — one store row, two resolved ranges.
   Either declare the multiplicity (§13.2) or collapse it with a note. Whichever,
   a test must say which.

### 3.3 A gate defect to fix in `script/m59/verify-honest-callsite.ts` (found,
##      not fixed — read-only lane)

This is the gate the owner names as "M59 is call-site truth". It **cannot fail**
on the defect it claims to hunt, and its mutation leg asserts nothing about the
gate. Both are §8.7 findings and both are in a file I may report but not edit.

**(a) Two checks, one variable — a tautology.** `:223-228`:

```ts
check("lsp-ranges-finite", lspFabricated === 0, …)
check("lsp-no-fabricated-ranges", lspFabricated === 0,
      "every emitted range derives from a real DB line (null-1 would be NaN → caught above)")
```

`lspFabricated` increments only when `!Number.isFinite(line) || line < 0`
(`:203`). So `lsp-no-fabricated-ranges` re-asserts the finiteness check. A
`fromRanges` entry pointing at a DECLARATION — a finite, non-negative line — is
exactly the defect, and this check passes on it. **The gate named for call-site
truth cannot detect a fabricated call-site range.**

The replacement, for that lane: compare `expandCalls`' `fromRanges` against the
source. For each `fromRange`, read the caller's file and assert the range's line
contains the target name followed by `(` or preceded by `new` — the same
predicate `resolveInvocations` already applies
(`src/lsp/call_hierarchy.ts:308-309`). Then a planted declaration-range mutant
goes red, and `lsp-ranges-finite` can be deleted as subsumed.

**(b) `mutation-caught` asserts the UPDATE, not the gate.** `:231-260`:

```ts
raw.prepare(`UPDATE brain_relationship SET line_number = 42 WHERE id = ?`).run(unknown.id)
…
mutationCaught = rowNow.ln === 42   // the mutation landed
```

`mutationCaught` is `true` when SQLite applied the UPDATE. No check is re-run
after the mutation, so no check is shown to go red. `postFabricated` is computed
and then discarded by `void postFabricated` (`:256`). A mutation suite whose
verdict is "the database accepted a write" proves nothing about the product, and
its own evidence file records `"negativeCases"` on that basis.

**The replacement:** after the UPDATE, re-run the SAME `null-stays-null` /
`known-stays-true` predicates and require that at least one of them turns false
(or, for the store-corruption shape, a dedicated check that the engine now
serves 42 and the gate's expected value disagrees). A mutation leg that cannot
turn a check red must be deleted, not relabelled.

---

## 4. The order that makes this safe

1. Land `derived.${kind}` on the payload (additive; nothing reads it yet) and the
   `omittedUnpositionable` counter. Wire the differential test. **No behaviour
   change yet** — the gate is the deliverable of this step.
2. Land the mutation suite for steps 1–3 first: a planted declaration-position
   and a planted literal stored column must each go red. F7: the gate precedes
   the fix.
3. Switch `references` to the call-site branch **behind the address kind**, with
   the `declaration` branch serving today's behaviour verbatim and a declared
   `data-callsite-kinds` attribute on the payload so drift is visible (§13.9).
4. Only then remove the declaration branch for rows the store gives a real line
   for — and update `MAX_LOCATIONS`-relative count assertions in the same commit,
   because §15.1 makes the count part of the contract.
5. Reconcile D4 on `call_hierarchy.ts` LAST, once both surfaces publish a
   position per row and a disagreement is measurable on both sides.

## 5. What must NOT be done

- **Do not fabricate a column.** No conversion outside `src/lsp/positions.ts`
  (§5), and no `character` value the source does not support.
- **Do not repurpose `line`/`character`** on `NavigationLocation`. Add a field;
  the hover's existing links read the old one.
- **Do not clamp an absent line to 1 or to 0.** The owner's `unknown` kind has
  `line: null` for exactly this.
- **Do not collapse two call sites in one function into one location.** The
  `path:line:rowId` key is load-bearing.
- **Do not call the absence "no references found".** An omitted unpositionable
  relation is a DIFFERENT answer from an absent one, and §15.3 requires the
  difference to be visible on the wire.
- **Do not claim per-language coverage.** Section 1 is a presence measurement on
  22 files. M59.A7 / M60 own coverage on real repositories.