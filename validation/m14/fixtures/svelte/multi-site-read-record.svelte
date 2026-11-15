<!-- fixture: svelte/multi-site-read-record
     The collection map is `name -> line[]`, not `name -> line`.

     It was `Map<string, number>`, so `out.set(word, line)` OVERWROTE: a member
     read at N sites kept only the LAST one, and every earlier site was
     unrecoverable from the payload. That is a lossy PROJECTION, not a wrong edge
     — every claimed line is a real read site — which is exactly why no gate saw
     it: a differential compares one edge per pair and the edge was right.

     Measured against the grammar-derived oracle over the 6,439-file corpus:
     2,218 member names are read at more than one site, across 2,354 files, and
     4,273 read sites the payload could not represent at all. The worst shape is
     `{@await}` + `{:then}`, where the same member is read in the promise
     expression and again inside the resolved block — see `promise` below.

     `line_number` deliberately keeps the LAST site, exactly as before, so no
     field a shared payload baseline pins moves; the whole set travels in
     `metadata.templateReadLines`, the same additive-only shape the dedupe
     survivor row already uses. `svelte/dedupe-template-read-record` pins the
     other half of this: a read that lost the dedupe to a SCRIPT twin records its
     template sites on the delegate's row.

     Forbids:
       - every line in `templateReadLines` must actually contain the name. That is
         the property that makes the array worth carrying; a line computed from
         the wrong fragment would satisfy the equality pin and nothing else.
       - `snapped` is read once, so it must NOT carry a list. -->
<script>
  let rows = []
  let total = 0
  let promise = Promise.resolve(1)
  let greeting = "hi"
  let name = "world"
  let snapped = 0
</script>

<div>{total}</div>
<div>{total}</div>
<div class="x">total = {total}</div>

{#await promise then value}
  <p>{value}</p>
{/await}

<p>{greeting} {name}</p>
<p>{greeting}, {name}!</p>

<div>{snapped}</div>