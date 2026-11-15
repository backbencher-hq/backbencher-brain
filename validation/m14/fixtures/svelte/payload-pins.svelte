<script>
/**
 * Increments the counter.
 */
export function increment(by: number) {
  if (by > 1) { return by }
  return by + 1
}
</script>

<span>{increment(1)}</span>
