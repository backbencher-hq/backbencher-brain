<script lang="ts">
import { onMount } from 'svelte';

export let count: number = 0;
export let label = 'x';
const rows = [1, 2, 3];
const limit = 2;
const raw = '<b>x</b>';
const promise = Promise.resolve(1);
const state = { value: 1 };

function inc() {
  count += 1;
}
</script>

<template>
  <div>
    <span>{count}</span>
    <MyButton text={label} on:click={inc} />
    <div>{state.value}</div>
    {#if count > 0}
      <b>yes</b>
    {/if}
    {#each rows as row, i}
      <p>{row} {i} {count}</p>
    {/each}
    {#await promise then value}
      <p>{value}</p>
    {:catch err}
      <p>{err}</p>
    {/await}
    {#key limit}
      <span>{limit}</span>
    {/key}
    {@html raw}
    {@debug count}
    {@const total = rows.length}
    <svelte:component this={inc} />
  </div>
</template>