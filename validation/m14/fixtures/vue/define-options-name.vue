<script setup lang="ts">
// F16: `defineOptions({ name: 'X' })` is the `<script setup>` way to declare a
// component's name (Vue 3.3+). It was in VUE_COMPILER_MACROS only so its CALL edge
// would be filtered — the `name:` inside it was never read — so every component
// written the modern way fell back to the FILE STEM while the file plainly
// declares otherwise. Measured on the corpus: table/src/table-body/td-wrapper.vue
// declares `name: 'TableTdWrapper'` and was published as `td-wrapper`;
// splitter/src/split-bar.vue declares `name: 'ElSplitterBar'` and was published as
// `split-bar`.
//
// That is worse than a cosmetic stem: every component-owned edge sources the
// identity, and the store's symbol key is name+line, so the DECLARED name and the
// PUBLISHED one are two different symbols and a query for the declared name finds
// nothing.
defineOptions({ name: 'DeclaredByMacro' })

const props = defineProps<{ size?: number }>()
</script>

<template><div class="x" /></template>
