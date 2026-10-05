# Round: the real problem is SCOPING, not coverage

## What changed underneath you

A whole-corpus `incoming-check` sweep just completed for **all 23 lanes** at 600 files
each (`validation/m14/measurements/incoming-whole.tsv`). It replaces the 30-file sample,
which could not answer the question — the question is *precisely* whether edges reach
declarations in OTHER files, so a 30-file window systematically undercounts resolution.

The result changes what the remaining work is:

```
lane        files fired   AMBIGUOUS  UNRESOLVED
fsharp        600     9      40,791     33,339
zig           600     7      19,962     14,461
powershell    600     9      18,665     46,944
nim           600     8      12,491      9,424
lua           600     9       7,409      6,663
xml           600     3       6,007          72
dart          600    10       4,673     14,515
php           600    10       4,606     17,784
hcl           600     5       3,800      8,417
graphql       600     6       3,710      4,427
clean         164     9       3,520      3,097
bash          600     6         623      5,084
sql           600     6         198        973
yaml          600     5         135        225
toml          600     1          45          0
json          600     5          71          0
r             21     7           8        190
make          129     6           0      1,636
scss          600     8           0      1,185
```

**ZERO of 23 lanes have fully-resolving incoming. Not one.**

## The distinction that decides your next move

**An ambiguous edge is ONE edge that the reverse walk attributes to N declarations.** It
is not N edges. So:

- You cannot reduce ambiguity by emitting fewer edges.
- You cannot reduce it by implementing another relationship type.
- It falls only when **symbol identity becomes sound** — when the analyzer can say which
  of several same-named symbols it meant.

Coverage is close to finished and it is the shallow work. Ambiguity is the deep work and
it is where the remaining value is.

## What to do

1. **Measure your own ambiguity split.** For each type, separate:
   - targets ambiguous because **N declarations share a name in different scopes**
     (a real scoping failure you may be able to fix);
   - targets ambiguous because a name is declared in **>1 table/module and the analyzer
     does not model which one is in scope**;
   - targets ambiguous because **two different symbols legitimately share a published
     name** and the published name is not a unique identifier.
   These three have different fixes and only the first two are yours to repair. Report
   the split with counts. If most of your ambiguity is the third kind, that is a finding
   about the **published-name contract**, not about your analyzer — say so plainly.

2. **Then fix the largest single bucket your lane controls**, and re-measure the ambiguous
   count with `incoming-check` at the same 600 files so the before/after is comparable.
   State both numbers. If your ambiguous count does not move, say that too — a rule whose
   overturn condition you cannot meet is decorative, not falsifiable.

3. **Do not chase `unresolved` by widening your sample.** An unresolved target naming a
   file outside the window is not a defect. Only report an unresolved count as a defect
   when you have checked the target genuinely does not exist.

## Reference points

- `json` and `toml` reach **0 unresolved**. `scss` and `make` reach **0 ambiguous**.
  Read `script/m14/json-ruled.ts` and the scss lane's notes for how they got there.
- `resumable-walk.ts` exists so a poison file costs one file instead of the whole walk —
  use it for any new corpus measurement.
- Your lane's ruling table is registered and a gate enforces it. If you write another
  type's ruling into your table, register it; an unregistered table is invisible.

## Reporting

Per type: emitted or ruled, ambiguous count, unresolved count, and the ambiguity split
from step 1. Numbers with their populations. No adjectives.