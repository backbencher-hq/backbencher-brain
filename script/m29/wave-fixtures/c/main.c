#include <stdio.h>
#include <string.h>

struct Greeter {
    char prefix[32];
};

void greeter_init(struct Greeter *g, const char *prefix) {
    strncpy(g->prefix, prefix, sizeof(g->prefix) - 1);
}

void greeter_greet(struct Greeter *g, const char *name, char *out, size_t out_size) {
    snprintf(out, out_size, "%s, %s!", g->prefix, name);
}

int main(void) {
    struct Greeter g;
    greeter_init(&g, "hello");
    char buf[64];
    greeter_greet(&g, "world", buf, sizeof(buf));
    printf("%s\n", buf);
    return 0;
}
