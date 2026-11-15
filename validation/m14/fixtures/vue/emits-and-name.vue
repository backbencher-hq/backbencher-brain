<script lang="ts">
import { defineComponent } from 'vue'

export default defineComponent({
  name: 'NamedWidget',
  props: {
    size: { type: Number, default: 1 }
  },
  emits: ['resize'],
  methods: {
    onResize() {
      this.$emit('resize', this.size)
    }
  }
})
</script>

<template>
  <NamedInner :size="size" @resize="onResize" />
</template>
