// FS-P9 (fsharp lane, 2026-10-08) — A MUTUAL TYPE GROUP IS SEVERAL TYPES IN ONE NODE, and
// the lane read it as one.
//
// F# writes `type A = … and B = …` for types that refer to each other, and the grammar
// emits ONE `type_definition` holding a clause body per type:
//
//     type_definition  "type Abbrev = Other.Thing and Real() = inherit Base("
//       type_abbrev_defn  {type_name=identifier "Abbrev"}
//       anon_type_defn    {type_name=identifier "Real"}
//
// Every name in the analyzer's type branch was read with `findDescendant(node, "type_name")`
// — the FIRST name in the whole definition — so the group was named after its first clause
// whichever one the source meant, and every later clause's members were published under that
// name. Measured on the 3,000-file draw (.tmp-probe/fs-p10-groups.mts, arm
// rows-pass13-meta.ndjson): 79 groups in 67 files, 182 clauses after a first, and **161 of
// those names published nowhere** — `Bolero.Html`'s `ElementBuilder`, `ComponentBuilder`,
// `ComponentWithAttrsBuilder` (their members attributed to `ConcatBuilder`), `Argu`'s
// `IFunc`/`ITemplateFunc`, `Deedle`'s `address`.
//
// The half that a missing-name count cannot see is the ATTRIBUTION, and it is the worse half:
// `ConcatBuilder.GroupOwn` is a published symbol, so a containment edge or a call that lands
// on it RESOLVES, and nothing downstream can tell it names the wrong type. Every shape below
// therefore pins an OWNER, not just a name.
//
// The four shapes are here because they reach the type branch by different arms and a fix
// aimed at one of them would leave the others:
//   (1) abbreviation + class   — the shape in the repro that started this
//   (2) record + record        — the record-field arm reads its own owner separately
//   (3) union + union          — the DU-case arm, whose case symbols carry `ownerName`
//   (4) bodyless + attribute   — Deedle's `and [<Measure>] address`, where the attribute that
//                                decides the clause's KIND is a sibling BETWEEN the clauses
namespace Fixture.MutualType

// The dependencies. Declared in this file so every owner below is checkable rather than
// inferred: a row that says `GroupSecondRecord -> GroupSecondDep` names a class this file
// publishes.
type GroupDep() = class end

type GroupSecondDep() = class end

type GroupBase() = class end

// (1) An ABBREVIATION and a CLASS in one group. Pre-fix this file published `GroupAbbrev`
// only: `GroupReal`, `GroupReal.GroupCall` and `GroupReal.GroupOwn` were all attributed to
// the abbreviation, and the `extends` edge named `GroupAbbrev -> GroupBase`.
type GroupAbbrev = GroupDep list

and GroupReal() =
    inherit GroupBase()
    member this.GroupCall() = this.GroupOwn()
    member _.GroupOwn() = 1

// (2) Two RECORDS. The field's written type is a dependency OF THE RECORD, and pre-fix the
// second record's field was published as the first record's dependency — `GroupRecord ->
// GroupSecondDep`, a determinate edge naming a declaration that is not the one the
// annotation sits in.
type GroupRecord = { GroupField: GroupDep }

and GroupSecondRecord = { GroupOther: GroupSecondDep }

// (3) Two UNIONS. Same defect through the DU-case arm: the second union's case symbol and
// its payload's declared type both carried the first union's name.
type GroupUnion = GroupCase of GroupDep

and GroupSecondUnion = GroupSecondCase of GroupSecondDep

// (4) A BODYLESS clause whose attribute is written BETWEEN the clauses — the shape Deedle
// uses for its unit of measure (`type Address = int64<address>` + `and [<Measure>] address`).
// The `attributes` node is a direct child of the GROUP, not of the clause it applies to, so a
// clause frame has to carry it by POSITION: pre-fix `groupMeasure` was published nowhere, and
// the `uses` edge for `Measure` named `GroupAddress`'s scope.
type GroupAddress = int64<groupMeasure>

and [<Measure>] groupMeasure
