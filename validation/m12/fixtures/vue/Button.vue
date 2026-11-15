<template>
  <button class="btn" :disabled="disabled" @click="emit('click', count)">
    {{ label }}
  </button>
</template>

<script setup>
import { ref, computed } from 'vue'

const count = ref(0)
const isActive = computed(() => count.value > 0)

function onHit(amount) {
  count.value += amount
}

defineProps({
  label: { type: String, required: true },
  disabled: { type: Boolean, default: false }
})

defineEmits(['click'])
</script>
