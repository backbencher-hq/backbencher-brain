<template>
  <section class="user-list">
    <Card
      v-for="user in users"
      :key="user.id"
      :title="user.name"
      :body="user.bio"
    />
    <Button label="Load more" @click="loadMore" />
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Card from './Card.vue'
import Button from './Button.vue'

const users = ref<Array<{ id: number; name: string; bio: string }>>([])

async function loadMore() {
  const more = await fetch('/api/users')
  users.value = await more.json()
}
</script>
