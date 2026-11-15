<template>
  <MyChild :label="lab" />
</template>

<script>
import Child from './Child.vue'

// F32 (2026-10-12): the same `name:` option as vue/options-rename-identity, with its
// value behind a LOCAL CONSTANT — the shape element-plus uses for almost every
// component (`const COMPONENT_NAME = 'ElInput'` + `defineOptions({ name: COMPONENT_NAME })`).
//
// F17 ruled that a non-literal `name:` keeps the stem, on the grounds that the value is
// "an IMPORTED IDENTIFIER, whose value lives in another module". That is true of an
// import and false of this: `REAL_NAME` is declared three lines up IN THIS FILE, so the
// name IS written here and nothing cross-file is needed to read it. vue/component-name-identifier
// is the imported case and must keep F17's stem + marker; this file must NOT.
const REAL_NAME = 'OptionsConstNamed'

export default {
  name: REAL_NAME,
  props: { lab: String },
  methods: { go() { return 1 } },
}
</script>
