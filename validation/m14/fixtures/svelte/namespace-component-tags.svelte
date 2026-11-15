<script lang="ts">
	import * as Card from './card';
	import * as Unused from './unused';
	import { alpha as renamed } from './beta';
	import Plain from './Plain.svelte';

	let picked: unknown = Card.Root;
	let items = [{ icon: Card.Root, label: 'a' }];
	let active = $derived(items[0]);
</script>

<!-- NAMESPACE-QUALIFIED TAGS. Svelte reads the namespace OBJECT bound to `Card`,
     so the component is a member of an import-bound namespace. -->
<Card.Root>
	<Card.Header />
	<Card.Root />
</Card.Root>

<!-- A DYNAMIC target in the same namespace, and the renamed-import binding. -->
<svelte:component this={Card} />
<svelte:component this={renamed} />

<!-- An ordinary tag: unaffected by any of the above. -->
<Plain />
<div class="card.root">not a tag</div>

<!-- A TEMPLATE-LOCAL namespace: `{#each}` declares `entry`, and `<entry.icon/>`
     is a legal Svelte DYNAMIC component. `entry` is not an import, so an
     import-only rule would drop this edge — and the 400-file differential
     reported 12 such drops in its shadcn-svelte sample before this row existed. -->
{#each items as entry}
	<entry.icon />
{/each}

<!-- A SCRIPT-SIDE namespace: `active` is declared state, so `<active.icon/>`
     reads a component held in a runtime value. Neither an import nor a
     template-local, and legal Svelte — an import-only rule and a
     import-or-local rule both drop it. Found by the differential on
     `data-table-status-cell.svelte:11` (`const status = $derived(...)`). -->
{#if active}
	<active.icon />
{/if}

<!-- NOT IMPORTED. Svelte cannot resolve `Ghost.Body` — the compiler rejects the
     file — so this names nothing and must publish nothing. -->
<Ghost.Body />