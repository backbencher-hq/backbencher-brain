// validation/m11/fixtures/systems/CoreApi.c
// M11.10 C fixture: function definitions, cross-file calls, field access.
#include "CoreApi.h"
#include <stdlib.h>

static int initialized = 0;

int core_init(void) {
  initialized = 1;
  return STATUS_OK;
}

int core_shutdown(void) {
  initialized = 0;
  return STATUS_OK;
}

Buffer *buffer_create(int capacity) {
  Buffer *buf = (Buffer *)malloc(sizeof(Buffer));
  if (buf == NULL) return NULL;
  buf->capacity = capacity;
  buf->length = 0;
  buf->data = (int *)malloc(sizeof(int) * (size_t)capacity);
  return buf;
}

void buffer_destroy(Buffer *buf) {
  if (buf == NULL) return;
  free(buf->data);
  free(buf);
}

int buffer_append(Buffer *buf, int value) {
  if (buf == NULL || buf->length >= MAX_ITEMS) return STATUS_ERROR;
  buf->data[buf->length] = value;
  buf->length++;
  return STATUS_OK;
}

int point_distance(const Point *a, const Point *b) {
  int dx = a->x - b->x;
  int dy = a->y - b->y;
  return dx * dx + dy * dy;
}
