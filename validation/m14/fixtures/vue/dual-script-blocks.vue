<template><div/></template>
<script>
export default { name: 'BaseCard' }
</script>
<script setup>
import { ref } from 'vue'
const count = ref(0)
function bump() {
  if (count.value > 9) count.value = 0
}
</script>
