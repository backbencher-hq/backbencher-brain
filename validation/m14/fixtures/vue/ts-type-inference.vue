<script setup lang="ts">
// F7: `hasTypeInference` must describe what the pipeline DID, not a constant.
// This block is dispatched to the TypeScript analyzer, so type inference was
// available for this file — and the analyzer already extracts it: `Props` and
// `size` below come from the TS grammar, and `p: Props` is a real annotation.
interface Props { size?: number }
const p: Props = { size: 1 }
</script>

<template>
  <div>{{ p.size }}</div>
</template>