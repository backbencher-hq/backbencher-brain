// FIXTURE — typescript/generic-heritage-args
//
// A heritage clause written with TYPE ARGUMENTS must publish the BASE NAME, not
// the whole generic spelling. tree-sitter-typescript 0.23.2 produces two shapes
// for the same source text and the analyzer handled only one of them:
//
//   extends_clause     `extends GenBase<string>`   -> [type_identifier, type_arguments]
//   implements_clause  `implements Gen<string>`   -> [generic_type]        <-- one node
//
// `generic_type` is a SINGLE named child whose text is `Gen<string>`, so the
// existing `type.type === "type_arguments"` sibling skip could not see the
// arguments and the target kept them.
//
// Three measured costs, all pinned below:
//   1. PRODUCTION DELETED THE EDGE. filterNoiseRelationships
//      (src/ast/pool-worker.ts:654) drops any target whose leaf contains `<` or
//      `>`. Measured raw-analyzer vs production on three corpora:
//        rxjs    implements  51 raw -> 43 production,  8 lost (15.69%), 6 files
//        nest    implements 252 raw -> 213 production, 39 lost (15.48%), 39 files
//        typeorm implements 158 raw -> 127 production, 31 lost (19.62%), 30 files
//      all 78 losses were exactly this shape, 0 of them anything else.
//   2. THE ENDPOINT COULD NOT BIND. `Gen<string>` is not a declared name.
//   3. THE STRUCTURAL OVERRIDE ARM COULD NOT PAIR — it resolves the base by
//      name, so `ifaceByName.get("Subscribable<T>")` never matched the declared
//      `Subscribable`. On rxjs's packages/observable-polyfill/src/index.ts that
//      cost 6 overrides edges, 4 of which the oracle had independently derived
//      as MISSING truth.
//
// The oracle already strips at the first `<` for every TYPE heritage node
// (differential.ts, the heritage `collect`, citing the same groovy `Cache<T>`
// case), so this brings the analyzer into lockstep rather than adding a third
// spelling.

interface Gen<T> {
  handled(): void
  handledTwice(): void
}

interface Plain {
  plain(): void
}

class GenBase<T> {
  baseGeneric(): void {}
}

class PlainBase {
  basePlain(): void {}
}

// The gain: `implements Gen<...>` must publish `Gen`.
class SingleArg implements Gen<string> {}

// Two entries in one clause; only the generic one carries arguments.
class MixedClause implements Plain, Gen<number> {}

// Generic args on a COMBINED extends + implements clause.
class BothHeritage extends PlainBase implements Plain, Gen<boolean> {}

// A generic interface whose member an in-file class implements: the structural
// override arm could not pair this before, because the base name it looked up
// carried its arguments.
class StructuralOverride implements Gen<number> {
  handled(): void {}
}

// `extends` with type arguments was ALREADY correct (the arguments arrive as a
// sibling `type_arguments` node). Pinned as a control so the implements fix
// cannot regress it.
class ExtendsGeneric extends GenBase<string> {}

// A generic base whose arguments themselves contain a nested generic: the
// strip must cut at the FIRST `<` and keep everything before it.
class NestedGenericArgs implements Gen<Array<Map<string, number>>> {}