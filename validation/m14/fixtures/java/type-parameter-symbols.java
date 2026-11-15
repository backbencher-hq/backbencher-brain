import java.util.List;
import java.util.Map;

public class Cache<K, V extends Comparable<V>> {
    private final Map<K, List<V>> store;
    private K miss;

    public <T extends Number> T pick(T left, T right) {
        return left;
    }

    public K key() {
        return null;
    }

    static class Bucket<E> {
        E value;
    }

    interface Fn<A, R> {
        R apply(A argument);
    }
}
