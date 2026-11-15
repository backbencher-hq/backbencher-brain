<!-- fixture: svelte/svg-filter-builtin-tags
     The vue twin of this fixture (vue/modern-html-svg-builtin-tags) carries the
     measurement: 441 fabricated `instantiates` edges over that lane's 1,162-file
     draw, 377 of them pointing at nothing and 64 pointing at a symbol SOME OTHER
     FILE publishes — markup that looked like a resolved component usage.

     This lane has the same tag vocabulary and therefore the same gap by
     construction; what it needs is its own pin, because the parity gate
     (script/m14/verify-cross-language-consistency.ts) only proves the two tag
     SETS are identical. It cannot prove that either analyzer USES its set on a
     `<filter>` chain — a bug in the filter call site would leave the sets equal
     and this fixture is where that shows up.

     `Child` is the over-suppression guard: the real component in the same
     template must still publish `instantiates`. -->
<script>
  import Child from "./Child.svelte"
</script>

<svg viewBox="0 0 10 10">
  <defs>
    <linearGradient id="g1"><stop offset="0" /></linearGradient>
    <clipPath id="c1"><rect width="4" height="4" /></clipPath>
    <filter id="f1">
      <feGaussianBlur stdDeviation="2" />
      <feFlood flood-color="#000000" />
      <feColorMatrix type="saturate" values="0.2" />
      <feOffset dx="1" dy="1" />
      <feBlend mode="normal" in="SourceGraphic" />
      <feComposite operator="over" />
    </filter>
    <textPath href="#p1" />
    <animate attributeName="x" />
  </defs>
  <use href="#g1" />
</svg>

<Child />
