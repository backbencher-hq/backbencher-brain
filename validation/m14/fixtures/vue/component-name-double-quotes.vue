<script>
// The `name:` value is read with the file's `unquote` helper, which strips
// SURROUNDING quotes of either style. It used to be `replace(/['"]/g, "")`,
// which removed every quote character anywhere in the value. For a `name:`
// option — always a string literal — the two agree, and this fixture pins that
// they still do for the DOUBLE-quoted spelling, which no other fixture used.
export default {
  name: "DoubleQuoted",
  props: { label: String },
  methods: { go() { return 1 } },
}
</script>

<template><button @click="go">{{ label }}</button></template>
