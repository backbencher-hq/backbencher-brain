// validation/m12/fixtures/c/Module.h
// M12.16 C positive fixture: header with declarations, structs, unions,
// enums, typedefs, function pointers, macros, include guard.
#ifndef MODULE_H
#define MODULE_H

#include <stddef.h>
#include "module_config.h"

#define MAX_BUFFER 256
#define MIN(a, b) ((a) < (b) ? (a) : (b))

typedef struct Point Point;

struct Point {
  int x;
  int y;
};

typedef struct {
  int length;
  int capacity;
  int *data;
} Buffer;

typedef union {
  int as_int;
  float as_float;
  char bytes[8];
} Value;

typedef enum {
  STATUS_OK = 0,
  STATUS_ERROR = 1,
  STATUS_TIMEOUT = 2
} Status;

typedef int (*CompareFn)(const void *a, const void *b);

typedef struct Point Point2D;

int module_init(void);
int module_shutdown(void);
Buffer *buffer_create(int capacity);
void buffer_destroy(Buffer *buf);
int buffer_append(Buffer *buf, int value);
int point_distance(const Point *a, const Point *b);

#endif // MODULE_H
