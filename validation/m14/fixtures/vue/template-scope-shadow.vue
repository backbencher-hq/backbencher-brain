<script setup lang="ts">
import { ref } from 'vue';

const item = ref('member item');
const row = ref('member row');
const items = ref([1, 2, 3]);
const index = ref(0);

function rowClick() {}
</script>

<template>
  <div>
    <p v-for="item in items" :key="index">{{ item }}</p>
    <template #default="{ row }">
      <button @click="rowClick">{{ row }}</button>
    </template>
  </div>
</template>
