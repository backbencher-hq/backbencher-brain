<script>
  import { probe } from "./p.js"

  let count = $state(0)
  let $order = { scoops() {} }
  let $my = { eager() {}, pending() {} }

  $state.eager(0)
  $effect.pending()
  $state.raw(0)
  $effect.tracking()
  $derived.by(probe)
  $order.scoops(1)
  $my.eager(1)
  $my.pending(1)
</script>

<p>{count}</p>
