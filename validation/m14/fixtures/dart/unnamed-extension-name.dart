// fixture: dart/unnamed-extension-name — an UNNAMED extension must not be published under a
// REAL declaration's name.
//
// MEASURED before this fix (`validation/m14/fixtures/dart/unnamed-extension-price.ts`, whole
// projects through the pool): riverpod publishes 41 unnamed extensions, and 19 of them share a
// name with a real declaration of the same project — `ProviderBase` x5, `RiverpodAnalysisResult`
// x2, `_DataRecord`, `Node`, `ProviderListenableOrFamily`, `_ProviderOverride`, `_FamilyOverride`,
// `Mutation` (whose members then published the AMBIGUOUS targets `Mutation.constructor`/`label`/
// `key`/`call`/`run`) and `Object`, from `packages/riverpod/test/feature/offline_test.dart`.
//
// The `Object` row is why that is a defect and not untidiness. With an index the analyzer retargets
// `Object.hashCode` / `Object.operator ==` / `Object.toString` to the dart:core interface and marks
// the claim `isExternalBase`; the arbiter verifies an external claim by looking the OWNER up, found
// the ANONYMOUS EXTENSION, and refused 31 claims that are TRUE (`/tmp/dartgate/gate-riverpod-index.log`:
// `extFAIL 31`, counted against the lane by the gate's own verdict).
//
// So an unnamed extension publishes a SYNTHESIZED name, in the family's spelling for a declaration
// the source never named (java's `anonymous_Comparator`, rust's `anonymous_impl`), and the prefix is
// `unnamed_` deliberately: `isIndexArtifactName` (src/ast/analysis-exclusions.ts) drops
// `^(anonymous|anon|unnamed)[_-]`, so the synthesized symbol never reaches the index — the honest
// state for a declaration that has no name to jump to. `metadata.targetType` still carries the
// subject, so nothing about it is lost.
//
// FOUR things are pinned, and the third and fourth are what keep the fix from overreaching:
//   (1) the synthesized name itself, for a target the file declares (`Local`) and for one it does
//       not (dart:core's `Object`, the row that cost the gate 31 true claims);
//   (2) the member ownership that rides on it — `contains` names the synthesized owner;
//   (3) a NAMED extension still publishes its OWN name and still keeps its `references` edge to its
//       subject (`LocalUtil -> Local`, pinned independently in script/m14/verify-dart-references.ts);
//   (4) the unnamed extension publishes NO edge to its own subject. The subject is its IDENTITY
//       here — the published name is derived from it — so such an edge would read
//       `unnamed_extension_Local references Local`, whose SOURCE is a name the store does not keep.

class Local {
  const Local();
}

// NAMED: published as `LocalUtil`, and its `on` clause is a real `references` edge.
extension LocalUtil on Local {
  Local? get nothing => null;
}

// UNNAMED: published as `unnamed_extension_Local`, never as `Local`.
extension on Local {
  bool get localish => true;
}

// UNNAMED, and the row that cost the gate 31 true claims. The target type is dart:core's `Object`,
// which this project does not declare — so before the fix this file published a DECLARATION named
// `Object`, and every external claim about `Object`'s owner became refutable.
extension on Object? {
  bool get isAbsent => this == null;
}
