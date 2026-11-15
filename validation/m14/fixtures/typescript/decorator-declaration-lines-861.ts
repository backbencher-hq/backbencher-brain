// fixture: typescript/decorator-declaration-lines-861
// M59 (#861). Two contracts on one shape, both about a DECORATED declaration.
//
// 1. THE LINE BELONGS TO THE NAME, NOT THE DECORATOR. In the pinned grammar a
//    decorated declaration's node STARTS AT ITS DECORATOR:
//      @sealed
//      export class Service        export_statement [decorator@18, export@19,
//                                                   class_declaration@19]
//      @inject("db")
//      private pool: unknown       public_field_definition [decorator@20,
//                                                   accessibility_modifier@21, ...]
//    so the symbol's own line, its `exports` line and its `contains` line all
//    named 18/20 — lines that contain `@sealed` / `@inject("db")`, never the name
//    `Service` / `pool`. Method decorators are class_body SIBLINGS rather than
//    children, which is why `method` was already right (24) and is pinned here as
//    the control that says the rule is about the node, not about decorators.
//    The family rule is scala's (scala/declaration-lines-825): a leading
//    annotation is excluded from the range.
//
// 2. A DECORATOR IS METADATA ON THE SYMBOL IT DECORATES, NOT A CALL BY WHOEVER
//    LEXICALLY ENCLOSES IT. Because a decorator is syntactically a call inside
//    the class body, typescript used to emit BOTH `calls Service -> inject` and
//    `references Service -> inject` — a class that appears to call a decorator it
//    never mentions in its body — beside the correct member-scoped
//    `references pool -> inject` that extractDecoratorRelationships emits. The
//    family already rules this way (JVM annotations are metadata; the python
//    oracle documents it as PYD1 and skips the position), so the class-scoped
//    rows are gone and the member-scoped ones remain.

function sealed(target: any): any {
  return target
}

function inject(name: string): any {
  return () => undefined
}

@sealed
export class Service {
  @inject("db")
  private pool: unknown

  @sealed
  method(): void {}
}
