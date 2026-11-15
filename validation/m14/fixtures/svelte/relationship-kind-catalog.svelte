<script>
import { readable } from 'svelte/store'
export let label = "x"
class Base { run() {} }
class Derived extends Base {
  run() { super.run() }
}
const state = readable(0)
const box = { open: () => {} }
</script>

<Card title={label} on:click={box.open}>{state}</Card>
