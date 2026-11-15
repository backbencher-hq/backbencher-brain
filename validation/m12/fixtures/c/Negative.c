// validation/m12/fixtures/c/Negative.c
// M12.16 C negative fixture: include guards are NOT symbols; function-local
// variables are NOT symbols; NULL/true/false are NOT use targets; anonymous
// typedef'd structs/enums are named by their typedef; forward declarations
// do not create symbols or scope-leak self-references; unused includes are
// still include dependencies.
#ifndef NEGATIVE_H
#define NEGATIVE_H

#include "module_config.h"
#include <stdio.h>

struct ForwardOnly;      // forward declaration — NO symbol (no body)

typedef struct {
  int id;
  char *name;
} Record;                // anonymous struct named by typedef — ONE symbol

typedef enum { RED, GREEN, BLUE } Color;  // anonymous enum named by typedef

static int file_counter = 0;   // file-scope static — private variable symbol

int record_lookup(const Record *rec, int id) {
  int local = 0;               // function-local — NO symbol
  const Record *cursor = rec;  // local pointer — NO symbol
  if (cursor == NULL) return -1;
  if (id == 0) return 0;       // NULL / 0 literals — no use edges
  local = cursor->id;
  return local;
}

Color pick_color(int n) {
  if (n < 0) return RED;
  if (n > 10) return BLUE;
  return GREEN;
}

#endif // NEGATIVE_H
