// M49/M37 #867 java fixture. `ownerName` = the innermost enclosing DECLARATION,
// pinned in both contexts so neither can drift: a literal declared inside a
// method is owned by that METHOD, a literal declared as a class-level field is
// owned by the CLASS. Two different supertypes keep the two anonymous types
// unambiguous in the expectation (no duplicate anonymous_Runnable).
// The class-level literal is the control: it agrees with the old kotlin
// behaviour, so a fix that simply moved every anon type onto its method would
// be caught here rather than silently accepted.

class AnonOwner {
    Runnable classLevel = new Runnable() { public void run() { } };

    void inMethod() {
        Comparator<String> local = new Comparator<String>() { public int compare(String a, String b) { return 0; } };
    }
}
