class Base {
  foo = 1;

  constructor() {}

  ok() { return 0; }
}

class Sub extends Base {
  foo() { return 2; }

  constructor() { super(); }

  ok() { return 1; }

  bar() { return 3; }
}
