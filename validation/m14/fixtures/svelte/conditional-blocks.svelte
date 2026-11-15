<script lang="ts">
  let loading: boolean = false
  let error: string | null = null
</script>

{#if loading}
  <p>Loading...</p>
{:else if error}
  <p class="error">{error}</p>
{:else}
  <slot />
{/if}
