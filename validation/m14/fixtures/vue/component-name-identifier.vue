<script lang="ts">
// F17: `name:` is not always a string literal. It can be an IMPORTED IDENTIFIER,
// whose value lives in another module and which this lane cannot read without
// cross-file resolution it does not do. The old code took the value node's text
// whatever its type, so the component's ONE identity became the VARIABLE's name:
// measured on the restored corpus, option.vue published a component called
// `COMPONENT_NAME` with 21 edges sourced at it and select.vue one with 43.
//
// That is a graph lie and a worse one than the stem fallback F8 chose on
// purpose — `COMPONENT_NAME` is not written anywhere as this component's name,
// no registry holds it, and no consumer can resolve it. So a non-literal `name:`
// keeps the stem AND records that a name WAS declared but unreadable, because
// silence would claim the component never named itself.
import { COMPONENT_NAME, optionProps } from './option'

export default {
  name: COMPONENT_NAME,
  props: optionProps,
  methods: { go() { return 1 } },
}
</script>

<template><button @click="go" /></template>
