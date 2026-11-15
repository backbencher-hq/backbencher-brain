<!-- fixture: vue/error-recovery
     F28 (2026-10-12). The vue GRAMMAR's own error-recovery nodes — `ERROR` and the
     zero-width MISSING token — were in NO bucket of script/m14/spec/vue-completeness.json,
     which section A of the completeness inventory reports as a failure rather than a
     silence (2 of the vue grammar's named node types unclassified while svelte, the lane
     this seam shares its script machinery with, had classified the same two). They are
     HANDLED, not silent, and that is a measurement rather than a preference:
     real-vue-analyzer.ts walks `rootNode.hasError` and turns every
     `n.type === "ERROR" || n.isMissing` node into a ParseResult.errors entry at that
     node's OWN range, so a document that does not parse still reports WHERE.

     Classifying them HANDLED then exposed the half that was missing, which is why this
     fixture exists: verify-fixture-coverage.ts demands every handled type be exercised by
     a fixture (F6, no dead analyzer literal), and NO vue fixture source contained a
     markup-level parse error. The lane's other error fixture, script-error-offset, pins a
     SCRIPT-side error — that one is produced by the JavaScript sub-parser and shifted to
     SFC coordinates, so it exercises neither of the vue grammar's two nodes. The shapes
     below are measured, not guessed: `class=` with no value is an ERROR (`</>` and
     `<div id=>` are the same shape), while an UNCLOSED TAG is not an error node at all —
     `<span>unclosed` parses clean — so the missing token is provoked by a tag that never
     closes its own head, which inserts a zero-width `>` at that position.

     The script block is deliberately intact and AFTER the damage: the seam extracts SFC
     script bodies and parses them separately, so the component's identity and its
     declarations must survive a template that does not parse — the same claim the svelte
     lane's error-recovery fixture makes, and the reason a symbol row is pinned here
     rather than only the two error lines. -->
<template>
  <div class= ></div>
  <p
</template>
<script>
const shared = 1
export default { name: 'BrokenSfc' }
</script>
