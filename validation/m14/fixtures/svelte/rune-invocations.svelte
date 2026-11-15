<script>
  import { basicEffect, onEffect, preEffect, preTeardown, onRoot, onUntracked, byFn, hostFn, inlineCall, memberFn } from "./f.js"

  let count = $state(0)
  let open = $bindable("")
  let doubled = $derived(count)
  let obj = { m() {} }
  function $myHelper(x) { return x }

  $effect(basicEffect)
  $effect.pre(preEffect, preTeardown)
  $effect.root(onRoot)
  $effect.untracked(onUntracked)
  $derived.by(byFn)
  $host(hostFn)

  $effect(inlineCall())
  $effect(() => {})
  $effect(memberFn.m)
  $effect.tracking()
  $state(1)
  $myHelper(onEffect)
</script>

<button on:click={onEffect}>{doubled}</button>
