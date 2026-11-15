<!-- fixture: svelte/renders-component-tags
     The extended value `renders` is the SFC TEMPLATE relation (2026-10-23). Three template shapes
     emit it — plain tag, dotted-namespace tag, dynamic `this=` on svelte:component — and
     `instantiates` keeps its OWN sites: the script-block delegate's `new`. BOTH directions are
     pinned, so a migration that renames both sides, or neither, is caught:
       - a template tag MUST publish `renders` and MUST NOT publish `instantiates`;
       - a script `new` MUST publish `instantiates` and MUST NOT publish `renders`.
     The dotted tag resolves through an `import * as` binding, and the dynamic target must be an
     IMPORT-BOUND identifier: a member-resolved `this=` deliberately emits `uses` instead (H2). -->
<script lang="ts">
  import Card from './Card.svelte'
  import Widget from './Widget.svelte'
  import * as Panel from './Panel.svelte'

  class Model {
    constructor() {}
  }
  const model = new Model()
</script>

<Card />
<svelte:component this={Widget} />
<Panel.Root />
<div>{model ? 'plate' : 'other'}</div>
