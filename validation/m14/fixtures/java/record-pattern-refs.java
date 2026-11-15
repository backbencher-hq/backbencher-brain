public class RecordPatternRefs {
    record Point(int x, int y) {
    }

    record Box<T>(T value) {
    }

    void f(Object o) {
        if (o instanceof Point(int a, int b)) {
        }
        if (o instanceof Box<String>(String s)) {
        }
    }
}
