<script lang="ts">
  import { getData } from './api'
</script>

{#await getData()}
  <p>Loading...</p>
{:then data}
  <p>{data}</p>
{:catch err}
  <p>{err.message}</p>
{/await}
