<!-- fixture: svelte/dedupe-template-read-record
     The lane's DEDUPE keys on `type|source|target`, and the script delegate's
     rows are pushed BEFORE the template read pass runs. So when a component
     reads the same member in its SCRIPT and in its TEMPLATE, the template read
     is the row that loses — and before this it lost SILENTLY: the surviving
     edge carried the script's line, the script's 0.6 confidence, and no
     `isTemplateExpression`, so a consumer could not tell a template read from a
     script one.

     Measured on the 3,085 corpus files where an independent read oracle's shadow
     model is provably equivalent to this analyzer's (no `{#each}`, `{#await}`,
     `{#snippet}` or `{@const}` anywhere in the file): 384 of 5,781 template
     reads, 6.6%, were dropped this way, and every one had a script twin.

     One edge per pair is the lane's GRAPH contract and is not changed here. What
     changes is that the dropped site is recorded: the surviving edge gains
     `metadata.templateReadLines` and `metadata.isTemplateRead`. `line_number`
     and `confidence` are deliberately untouched, so no field a baseline pins
     moves.

     `solo` is the control: a member read ONLY in the template still gets its own
     0.95 `isTemplateExpression` row, because there is nothing to collide with. -->
<script>
  let count = 0
  let onlyTemplate = 1
  $: doubled = count * 2
</script>

<p>{count}</p>
<p>{doubled}</p>
<p>{onlyTemplate}</p>