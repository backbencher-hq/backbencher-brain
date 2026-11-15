<script lang="ts" setup>
// F32 (2026-10-12). The `<script setup>` half of the same rule, and the half that was
// doubly wrong: this path read only a string literal, so a `name:` bound to a constant
// was neither read NOR marked. The component kept the stem and looked exactly like one
// that never named itself — F17's marker never fired here, which is why the marker is
// now set on both paths.
//
// Measured on the 1,162-file draw: 253 of the 724 unresolved component-usage
// `instantiates` edges named a component whose own name is assigned as a string literal
// in the declaring file (`ElInput` 59 edges, `ElSelect` 42, `ElSwitch` 33, 25 distinct
// names), every one of them invisible to a reader that only accepts a literal.
const COMPONENT_NAME = 'SetupConstNamed'

const count = 0

defineOptions({ name: COMPONENT_NAME })
</script>

<template>
  <MyChild :value="count" />
</template>
