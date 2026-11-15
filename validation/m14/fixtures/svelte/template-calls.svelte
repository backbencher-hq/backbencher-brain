<!-- M37.21 #611 svelte template-calls contract fixture.
     The template pass emits calls the embedded-script trees cannot express:
       on:click={inc}          -> inc    (bare identifier value)
       on:submit={() => save()} -> save   (first call-target inside arrow)
       on:click={box.open}     -> open   (dotted member leaf = callable leaf)
       {@render row(item)}     -> row    (declared snippet, render site)
       {@render children?.()}  -> children (props snippet, render site)
       {@render helpers.row(it)} -> row  (dotted render leaf = callable leaf,
                                 Sv2 #736-D4; helpers itself is never called)
     The oracle mirrors each of these (template truth + rune-member mirror), so any
     analyzer drop surfaces as MISSING and any analyzer fabrication as
     UNEXPLAINED in the F5 svelte lanes. -->
<script lang="ts">
let { children, row }: { children?: any; row?: any } = $props()
let count = $state(0)
const box = { open: () => {} }
const helpers = { row: (x: any) => {} }
function inc() { count++ }
function save() {}
</script>

<button on:click={inc}>{count}</button>
<form on:submit={() => save()}></form>
<div on:click={box.open}>open</div>
<table>
  {#snippet rowc(item)}
    <td>{item}</td>
  {/snippet}
  {#each [1, 2] as it}
    {@render row(it)}
  {/each}
</table>
{@render children?.()}
{@render helpers.row(1)}
