<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{ title: string }>()
const emit = defineEmits<{ (e: 'save'): void }>()

const count = ref(0)
const doubled = computed(() => count.value * 2)

function save() {
  emit('save')
}
</script>

<template>
  <div class="card" v-if="count > 0">
    <span>{{ title }}</span>
    <button @click="save">{{ doubled }}</button>
    <ChildCard :value="doubled" />
  </div>
</template>
