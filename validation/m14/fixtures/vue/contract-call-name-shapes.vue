<!-- fixture: vue/contract-call-name-shapes
     ONTOLOGY (2026-10-03). The provide/inject CONTRACT edge is matched by NAME,
     and in JavaScript a name test also matches things that are not Vue's
     provide/inject. One of them produced a FABRICATED edge inside this lane's
     own fixtures:

       DECORATOR   `@inject("db") pool = 1` is a DI decorator. Its argument is a
                   string the component never receives. Before the fix this lane
                   published `references <Component> -> db` carrying
                   `metadata.isInjectContract` at confidence 0.9 — the graph
                   asserting a contract the file does not declare. The shape was
                   found by reading `vue/decorator-metadata-868`, a fixture
                   written for the #868 line-mirror seam, whose own output carried
                   the bogus edge. Corpus incidence is 0 of the 79 contract calls
                   on 1,151 admitted .vue files, so no sweep on this corpus could
                   have surfaced it: 0 here is a LATENT defect, not evidence of
                   absence, and it is stated as such.

       MEMBER      `this.inject(…)`. Already excluded by the callee TEXT test
                   (`this.inject` is not `inject`), pinned here so the exclusion
                   rests on a fixture rather than on a property of a string
                   comparison.

     `inject` is imported FROM 'vue' in this file, which is what makes the
     decorator row an isolated test: an import from vue is the strongest evidence
     the name IS Vue's, so the local-shadow and foreign-import guards both stay
     silent and only the decorator guard can be what rejects the row.

     The positive half is here because a guard that stopped matching everything
     would pass a forbid-only fixture. The corpus's 79 contract calls are 74
     bare-global and 5 `import … from 'vue'`; both shapes are pinned across this
     file and its partner, `vue/contract-call-local-shadow`. The imported shape is
     the one a naive "a declared name is a shadow" guard deletes, which the first
     version of this fix did — measured on the corpus, all 5 imported `provide`
     calls lost their edge.

     The partner negative, a LOCAL `function inject(…)`, cannot share this file:
     it is the same call name in the same block, and pinning both in one file
     would ask the analyzer to match and to reject the same identifier at once. -->
<template>
  <div>{{ label }}</div>
</template>

<script>
import { provide, inject } from 'vue'
import { STEPS_INJECTION_KEY } from './tokens'

// NOT Vue's provide/inject contract: a DI decorator whose own call is named
// `inject`. Its argument is a string literal, so the pre-fix edge pointed the
// component at a contract key `db` that nothing provides.
@inject("db")
class Pool {
  pool = 1
}

const anchorKey = Symbol('anchor')

// Vue's own global, named by an `import … from 'vue'` binding — both shapes the
// corpus writes.
const injected = inject(anchorKey)
provide(STEPS_INJECTION_KEY, { value: injected })

export default {
  name: 'ContractShapes',
  components: { Pool },
  data() {
    return { label: 'x' }
  },
  mounted() {
    // NOT Vue's: a method call under the name.
    this.label = this.inject('memberKey')
  },
}
</script>

<script setup>
// NOT Vue's either, and the case a guard on LOCAL declarations alone cannot see:
// this block's `inject` is bound by an import from ANOTHER library, so the call
// is vue-router's function under Vue's name. It has to be a separate block —
// `inject` cannot be bound twice in one scope, which is exactly why the three
// negatives of this family need three files.
import { inject } from 'vue-router'

const foreign = inject('foreignKey')
</script>
