<script>
// M49 dup-key ruling (#745) regression fixture — Options-API last-wins.
// Pre-fix contract: emitObjectMembers was first-wins (`seen.has(name)`
// skipped the later declaration), so the FIRST save() body survived while
// JS at runtime executes the LAST. Ruled contract (family-wide, Option A):
// one symbol per key, keyed to the LAST declaration — the later body is
// the survivor and its calls are the real ones.
export default {
  methods: {
    save() { return firstHelper(); },
    save() { return lastHelper(); },
  },
}
</script>
<template><p>dup-key</p></template>
