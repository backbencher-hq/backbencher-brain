<template>
  <div id="app">
    <header class="app-header">
      <router-link to="/">Home</router-link>
    </header>
    <main>
      <router-view />
    </main>
  </div>
</template>

<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
</script>
