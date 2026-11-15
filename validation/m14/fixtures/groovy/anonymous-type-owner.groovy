// M49/M37 #867 groovy fixture — the same two contexts as the java twin, so the
// family's ruling is pinned per language rather than assumed from java's.

class AnonOwner {
    Runnable classLevel = new Runnable() { void run() { } }

    void inMethod() {
        Comparator<String> local = new Comparator<String>() { int compare(String a, String b) { 0 } }
    }
}
