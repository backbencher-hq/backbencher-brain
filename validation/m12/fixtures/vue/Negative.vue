<template>
  <div class="page">
    <span>{{ user.name }}</span>
    <p v-if="visible" :class="cls">{{ message }}</p>
    <input v-model="query" @input="onInput" />
    <button v-for="opt in options" :key="opt">{{ opt }}</button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const user = ref({ name: 'anon' })
const visible = ref(true)
const query = ref('')
const options = ['a', 'b']
const cls = 'x'
let message = 'hello'
var legacy = 1

function onInput(e: Event) {
  message = (e.target as HTMLInputElement).value
}

function localOnly() {
  const tmp = 42
  return tmp
}

defineProps<{ title: string }>()
</script>
