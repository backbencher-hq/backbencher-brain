#include <stdlib.h>

void runner(void) {
    char *p = malloc(10);
    free(p);
}
