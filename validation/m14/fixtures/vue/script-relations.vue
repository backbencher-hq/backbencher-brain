<script setup lang="ts">
import { helper } from './helper';
import Widget from './widget.vue';

function read() {
  return 1;
}

function main() {
  read();
  helper();
}

export const api = 1;
</script>

<script setup>
import { ref } from 'vue';

class Base {
  render() {}
}

class Derived extends Base {
  render() {}
  own() {}
}

const state = { value: 1 };

function useField() {
  return state.value;
}
</script>

<template>
  <div v-if="state.value > 0">
    <Widget />
  </div>
</template>
