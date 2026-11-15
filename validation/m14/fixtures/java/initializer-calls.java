public class InitializerCalls {
    static int base = seed();

    static {
        base = seed();
    }

    {
        base = seed();
    }

    static int seed() {
        return 1;
    }

    enum Mode {
        A {
            int value() {
                return seed();
            }
        };

        int x = seed();
    }
}
