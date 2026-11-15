<script lang="ts">
// F3: `withDefaults(defineProps<T>(), { … })` is THE documented way to give a
// typed prop a default, and the defaults argument was walked past — the macro
// handler read the defineProps call and never looked one frame up at the
// withDefaults that wraps it. Measured: 98 corpus files declare a default this
// way and every one of them lost it. Three paths, because F12 split them and a
// fix on only one path would be invisible on the corpus, which is 100% the
// NAMED form.
import type { NamedProps } from './props'
// (d) the shape the remaining 16 of 98 corpus files use: the defaults argument
// is an IDENTIFIER imported from a sibling module, so there is no literal to
// read. Resolving it is cross-file work this lane does not do; what it must not
// do is report it as "no defaults".
import { importedDefaults } from './defaults'
import type { NamedProps2 } from './props2'

// (a) the inline type literal — the only path with component-owned prop symbols
const inline = withDefaults(defineProps<{ count?: number; label?: string }>(), {
  count: 0,
  label: 'hi',
})

// (b) a same-file binding, also component-owned (F12's bound resolution)
const localBinding = { bound?: boolean }
const bound = withDefaults(defineProps(localBinding), { bound: true })

// (c) the NAMED form — every one of the 98 corpus files. There is no prop symbol
// to hang a default on, so the map rides the contract edge instead.
const named = withDefaults(defineProps<NamedProps>(), {
  variant: 'text',
  size: 12,
})

// (e) a CALL as the defaults argument — `omit(messageDefaults, 'appendTo')` in
// message.vue. Same category as (d): not a literal, kept as text.
const indirect = withDefaults(defineProps<NamedProps2>(), importedDefaults)
const wrapped = withDefaults(defineProps<{ m?: boolean }>(), omit(wrappedDefaults, 'appendTo'))

export default { name: 'WithDefaultsPropagation' }
</script>

<template><div /></template>
