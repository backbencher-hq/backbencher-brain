<script setup lang="ts">
import { ref } from 'vue';
const count = ref(0);
const label = ref('x');
const show = ref(true);
function onSave() {}
</script>

<template>
  <!-- F6 coverage: template comment node exercised (handled_verified) -->
  <div class="card" v-if="show">
    <span>{{ count }}</span>
    <MyButton :label="label" @click="onSave" />
    <input v-model="count" />
  </div>
</template>
