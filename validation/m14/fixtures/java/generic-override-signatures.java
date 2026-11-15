class Base<Value> {
    void save(Value value) {}
}

class Child extends Base<String> {
    void save(Integer value) {}
}

class MatchingChild extends Base<String> {
    void save(String value) {}
}

class Intermediate<Item> extends Base<Item> {}

class IndirectChild extends Intermediate<String> {
    @Override void save(String value) {}
}

class Shadowed<Value extends Number> extends Base<String> {
    void save(Value value) {}
}

class SingleLetterBase<T> {
    void save(T value) {}
}

class SingleLetterChild extends SingleLetterBase<String> {
    void save(Integer value) {}
}
