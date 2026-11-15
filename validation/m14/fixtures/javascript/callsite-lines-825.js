// fixture: javascript/callsite-lines-825
// M59 (#825): javascript is the largest silent lane in the product — the M59
// oracle measured 0 of 5,818 relationships carrying a line on the pinned 40-file
// sample this round used, and vue (0 of 3,940) and svelte (0 of 526) delegate
// their script block to this analyzer, so one silence blanked three lanes.
// Same contract as the JVM family: the line belongs to the NAME the edge is
// about. The `import {` keyword is on its own line, its specifiers on the next
// two; `export class Worker` is on one line and its base on the next; the call
// chain opens on the receiver and is called two lines later.
import {
  readJson,
  writeJson as write,
} from "./io.js"
import * as helpers from "./helpers.js"

class Base {
  run() {}
}

export class Worker extends Base {
  constructor() {
    super()
    this.store = { count: 0 }
  }

  run() {
    const t = new Thing()
    helpers
      .nested
      .doWork()
    return t.size
  }
}

export class Thing {
  size = 0
}
