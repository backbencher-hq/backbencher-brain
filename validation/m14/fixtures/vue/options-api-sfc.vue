<script>
export default {
  name: 'LegacyList',
  data() {
    return { items: [], loading: false }
  },
  computed: {
    count() {
      return this.items.length
    }
  },
  methods: {
    reload() {
      this.loading = true
    }
  }
}
</script>

<template>
  <ul v-for="item in items" :key="item">
    <li>{{ item }}</li>
  </ul>
</template>
