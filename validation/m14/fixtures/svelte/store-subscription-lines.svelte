<!-- fixture: svelte/store-subscription-lines
     Master review (recall): Svelte store auto-subscription — `{$count}`
     reads the VALUE of the `count` store member. The `$`-prefixed template
     name resolves through the sigil to a member of that name (exact matches
     win first; `$$` legacy specials never strip). Line is where `$count` is
     written. -->
<script>
  import { writable } from "svelte/store";

  const count = writable(0);
</script>

<p>{$count}</p>
