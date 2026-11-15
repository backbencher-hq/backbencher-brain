<template>
  <MyChild :label="lab" />
  <p>{{ upper }}</p>
</template>

<script>
import Child from './Child.vue'
import { mapState } from 'vuex'

// A NAMED export alongside the default one. F19 (VUE_FIX, 2026-10-04): the
// seam no longer publishes `exports -> default` — `default` is a KEYWORD and
// names no symbol in this or any other file (measured: 121 of 121 vue-element-
// admin `exports` rows were `Component -> default`, resolving at 0 of 121
// against every symbol the draw publishes). The TypeScript delegate has always
// refused to build that row (M4, real-typescript-analyzer.ts:5744). This named
// export keeps the F8 assertion — that a component-owned DELEGATED edge sources
// the RENAMED identity and not the file stem — with an endpoint that resolves.
export const api = 1

export default {
  // Vue's DECLARED component identity — what `components: {}` resolves by and
  // what devtools shows. It differs from the file stem on purpose here.
  name: 'ActualName',
  props: { lab: String },
  computed: {
    upper() { return this.lab.toUpperCase() },
  },
  mounted() {
    this.$store.dispatch('refresh')
  },
}
</script>