// M60 R10 draw check: is `crates/cargo-test-support/src/lib.rs` (the file that
// carries rust's impl-target `references` edges) ever in the census's draw?
// The census's draw is deterministic (sorted, every k-th file) but a lane whose
// violation lives in ONE file out of 1,371 reads clean for as long as that file
// is not drawn — which is a property of the DRAW, not of the lane.
//
// Run: bun script/m14/tmp/rust-798-draw-check.ts
import { filesFor } from "../../m60/target-spelling-census"

const FILE = "<corpus-root>/bb_tests/repositories/cargo/crates/cargo-test-support/src/lib.rs"
for (const cap of [40, 60, 240, 400, 700, 1400]) {
  const draw = filesFor("rust", "cargo", cap)
  const hit = draw.indexOf(FILE)
  console.log(`cap=${String(cap).padStart(4)} drawn=${String(draw.length).padStart(4)} ${hit >= 0 ? `HIT at index ${hit}` : "absent"}`)
}
