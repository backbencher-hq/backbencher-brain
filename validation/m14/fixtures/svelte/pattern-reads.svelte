<!-- fixture: svelte/pattern-reads
     A template BINDING PATTERN has read positions and binding positions, and the
     flat word collector could not tell them apart. Every word in
     `{#each … as …}`, `{#await … then …}`, `{#snippet …( … )}` and a Svelte 5.36
     `{let … = …}` / `{@const … = …}` head used to land in the SHADOW set, which
     did two wrong things at once:

       a LOST READ     `{#snippet counter(c = count)}` binds `c` and READS the
                       member `count`;
       a FALSE SHADOW  `{#each xs as { a: b }}` binds `b` — `a` is a PROPERTY
                       NAME, never a binding, so registering it silenced a member
                       named `a` for the whole block.

     Measured before this fix over the 6,439-file corpus (svelte 4,561 +
     shadcn-svelte 1,878 git-tracked .svelte files): the grammar-derived oracle
     (`script/m14/tmp/svelte-uses-oracle.ts`, which re-parses each template
     fragment with the JAVASCRIPT grammar and so decides the binding/read split
     from `assignment_pattern.right` and `computed_property_name` rather than from
     a character walk) named 35 template reads the payload does not publish, of
     which 27 are this class. A pattern probe counted 81 sites carrying a computed
     key or a default value.

     Every shape below is one the corpus actually writes, named in the pins:
       runtime-runes/snippet-complicated-defaults      `c = count`
       runtime-runes/snippet-default-arg               `id = default_arg()`
       runtime-legacy/each-block-destructured-object-computed-props
                                                        `[firstString]: firstProp`
       runtime-legacy/const-tag-each-destructure-computed-in-computed
                                                        `[`leng${th}`]: length`
       runtime-runes/each-keyed-computed-destructuring-key
                                                        `[labelKey]: label`
       runtime-legacy/each-block-destructured-default  the full shape: a rename
                                                        key, a literal default, a
                                                        default naming a member, a
                                                        default reading an
                                                        already-bound name, and a
                                                        trailing rest
       runtime-runes/snippet-typescript                 `c: number = 4`

     A default value is an EXPRESSION, so it is read by the ordinary character
     collector: strings inside it stay opaque (`value = "hello"` reads nothing) and
     a member chain's receiver is read while its leaf is not. A name already bound
     earlier in the SAME pattern is not a read — `{ length, [length - 1]: last }`
     reads nothing, because `length` is a template-local by then. That ordering
     rule is the one that would silently lose TRUE edges if it were wrong, so it
     is pinned explicitly. -->
<script>
  let count = 0
  let th = 'x'
  let firstString = 'a'
  let labelKey = 'k'
  let defaultHeight = 10
  let default_arg = 1
  let pick = (x) => x
  let items = []
  let rows = []
  let promise = Promise.resolve({})
  let length = 3
  let obj = { a: 1, b: 2 }
  let key = "k"
  let idx = 0
</script>

<!-- 1. a snippet parameter default reads a member -->
{#snippet counter(c = count)}{c}{/snippet}
{@render counter()}

<!-- 2. a snippet parameter default that CALLS a member: a read, not a call -->
{#snippet withDefault(id = default_arg())}{id}{/snippet}
{@render withDefault()}

<!-- 3. computed keys in an each pattern are reads; the VALUES bind -->
{#each rows as { [firstString]: firstProp, [labelKey]: secondProp }}
  <li>{firstProp}{secondProp}</li>
{/each}

<!-- 4. a computed key built from a template literal reads its INTERPOLATION -->
{#each rows as { [`leng${th}`]: length2, [`wid${th}`]: width }}
  <li>{length2}{width}</li>
{/each}

<!-- 5. the full shape: rename key, literal default, member default, rest -->
{#each items as { animal, species = 'unknown', kilogram: weight = 50, height = defaultHeight, ...props }}
  <li>{animal}{species}{weight}{height}{props.kind}</li>
{/each}

<!-- 6. an await THEN pattern: computed key reads, value binds -->
{#await promise then { [`leng${th}`]: l, [`wid${th}`]: w, height: h }}
  <li>{l}{w}{h}</li>
{/await}

<!-- 7. a name bound earlier in the SAME pattern is not a read -->
{#each rows as { idx, [idx - 1]: last }}
  <li>{idx}{last}</li>
{/each}

<!-- 8. a TypeScript parameter annotation names a TYPE, not a read or a binding -->
{#snippet typed(c: number = 4, d?: string = 'x')}{c}{d}{/snippet}
{@render typed()}

<!-- 9. a Svelte 5.36 declaration tag head is a pattern too -->
{@const { [labelKey]: bound = pick(obj.a) } = obj}
<li>{bound}</li>

<!-- 10. a literal default reads nothing -->
{#each rows as { value = "hello" }}<li>{value}</li>{/each}