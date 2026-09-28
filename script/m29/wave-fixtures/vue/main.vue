<script setup>
import { ref } from 'vue'

const prefix = ref('hello')

function greet(name) {
  return `${prefix.value}, ${name}!`
}

const message = greet('world')
</script>

<template>
  <p>{{ message }}</p>
</template>
