# M60/VB2 mutation log — `src/ast/real-vb-analyzer.ts`

Every mutant below is a single-token edit to the analyzer at the commit that
carries it, run through `npx tsx script/m14/run-fixtures.ts --lang vb` with the
file restored afterwards. A survivor means the fixture cannot fail, so the
assertion it stands for is decoration and is recorded rather than hidden.

| # | mutant | killed by |
|---|---|---|
| M1 | `headerColonIndex` compares `node.id` again instead of `startIndex` | `extends Derived -> Api`, `implements ISized -> IDisposable` (both `meta.heritageForm: header`) |
| M2 | `isAssemblyVisible` answers `levels.has("public")` only, so `Protected Friend` is not an export | `exports Api -> BothHalves` |
| M3 | `defaultAccessLevel` returns `friend` for every declaration | `exports Api -> ImplicitlyPublic`, `exports Api -> ImplicitlyPublicToo` |
| M4 | a modifier-less field in a Structure defaults to `private` | `exports Coord -> X` |
| M5 | `constructionTargetLeaf` reads a fragment's own `type` field | `instantiates Qualified -> Size` (and the `forbid instantiates Builds -> System`) |
| M6 | `uses` publishes the callee and index slots too | `forbid uses CalleeIsNotARead -> Append`, `forbid uses Invoked -> GetHashCode` |
| M7 | `collectCalls` publishes a construction as `calls` again | `forbid calls EmptyArgs -> Widget` |
| M8 | the `As New` construction surface is not detected | `instantiates Builds -> Timer`, `instantiates Builds -> List` |
| M9 | `modifierWordsOf` does not split a multi-word `member_modifier` | `exports Api -> BothHalves` (`meta.accessLevel: protected+friend`) |
| M10 | a keyword-less interface header is labelled `extends` | `implements ISized -> IDisposable`, `implements ISized -> IComparable` |
| M11 | `stampEvidenceClasses` is not called | `exports Api -> Explicitly` (`meta.evidenceClass: structural`) |

**M9 needed a second form.** The first version of M9 removed the
`VB_KEYWORD_HEADS` membership test inside `addText` and SURVIVED, because both
words of `Protected Friend` are modifier heads and the SPLIT — not the filter —
is what the assertion rests on. A no-op mutant is not a survivor the fixture
caused; it is a mutant that tests nothing. The form recorded above removes the
split itself and is killed.

**Two survivors on the first pass, both fixed by pinning metadata.** A fixture
that asserts only that an edge EXISTS cannot see an analyzer that stamps no
`evidenceClass` at all (M11), nor one that reads `Protected Friend` as a single
opaque token (M9) — the latter because the access-level set comes out empty, the
documented default table then answers `public`, and the member is exported for
the wrong reason. Both assertions are now written as `meta.*` constraints on
rows that already existed.
