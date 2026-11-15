<template>
  <!-- M37.21 #611 builtin-drift contract: <search> is a MODERN native HTML
       element (2023 spec) and the camelCase SVG tags (linearGradient,
       clipPath, mask, pattern, marker, symbol) are native SVG. None of them
       may surface as component instantiates — the analyzer's builtin filter
       covers them, and the F5 oracle's ORACLE_HTML_TAGS carries the SAME
       list (pre-fix: the oracle's shorter set faked a MISSING
       instantiates->search in vue-element-admin Navbar.vue). -->
  <search class="finder" />
  <svg viewBox="0 0 10 10">
    <defs>
      <linearGradient id="g1"><stop offset="0" /></linearGradient>
      <clipPath id="c1"><rect width="4" height="4" /></clipPath>
      <mask id="m1"><circle cx="2" cy="2" r="1" /></mask>
      <pattern id="p1"><path d="M0 0 L1 1" /></pattern>
      <marker id="k1" /><symbol id="s1" />
    </defs>
  </svg>
  <FreshWidget />
</template>

<script setup lang="ts">
import FreshWidget from './FreshWidget.vue'
</script>
