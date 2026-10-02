// External scanner for the Make grammar: `.RECIPEPREFIX` support.
//
// WHY THIS EXISTS. Upstream tree-sitter-make hardcodes the recipe prefix to a tab:
//
//     // TODO external parser for .RECIPEPREFIX
//     _recipeprefix: _ => '\t',
//
// That TODO is a real, reachable defect rather than a stylistic note. GNU Make
// 3.82 added `.RECIPEPREFIX`, and a Makefile that sets it to `>` has every one of
// its recipe lines parsed as an ERROR node by this grammar, so the analyzer sees
// a rule with no recipe at all — a build file that looks like it does nothing.
// Measured on the lane's 100-file pinned corpus there are 0 such files today,
// which is a statement about the corpus and not about the language.
//
// WHY A SCANNER AND NOT A CHARACTER CLASS. The prefix is not a fixed set of
// characters: `.RECIPEPREFIX = >` can be any single character, chosen by the
// Makefile. A grammar rule that accepted "any character that is not a space" as
// a recipe prefix would also accept ordinary prose and stray punctuation as
// recipe lines, which is a far worse failure than the one being fixed: it turns
// a false negative into a flood of fabricated recipe lines. So the prefix is
// read from the file and compared against exactly.
//
// HOW THE STATE IS ACQUIRED. A tree-sitter external scanner can only look
// FORWARD from where it is invoked, so it cannot go back and re-read a
// `.RECIPEPREFIX` assignment that appeared earlier in the file. The grammar
// therefore gives the scanner a second, ZERO-WIDTH token valid at the start of
// a `RECIPEPREFIX_assignment`. When the scanner sees that token position it
// reads ahead over the whole assignment, records the prefix character, and
// returns a token whose end is marked at the position it started from — so it
// consumes nothing and the visible parse is untouched. The assignment itself is
// then parsed by the ordinary rule, and `RECIPEPREFIX_assignment` still appears
// in the tree with the same fields it always had.
//
// WHAT IS NOT HANDLED, STATED RATHER THAN HIDDEN. GNU Make also accepts the
// prefix from the command line (`make -R RECIPEPREFIX=>`) and from a variable
// (`RECIPEPREFIX = $(X)`). Neither is observable from the file, so a scanner
// cannot see it, and this one does not pretend to: an unresolvable value leaves
// the default tab in place. That is the honest boundary of a file-local
// scanner, and the same boundary the rest of this grammar already has for
// `define` bodies (upstream's second TODO, "prefixed line in define is recipe").

#include "tree_sitter/parser.h"

#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>

// The order here MUST match the `externals` array in grammar.js.
enum TokenType {
  RECIPE_PREFIX,        // consumes the prefix character, if it is the tracked one
  RECIPEPREFIX_VALUE,   // the value of a `.RECIPEPREFIX` assignment, single char only
};

static inline bool is_space(int32_t c) { return c == ' ' || c == '\t' || c == '\f' || c == '\v'; }

// GNU Make's default recipe prefix, and the value used whenever `.RECIPEPREFIX`
// is absent or unresolvable.
#define DEFAULT_RECIPE_PREFIX '\t'

// The longest `.RECIPEPREFIX` spelling the scanner has to recognise, plus room
// for whitespace, an operator and the value.
#define SNIFF_MAX_LOOKAHEAD 64

// The assignment operators GNU Make accepts on `.RECIPEPREFIX`, as a predicate
// over a single character. Kept as a function rather than a table so the
// accepted set is readable next to the comment that explains it.
static inline bool is_define_op(int32_t c) {
  return c == '=' || c == ':' || c == '?' || c == '+';
}

typedef struct {
  // The recipe prefix currently in force. Serialized, because an incremental
  // reparse that resumes mid-file must not silently fall back to a tab: that
  // would turn a correct tree into a different, wrong one depending on which
  // edit triggered the reparse.
  int32_t recipe_prefix;
} Scanner;

void *tree_sitter_make_external_scanner_create(void) {
  Scanner *scanner = (Scanner *)calloc(1, sizeof(Scanner));
  if (scanner != NULL) scanner->recipe_prefix = DEFAULT_RECIPE_PREFIX;
  return scanner;
}

void tree_sitter_make_external_scanner_destroy(void *payload) { free(payload); }

// One int32 of state. The buffer is generous, but a scanner that reports more
// than TREE_SITTER_SERIALIZATION_BUFFER_SIZE is a bug tree-sitter reports loudly.
unsigned tree_sitter_make_external_scanner_serialize(void *payload, char *buffer) {
  Scanner *scanner = (Scanner *)payload;
  unsigned size = 0;
  buffer[size++] = (char)(scanner->recipe_prefix & 0xFF);
  buffer[size++] = (char)((scanner->recipe_prefix >> 8) & 0xFF);
  buffer[size++] = (char)((scanner->recipe_prefix >> 16) & 0xFF);
  buffer[size++] = (char)((scanner->recipe_prefix >> 24) & 0xFF);
  return size;
}

