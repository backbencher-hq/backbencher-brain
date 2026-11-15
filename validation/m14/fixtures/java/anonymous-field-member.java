// M49/M37 #866 java fixture. Pins the family convention that kotlin and scala
// were measured to violate: a FIELD member declared inside an anonymous class
// body (`new Runnable() { int field = target(); }`) is a symbol owned by the
// ANONYMOUS type, and the call made from its initialiser is attributed to that
// type. The `local` control pins the other half of the same boundary — a
// method-local is NOT a project symbol — so a fix that widened the boundary
// past the anonymous body is caught here rather than silently accepted.

class AnonField {
    int target() { return 1; }
    void build() {
        int local = target();
        Runnable r = new Runnable() {
            int field = target();
            public void run() { target(); }
        };
        r.run();
    }
}
