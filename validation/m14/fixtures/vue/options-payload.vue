<template>
  <div @click="save(1)" />
</template>
<script lang="ts">
export default {
  methods: {
    save(id: string): void { this.store(id); }
  }
};
</script>
