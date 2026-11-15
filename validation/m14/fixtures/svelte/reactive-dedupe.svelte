<script lang="ts">
  export let count: number = 0;
  let doubled = 0;
  let total = 0;

  // The SAME reactive target is assigned from multiple $: blocks —
  // `doubled` and `total` must each be declared EXACTLY once as
  // component state, not once per block.
  $: doubled = count * 2;
  $: if (count > 10) {
    doubled = count;
  }
  $: total = doubled + count;
</script>

<span>{count} {doubled} {total}</span>
