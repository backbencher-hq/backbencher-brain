<template>
  <div>{{ count }}</div>
  <div>{{ total }}</div>
</template>
<script>
export default {
  data: { count: 0 },
  computed: {
    total() { return this.count; }
  }
};
</script>
