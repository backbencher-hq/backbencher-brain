<script setup lang="ts">
import { provide, inject } from 'vue'
import { themeKey, apiKey } from './keys'

// ── PROVIDE: the key is an IDENTIFIER (the corpus's shape: element-plus writes
// `provide(anchorKey, …)` in 79 sites and a string key in none), so the contract
// is an edge to a declaration this file does not own — the same shape as F12's
// named contract, and for the same reason.
provide(themeKey, { mode: 'dark', enabled: true })

// The value's own keys are this component's CONTRIBUTION, so they are its
// members — and they are already emitted by the sub-analyzer as unowned
// methods. They are annotated, not duplicated: the store's symbol key excludes
// owner, so a second symbol at the same name and line would silently replace the
// first (measured, VSD25).
provide(apiKey, {
  save() { return 1 },
  load() { return 2 },
})

// ── INJECT: a dependency on another component's provide. Same edge shape, and
// the two halves of one key are joinable in the graph by key name.
const theme = inject(themeKey)
const themeWithDefault = inject(apiKey, undefined)
</script>

<template>
  <div>{{ theme }}</div>
</template>