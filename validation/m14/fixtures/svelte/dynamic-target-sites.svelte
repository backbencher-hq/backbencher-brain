<!-- fixture: svelte/dynamic-target-sites
     `<svelte:component this={X}>` and `<svelte:element this={X}>` name a dynamic
     component reference, and one name can be written at SEVERAL sites. The
     collection map was `Map<name, line>`, so the second write silently replaced
     the first and every earlier site was unrecoverable from the payload — the
     EDGE was right, which is why no gate saw it.

     Measured over the 6,439-file corpus (svelte 4,561 + shadcn-svelte 1,878
     git-tracked .svelte files): 125 bare-identifier `this={X}` sites in 73 files,
     of which **11 files write one name at more than one site and 36 sites
     collapse** (`svelte-component/input.svelte` writes `Component` 11 times and
     `stuff` 8 times in one file).

     `line_number` keeps the LAST site exactly as before — no field a shared
     payload baseline pins moves — and the full set travels in
     `metadata.dynamicTargetLines`, the same additive shape the template-read map
     uses. `instantiates` is inside the differential's COMPARED set, so the
     assertion that matters is the one below: the edge COUNT is unchanged, which is
     what a compared-label baseline reads. -->
<script>
  import Widget from "./Widget.svelte";
  import Panel from "./Panel.svelte";
</script>

<svelte:component this={Widget} />
<svelte:component this={Widget} />
<svelte:component this={Widget} />

<div>
  <svelte:component this={Panel} />
</div>

<svelte:element this={Widget} />
