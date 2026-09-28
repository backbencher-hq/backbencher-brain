// #841: the external scanner for a BARE-NAME type in closure-parameter position.
//
// Why an external scanner rather than a rule. §7g/§7n measured four rule-level
// attempts at this and each was inert or catastrophic, and the mechanism is the
// reason: method bodies are `closure` nodes in this grammar, so a bare name in
// the closure-opening state is lexed against BOTH the closure's parameter list
// and the body's local declarations. Adding `$.identifier` to the parameter
// *type* choice changes how a bare name lexes in that shared state, so
// `local_variable_declaration`'s `type: $._unannotated_type` (which needs a
// `type_identifier`) stops matching — in every method body of every file. That
// is the 1,480-file regression (§7h/§7o).
//
// The scanner sidesteps the tie entirely: it does NOT make `identifier` a legal
// type anywhere. It emits one opaque, HIDDEN token for the type name when — and
// only when — the input at that position proves it is a type:
//
//     <ident> <ws/comments> <ident> <ws/comments> ( ',' | '->' )
//     ^^^^^^^ the token, end-marked here
//
// i.e. two adjacent identifier-like words followed by `,` or `->`. `{ File f -> … }`
// is a typed parameter; `{ a, b -> … }` is not (after `a` comes `,`, not a
// second identifier), and `{ mit -> … }` is not (after `mit` comes `->`).
//
// Anything the scanner does not match returns false, so the parser falls back to
// the existing readings — the change is additive by construction, and the corpus
// A/B is the arbiter of whether it is also safe (§7h).
//
// Keywords are excluded deliberately: `int x ->` and `final y ->` must keep
// their existing readings rather than be re-lexed as a bare-name type.
#include "tree_sitter/parser.h"

enum TokenType { BARE_TYPE };

void *tree_sitter_groovy_external_scanner_create(void) { return NULL; }
void tree_sitter_groovy_external_scanner_destroy(void *payload) { (void)payload; }
void tree_sitter_groovy_external_scanner_reset(void *payload, const bool *valid_symbols) {
  (void)payload; (void)valid_symbols;
}
unsigned tree_sitter_groovy_external_scanner_serialize(void *payload, char *buffer) {
  (void)payload; (void)buffer; return 0;
}
void tree_sitter_groovy_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
  (void)payload; (void)buffer; (void)length;
}

static bool is_ident_start(int32_t c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_' || c == '$';
}
static bool is_ident_char(int32_t c) {
  return is_ident_start(c) || (c >= '0' && c <= '9');
}

// Skip whitespace and comments. Both are `extras` in the grammar, but an
// external scanner sees raw input, so it has to skip them itself or
// `{ File /* c */ f -> }` would be missed.
static void skip_trivia(TSLexer *lexer) {
  for (;;) {
    while (lexer->lookahead == ' ' || lexer->lookahead == '\t' ||
           lexer->lookahead == '\r' || lexer->lookahead == '\n') {
      lexer->advance(lexer, true);
    }
    if (lexer->lookahead == '/') {
      lexer->advance(lexer, true);
      if (lexer->lookahead == '/') {
        while (lexer->lookahead && lexer->lookahead != '\n') lexer->advance(lexer, true);
        continue;
      }
      if (lexer->lookahead == '*') {
        lexer->advance(lexer, true);
        while (lexer->lookahead && lexer->lookahead != '*') lexer->advance(lexer, true);
        while (lexer->lookahead == '*') lexer->advance(lexer, true);
        if (lexer->lookahead == '/') lexer->advance(lexer, true);
        continue;
      }
      // A lone '/' is not trivia; stop here and let the caller decide.
      return;
    }
    return;
  }
}

static void consume_word(TSLexer *lexer) {
  while (is_ident_char(lexer->lookahead)) lexer->advance(lexer, false);
}

// Reserved words that must keep their existing readings in the type position.
// Kept as a small, explicit list rather than a heuristic: a name that happens to
// spell a keyword is the one case the scanner must NOT claim.
static bool is_reserved(const char *w, int n) {
  static const char *KEYWORDS[] = {
    "abstract","as","assert","boolean","break","byte","case","catch","char","class",
    "const","continue","def","default","do","double","else","enum","extends","false",
    "final","finally","float","for","goto","if","implements","import","in","instanceof",
    "int","interface","long","native","new","null","package","private","protected",
    "public","return","short","static","strictfp","super","switch","synchronized",
    "this","throw","throws","trait","transient","true","try","void","volatile","while",
    "var","record","sealed","yield","it"
  };
  int count = (int)(sizeof(KEYWORDS) / sizeof(KEYWORDS[0]));
  for (int i = 0; i < count; i++) {
    const char *k = KEYWORDS[i];
    int j = 0;
    while (k[j] && j < n && k[j] == w[j]) j++;
    if (k[j] == '\0' && j == n) return true;
  }
  return false;
}

bool tree_sitter_groovy_external_scanner_scan(void *payload, TSLexer *lexer,
                                              const bool *valid_symbols) {
  (void)payload;
  if (!valid_symbols[BARE_TYPE]) return false;

  skip_trivia(lexer);
  if (!is_ident_start(lexer->lookahead)) return false;

  // Collect the first word so it can be tested against the keyword list.
  char word[64];
  int n = 0;
  while (is_ident_char(lexer->lookahead)) {
    if (n < (int)sizeof(word) - 1) word[n++] = (char)lexer->lookahead;
    lexer->advance(lexer, false);
  }
  word[n] = '\0';
  if (is_reserved(word, n)) return false;

  // The token, if it is one, ends here.
  lexer->mark_end(lexer);

  skip_trivia(lexer);
  if (!is_ident_start(lexer->lookahead)) return false;
  consume_word(lexer);

  skip_trivia(lexer);
  if (lexer->lookahead == ',') { lexer->result_symbol = BARE_TYPE; return true; }
  if (lexer->lookahead == '-') {
    // `->` must be two characters; `-` alone (`{ Type a - b }`) is not this.
    lexer->advance(lexer, false);
    if (lexer->lookahead == '>') { lexer->result_symbol = BARE_TYPE; return true; }
    return false;
  }
  return false;
}
