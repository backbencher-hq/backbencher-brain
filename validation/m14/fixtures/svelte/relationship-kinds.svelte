<script lang="ts">
import { helper } from './helper';
import Widget from './Widget.svelte';

class Base {
  render() {}
}

class Derived extends Base {
  override render() {}
}

export let title: string = 't';

const state = { value: 1 };

function useField() {
  return state.value;
}

/** Increments the counter by one. */
export function increment(n: number) {
  if (n) {
    return n + 1;
  }
  return 0;
}

function main() {
  helper();
  increment(1);
  useField();
}
</script>

<script>
import { show } from './show';
const box = { open: false };
function toggle() {
  return box.open;
}
</script>

<template>
  <div>
    <span>{title}</span>
    <Widget />
  </div>
</template>