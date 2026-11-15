<!-- fixture: svelte/props-rename-lines
     M59 (#825) follow-up: a `$props()` rename destructure binds the VALUE
     (`let { renamed: local }` binds `local`) — the old key-side naming
     emitted a phantom Property `renamed` AND defeated the merge dedupe (the
     JS delegate's correct `local` survived alongside it). Each binding also
     ranges at its own NAME line, not the whole declarator. -->
<script>
  let {
    renamed: local,
    plain,
  } = $props();
</script>

<p>{local} {plain}</p>
