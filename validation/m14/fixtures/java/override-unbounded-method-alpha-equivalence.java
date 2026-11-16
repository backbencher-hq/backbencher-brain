// Compiler-valid Java 21: unbounded method type parameters may be alpha-renamed.
interface Transformer {
    <T> T identity(T value);
    <T> void consume(java.util.List<T> values);
    <T> T[] copy(T[] values);
}
class TransformerImpl implements Transformer {
    @Override public <U> U identity(U value) { return value; }
    @Override public <V> void consume(java.util.List<V> values) {}
    @Override public <W> W[] copy(W[] values) { return values; }
}
class GenericBase<R> {
    <T> R wrap(T value) { return null; }
}
class GenericChild extends GenericBase<String> {
    @Override <U> String wrap(U value) { return "ok"; }
}
class ShadowBase<T> {
    <T> T take(T value) { return value; }
}
class ShadowChild extends ShadowBase<String> {
    @Override <U> U take(U value) { return value; }
}
// Overloading rather than overriding.
class WrongBase {
    <T> void choose(T value) {}
}
class WrongChild extends WrongBase {
    void choose(String value) {}
}
