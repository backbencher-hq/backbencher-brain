<!-- fixture: vue/heuristic-evidence-floor
     F20 (vue ontology wave). Two shapes whose rows are HEURISTIC, written to
     pin the evidence tier they are allowed to claim.

     (a) A field read / bare read inside the script block. The JS/TS family
         delegate emits these at confidence 0.6 because the target is a
         PROPERTY, not a declaration it can see — the read names `state.value`,
         and `value` is whatever the runtime put there.

     (b) An unresolved dynamic import of a path-alias module. The specifier is
         written, the binding is not resolvable inside one file, so the row is
         marked `unresolved` and emitted at 0.6.

     Both sit BELOW the 0.7 floor, and `src/lsp/evidence_tier.ts` rule 2 says a
     row below the floor "MUST read `inferred`". Rule 1 of the same module says
     a STORED evidenceClass wins and is never re-derived — so the analyzer is
     the only place that floor can still be applied. The template and the
     script are both here so the file also has a row that is NOT below the
     floor: `{{ title }}` reads a real member at 0.95, and pinning it proves
     the floor did not swallow a confident row. -->
<template>
  <div class="box">{{ title }}</div>
</template>
<script>
export default {
  name: 'HeuristicBox',
  data() {
    return { title: 'x', state: { value: 1 } }
  },
  methods: {
    async load() {
      const mod = await import('@/vendor/missing')
      return mod
    },
    peek(source) {
      return source.value
    },
  },
}
</script>