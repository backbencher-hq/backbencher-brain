class Base<T> {}

interface IFoo {
    m(): void;
}

class Child extends Base<string> implements IFoo {
    m(): void {}
}
