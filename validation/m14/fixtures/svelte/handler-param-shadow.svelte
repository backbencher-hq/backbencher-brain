<!-- fixture: svelte/handler-param-shadow
     An event handler's own arrow PARAMETERS are template-local, and reading them
     as component members publishes a dangling endpoint: nothing in the template
     scope declares them.

     Measured: exactly 1 corpus edge in 6,439 files —
     packages/svelte/tests/compiler-errors/samples/store-template-expression-scope/
     main.svelte, whose handler is `on:click={(store) => { $store = … }}` over a
     component that declares `const store = writable()`. The analyzer published
     `uses -> store` at the handler's line, naming the PARAMETER, while the real
     `$store` read on the next line resolved to the same member and was silently
     deduped away. One edge in the corpus does not make it a position: the fix is
     local (the shadow set is widened per expression, never per block, so nothing
     can leak into a sibling) and the oracle that found it derives the binding set
     from the grammar.

     What this fixture pins, and why each forbid is there:
       - the parameter is never a member read (`store`, `evt`, `payload`)
       - the `$`-sigil read INSIDE the handler body still publishes, and it is the
         one that resolves (`$store` -> `store`): a fix that shadowed the whole
         handler expression would silence it too
       - a bare `on:click={save}` is a CALL target, not a parameterised arrow, so
         it must not be swallowed by the parameter scan
       - a destructured parameter binds its parts: `({ data })` declares `data`
       - the shadow must not escape: `after` outside the handler is a real read
         even though a handler earlier in the file binds `after` as a parameter -->
<script>
  let store = 1
  let save = 2
  let data = 3
  let evt = 4
  let payload = 5
  let after = 6
</script>

<button on:click={(store) => { $store = 1 }}>sigil inside the body</button>

<button on:click={(evt) => { payload = evt }}>param and body</button>

<button on:click={save}>bare identifier is a call target</button>

<button on:click={({ data }) => { payload = data }}>destructured param</button>

<button on:click={(after) => { save = after }}>param named after</button>

<div>{after}</div>