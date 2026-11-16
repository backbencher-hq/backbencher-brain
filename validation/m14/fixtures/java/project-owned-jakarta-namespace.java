package jakarta.project;

class Owned {
    static void work() {}
}

class Consumer {
    void run() {
        Owned.work();
        jakarta.project.Owned.work();
        new jakarta.project.Owned();
    }
}
