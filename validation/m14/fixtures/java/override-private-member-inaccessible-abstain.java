package p;

// Deliberately INVALID Java: private types are not inherited by subclasses
// and another same-package top-level class cannot access a private member.
class Ancestor {
    private static class Hidden {
        void ping() {}
    }
}
class Descendant extends Ancestor {
    class Nested extends Hidden {
        @Override void ping() {}
    }
}
class Stranger extends Ancestor.Hidden {
    @Override void ping() {}
}
