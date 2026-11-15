<script lang="ts" module>
	// The Svelte 3/4 shorthand for context="module". Corpus shape:
	// shadcn-svelte's own `sv-addons/registry/template/src/lib/registry/ui/
	// button/button.svelte` opens exactly this, and 21 shadcn-svelte files
	// carry a module block this way.
	export const PALETTE = { a: 1 }
	export function tint(c: number): number {
		return c + 1
	}
</script>

<script lang="ts">
	import { PALETTE } from "./palette.js"
	let count = $state(0)
	export let title: string = "x"
</script>

<span class="text-sm" data-x={PALETTE.a}>{title}{count}</span>