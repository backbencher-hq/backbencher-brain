<!-- fixture: svelte/decorator-metadata-868
     M49 (#868), svelte twin of vue/decorator-metadata-868. The script block
     starts on line 3 here, so the delegated rows must be shifted by 2 — the
     same seam the vue fixture pins, on the other container. With the script on
     line 1 (the shape every earlier svelte fixture uses) the offset is 0 and a
     missing shift is invisible; that is why this fixture puts markup FIRST. -->
<p>{label}</p>
<script>
  function sealed(target) {
    return target
  }

  function inject(name) {
    return () => undefined
  }

  @sealed
  class Service {
    @inject("db")
    pool = 1

    @sealed
    method() {}
  }

  let label = "x"
</script>
