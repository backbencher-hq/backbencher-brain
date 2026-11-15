// fixture: typescript/callsite-lines-825
// M59 (#825): typescript had ZERO lines on every relationship before this round
// (measured by the M59 oracle on the pinned 40-file sample: 0 of 2,074). The
// contract pinned here is the JVM family's, transferred whole: a relationship's
// line is the line the NAME it names is written on. Each construct below is
// deliberately SPLIT ACROSS LINES so the wrong answer is a different line:
//   * `import {` on its own line, specifiers on the next two;
//   * `class Worker` on one line, its base on the next;
//   * a call chain that opens on one line and is called on another.
// The wrapped form `new\n  Thing()` is deliberately NOT pinned here: the pinned
// grammar does not parse it as a new_expression at all (probe: the tree is
// `identifier("new")` + a separate `call_expression`), so it loses the
// instantiates edge and fabricates a calls edge. That is a separate finding
// (reviews/m59-web-lines-round.md, #858) about the GRAMMAR, not about lines —
// pinning it here would encode a wrong answer as the expected one.
import {
  readFile,
  writeFile as write,
} from "fs"
import * as path from "path"

interface Base {
  run(): void
}

export class Worker
  extends Base {
  private store = { count: 0 }

  run(): void {
    helper
      .nested
      .doWork()
    const cfg = path.join("a", "b")
    const t = new Thing()
    this.store.count = cfg.length + t.size
  }
}

export class Thing {
  size = 0
}

export function helper(): void {}
