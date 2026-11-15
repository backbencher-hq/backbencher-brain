<template>
  <div v-for="item in items">{{ item.id }}</div>
</template>
<script>
export default {
  computed: {
    items() { return []; },
    id() { return 0; }
  }
};
</script>
