<!-- fixture: svelte/object-key-not-a-read
     An object-literal KEY is not a member read. `{ month: d.desktop }` WRITES
     `month`; `{ foo }` READS it; `{ [k]: v }` reads `k`. The flat character
     walker could not tell them apart and published both.

     Measured over the 6,439-file corpus (svelte@020242d6 4,561 +
     shadcn-svelte@3ef557c8 1,878), intersecting the published template-`uses`
     edges with a per-SITE role derived from a REAL parse of each expression:
     49 edges in 38 files named a key the template never reads. Named examples:
     runtime-runes/samples/inspect-recursive/main.svelte:29 published `x` and
     `y` out of `new Node({x: …, y: …})`;
     runtime-runes/samples/clsx/main.svelte published `foo`/`bar` out of
     `class={{ foo: true, bar: false }}`;
     shadcn-svelte/docs/src/lib/registry/blocks/chart-pie-stacked.svelte
     published `tooltip`, `month` and `value` out of a Recharts config object —
     and `tooltip` RESOLVED, because the same file declares `{#snippet tooltip()}`,
     which is the worst case: the false edge binds to a real symbol.

     The rule has to be ternary-aware, because `? :` and `: ` are the same
     character: `cond ? alpha : beta` reads BOTH names, and only a `:` with no
     pending `?` at object-literal depth is a key. That is what `ternary` below
     pins, and it is why this fixture is not satisfied by "skip anything before
     a colon".

     `spread` is the other half. `[...foo]` and `f(...foo)` are READS, and the
     receiver-only dot rule suppressed them because the token before `foo` is a
     dot — runtime-legacy/samples/array-literal-spread-deopt published `uses rows`
     and nothing for `foo`. -->
<script>
  let foo = 1
  let bar = 2
  let month = 3
  let k = "key"
  let v = "value"
  let alpha = 4
  let beta = 5
  let cond = true
  let list = []
  let rows = []
</script>

<!-- a KEY: written, never read -->
<div class={{ foo: true, bar: false }}></div>
<div data-config={{ month: "january" }}></div>

<!-- a SHORTHAND property: a read -->
<div class={{ foo, bar }}></div>

<!-- a COMPUTED key: the bracket contents are read, the key word is not -->
<div data-config={{ [k]: v }}></div>

<!-- a ternary: both arms are reads -->
<div>{cond ? alpha : beta}</div>
<div>{cond ? foo : bar}</div>

<!-- a NESTED ternary inside an object: only the outer colons separate keys -->
<div data-config={{ month: cond ? alpha : beta }}></div>

<!-- a SPREAD argument is a read -->
{#each [...list] as item}
  <li>{item}</li>
{/each}
<div>{rows.length}</div>

<!-- the member LEAF is still not a read -->
<div>{foo.toFixed(2)}</div>