<template><div/></template>
<script lang="ts">
// F20 (VUE_FIX, 2026-10-04): the SFC SEAM's delegated class heritage.
//
// WHY THIS FIXTURE EXISTS. The lane's verdict for `implements` and `overrides`
// is "the construct is real and the seam carries it; 0 of 897 script blocks in
// 1,151 corpus .vue files contain it". A RULED verdict whose positive half rests
// on an ad-hoc probe dies with the probe, so the positive half is pinned here
// through the production entry (ASTEngine.parseFile -> extractSfcScriptBlocks ->
// RealTypeScriptAnalyzer -> the seam).
//
// The shapes are the TypeScript family's own, unchanged by this lane:
//   `class X extends Y`            -> extends      (TS delegate)
//   `class X implements I`         -> implements   (TS delegate)
//   a member the base also declares -> overrides, `${sub}.${member}` ->
//                                     `${base}.${member}` (the endpoint
//                                     convention real-typescript-analyzer.ts uses
//                                     and real-javascript-analyzer.ts shares)
//   a member an in-file interface declares -> overrides the same way, against the
//                                     interface (`Shape.area`)
//
// WHAT IT IS NOT is a Vue-specific construct: there is none. A class in an SFC
// script block is ordinary TypeScript, and Vue mounts whatever default export it
// finds. So every row below is the DELEGATE's, arriving through the seam — which
// is exactly what needs pinning, because the seam rewrites the SOURCE of every
// delegated row (F8) and shifts its line (M59 #825).

interface Shape {
  area(): number
}

class Base {
  render(): void {}
}

export default class Widget extends Base implements Shape {
  override render(): void {}
  area(): number { return 1 }
}
</script>