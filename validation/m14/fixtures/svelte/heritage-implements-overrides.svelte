<script lang="ts">
  // Positive capability probe for the two relationship types the corpus never
  // produces. Measured over BOTH corpora: shadcn-svelte has 1,893 <script>
  // blocks and ZERO class declarations in any of them (so no `implements`
  // clause and no superclass can exist), and the Svelte repo's own suite is the
  // second corpus. Without this fixture the RULED verdict is unfalsifiable: the
  // moment the delegate stopped emitting these two edges inside an SFC, no
  // check would notice, and the ruling would quietly become a gap.
  //
  // Corpus shape for the positive half: Svelte components that wrap a web
  // component in a class are the realistic way an SFC gets a class at all
  // (shadcn's `registry/ui/toggle/toggle.svelte` and similar build
  // `ToggleGroupContext` / `ToggleVariants` objects; the Svelte suite's
  // `runtime-runes` samples declare class stores).
  interface Shape {
    area(): number
  }

  abstract class Base implements Shape {
    name = "base"
    area(): number {
      return 0
    }
    render(): string {
      return this.name
    }
  }

  class Child extends Base {
    override area(): number {
      return 1
    }
    render(): string {
      return "child"
    }
  }

  class Third extends Child {}

  const c = new Child()
  c.render()
</script>

<Child />
<Third />