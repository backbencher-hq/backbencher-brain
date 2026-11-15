<!-- fixture: vue/contract-call-local-shadow
     ONTOLOGY (2026-10-03). The third shape a NAME test for the provide/inject
     contract matches: a LOCAL declaration of the same name. `function inject`
     in the same <script> block shadows Vue's global, so the call is that
     function and not a contract. The lane does not resolve the shadow (that
     needs scope analysis this walk does not do), so the honest answer is to
     publish NEITHER edge rather than guess — and that is what is pinned here.

     `provide` is deliberately NOT shadowed in this file, which is what lets the
     fixture carry a positive row. A forbid-only fixture cannot tell 'the guard
     works' from 'the analyzer stopped matching everything', and that difference
     is the entire reason this file exists next to
     vue/contract-call-name-shapes, which pins the other two negatives (the
     DECORATOR and the MEMBER call) plus both positive shapes. They cannot share
     one file: all of them are the same call name in the same block. -->
<template>
  <div>{{ label }}</div>
</template>

<script>
// The shadow. Vue's global `inject` is not what the call below resolves to.
function inject(key) {
  return { shadowed: key }
}

export default {
  name: 'LocalShadow',
  data() {
    return { label: 'x' }
  },
  mounted() {
    // NOT a contract edge: this is the local function above.
    const shadowed = inject('shadowedKey')
    // Vue's own global — `provide` is not shadowed here.
    provide('bareProvideKey', { shadowed })
  },
}
</script>
