// Valid Java 21: unbounded alpha-equivalent method parameters and returns.
interface GenericInterface {
    <T> T id(T value);
    <T> void consume(java.util.List<T> values);
    <T> T[] copy(T[] values);
}
class GenericImpl implements GenericInterface {
    @Override public <U> U id(U value) { return value; }
    @Override public <V> void consume(java.util.List<V> values) {}
    @Override public <W> W[] copy(W[] values) { return values; }
}
class GenericParent<R> {
    <T> R wrap(T t) { return null; }
}
class GenericSub extends GenericParent<String> {
    @Override <U> String wrap(U u) { return ""; }
}
class ShadowParent<T> {
    <T> T take(T t) { return t; }
}
class ShadowSub extends ShadowParent<String> {
    @Override <U> U take(U u) { return u; }
}
class DifferentOverloadParent {
    <T> void use(T item) {}
}
class DifferentOverloadSub extends DifferentOverloadParent {
    void use(String item) {}
}
