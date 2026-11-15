<script>
function $format(value) {
  return "[" + value + "]"
}
let count = $state(0)
let doubled = $derived.by(() => count * 2)
let shown = $format(count)
</script>

<span>{$format(doubled)}{shown}</span>
