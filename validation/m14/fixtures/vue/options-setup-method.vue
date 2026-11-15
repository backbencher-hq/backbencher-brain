<script lang="ts">
// F5: every function-valued Options option became a Method — `data`, the
// lifecycle hooks (isLifecycleHook), `methods`, `computed`, `watch` — and
// `setup` was in none of them, even though it is THE function Options
// components are built around: the 21 corpus files that use the Options form
// all wrote `setup(props) { return { … } }` and got no symbol at all. A graph
// of an Options component therefore had no entry point for it.
export default {
  name: 'OptionsSetup',
  props: { modelValue: String },
  setup(props) {
    const inner = props.modelValue
    return { inner }
  },
  mounted() { return 1 },
}
</script>

<template><div>{{ inner }}</div></template>
