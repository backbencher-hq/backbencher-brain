<template>
  <div @click="go('save')" :title="`${a}b`" />
</template>
<script>
export default {
  props: ["a"],
  methods: {
    go(x) {},
    save() {}
  }
};
</script>
