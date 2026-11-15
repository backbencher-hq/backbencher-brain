class Foo {}
const bar: unknown = { a: 1 };
const a = <Foo>bar;
const b = bar as Foo;
