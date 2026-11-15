<template>
  <article class="card">
    <h2>{{ title }}</h2>
    <p>{{ body }}</p>
  </article>
</template>

<script lang="ts">
export default {
  name: 'Card',
  props: {
    title: { type: String, required: true },
    body: { type: String, default: '' }
  },
  emits: ['select'],
  data() {
    return {
      expanded: false
    }
  },
  computed: {
    summary() {
      return this.title.slice(0, 10)
    }
  },
  methods: {
    toggle() {
      this.expanded = !this.expanded
    },
    handleSelect() {
      this.$emit('select', this.title)
    }
  },
  mounted() {
    this.toggle()
  }
}
</script>
