<script setup>
import { ref } from 'vue';

const count = ref(0);

function fire(a, b) {
  if (a) {
    while (b) {
      b--;
    }
  }
  return count.value;
}

function plain(x) {
  return x;
}
</script>

<template>
  <div v-if="count > 0" v-for="i in items" :key="i">
    <span>{{ count }}</span>
  </div>
</template>
