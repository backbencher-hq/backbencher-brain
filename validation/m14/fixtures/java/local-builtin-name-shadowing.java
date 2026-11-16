package audit;

// All three calls resolve to project code even though their names resemble
// java.lang types, logging classes, or Object methods.
class Logger { static void audit() {} }
class String { static void custom() {} }
class App {
    void equals(int value) {}

    void run() {
        Logger.audit();
        String.custom();
        equals(3);
        System.out.println("platform");
        java.util.Objects.requireNonNull(this);
    }
}
