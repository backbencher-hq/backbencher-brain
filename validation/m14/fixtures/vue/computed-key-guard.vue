<script lang="ts">
const dyn = 'k'

// F6: the M2/VSD15 ruling — a bracket-led computed key names a VARIABLE, which is
// statically unknowable, so skip it — was implemented in `emitObjectMembers` and
// NOWHERE ELSE. Sites that turn an object key into a symbol name:
//   emitObjectMembers  (methods/computed/watch)  GUARDED before this fix
//   emitDataKeys       (data keys)               no guard
//   propEntries        (props / emits)           no guard
//   genericMacroEntries(inline type literals)    no guard, and it also walked
//                        INDEX SIGNATURES as if they were members
// `plain` / `plainProp` / `save` are the CONTROLS: a guard aimed at the whole
// bracket instead of the key POSITION would lose them, so the fixture
// distinguishes that implementation from this one.
export default {
  name: 'ComputedKeyGuard',
  props: { [dyn]: Number, plainProp: String },
  data: () => ({ [dyn]: 1, plain: 2 }),
  methods: { [dyn]() { return 1 }, save() { return 2 } },
}
</script>

<script setup lang="ts">
// The inline type-literal form, including an index signature — neither is a
// member name any caller can pass.
const props = defineProps<{ plainInline: string; [key: string]: any; [dyn]: any }>()
const emits = defineEmits<{ (e: 'plain-event'): void; (e: 'bare-event'): void }>()
</script>

<template><div /></template>
