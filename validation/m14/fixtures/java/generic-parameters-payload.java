public class Store<T extends Comparable<T>> {
    private T item;
    protected <R> R map(R value) {
        return value;
    }
}