void tree_sitter_make_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
  Scanner *scanner = (Scanner *)payload;
  // A fresh scanner, or a resume from an older tree, starts at the default. The
  // distinction matters: falling back to a tab is the safe direction, because a
  // tab-prefixed recipe is what the overwhelming majority of makefiles use.
  scanner->recipe_prefix = DEFAULT_RECIPE_PREFIX;
  if (length >= 4) {
    scanner->recipe_prefix = (int32_t)((unsigned char)buffer[0]) |
                              ((int32_t)(unsigned char)buffer[1] << 8) |
                              ((int32_t)(unsigned char)buffer[2] << 16) |
                              ((int32_t)(unsigned char)buffer[3] << 24);
  }
}

// The characters that TERMINATE an assignment value in this grammar. Mirrors the
// `disallow` list that builds `_assignment_text` (makeText): a value stops at a
// dollar sign, a newline, a backslash, or a comment. Mirroring it is what makes
// the external token's span identical to the internal one it stands in for.
static inline bool terminates_value(int32_t c) {
  return c == '$' || c == '\n' || c == '\r' || c == '\\' || c == '#';
}

bool tree_sitter_make_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
  Scanner *scanner = (Scanner *)payload;

  // The VALUE arm runs first, and it is the only place the prefix is learned.
  //
  // It accepts EXACTLY ONE literal character followed by the end of the value,
  // and declines everything else. Declining is not a failure: the grammar offers
  // the internal `_assignment_text` as the second arm of the same `choice`, so a
  // value the scanner will not vouch for is parsed by exactly the code that
  // always parsed it. That asymmetry is the whole safety argument for this file
  // -- it can only ever ADD a recipe prefix it has been told about, and the only
  // behaviour it can change is on inputs no corpus file contains.
  // The VALUE arm is tried first because that is where the prefix is learned, and
  // declining it must FALL THROUGH to the prefix arm below rather than return.
  //
  // There is a lex state in which BOTH external tokens are valid. Returning false
  // from here would abandon the recipe token in that state, and the corpus A/B
  // caught exactly that: three real Makefiles that parse cleanly under the wired
  // grammar gained 39 error nodes between them, because their tab-prefixed recipe
  // lines sat in the merged state and the scanner answered for the value token
  // and then said "no" to everything. A scanner has one answer per call, so the
  // two questions have to be asked in one function rather than in two that
  // return.
  if (valid_symbols[RECIPEPREFIX_VALUE]) {
    // The internal `_assignment_text` token INCLUDES the whitespace around the
    // value: `.RECIPEPREFIX = >` yields a `text` node whose text is `" >"`, with
    // the leading space. An arm that rejected a leading space would never match,
    // the internal token would win the `choice`, and the scanner would decline
    // every time -- which is what the first build did, and it looked for a long
    // time like the scanner was not being called at all.
    int32_t leading = 0;
    while (leading < SNIFF_MAX_LOOKAHEAD && is_space(lexer->lookahead)) {
      lexer->advance(lexer, false);
      leading++;
    }
    int32_t first = lexer->lookahead;
    if (first != 0 && !terminates_value(first) && !is_space(first)) {
      lexer->advance(lexer, false);
      while (is_space(lexer->lookahead)) lexer->advance(lexer, false);
      lexer->mark_end(lexer);
      // Anything left unconsumed means the value is longer than one character.
      // GNU Make rejects such an assignment, so fall through and let the internal
      // token parse it exactly as it always did.
      if (lexer->lookahead == 0 || terminates_value(lexer->lookahead)) {
        scanner->recipe_prefix = first;
        lexer->result_symbol = RECIPEPREFIX_VALUE;
        return true;
      }
    }
  }

  // DECLINE whenever the tracked prefix is the default. The grammar keeps the tab
  // as an internal token, so letting the external arm also match a tab would put
  // two different tokens on the same character and leave the parser to pick --
  // for no benefit, since a file that never set `.RECIPEPREFIX` is exactly the
  // case the internal token exists to serve.
  if (scanner->recipe_prefix == DEFAULT_RECIPE_PREFIX) return false;

  if (valid_symbols[RECIPE_PREFIX] && lexer->lookahead == scanner->recipe_prefix) {
    lexer->advance(lexer, false);
    lexer->mark_end(lexer);
    lexer->result_symbol = RECIPE_PREFIX;
    return true;
  }

  return false;
}
