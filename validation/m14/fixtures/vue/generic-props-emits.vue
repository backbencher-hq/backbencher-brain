<script setup lang="ts">
const props = defineProps<{ id: string; label?: string }>();
const emit = defineEmits<{ (e: 'save', id: string): void; (e: 'close'): void }>();
</script>

<template>
  <div>{{ id }}</div>
</template>
