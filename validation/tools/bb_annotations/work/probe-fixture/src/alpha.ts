// Audit fixture for bb_annotations: shapes the annotation read door must
// distinguish — a name-level note vs a file-scoped note, a symbol name that
// lives in several files, and a qualified name (method under a class) that the
// editor accepts as a second name form.
export class Widget {
  render(): string {
    return "render"
  }

  layout(): string {
    return "layout"
  }
}

export function buildThing(): Widget {
  return new Widget()
}

export function duplicate(): number {
  return 1
}
