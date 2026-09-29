const
  letter = /[a-zA-Z]/,
  decimal_digit = /[0-9]/
  octal_digit = /[0-7]/
  hex_digit = /[0-9A-Fa-f]/

function array_of(content) {
  return seq(
    '[',
    optional(seq(content, repeat(seq(',', content)))),
    ']',
  );
}

module.exports = grammar({
  name: 'proto',

  extras: $ => [$.comment, /\s/],

  rules: {
    // proto = syntax { import | package | option | topLevelDef | emptyStatement }
    // topLevelDef = message | enum | service
    source_file: $ => seq(
      // PATCH 1: `edition = "2023";` is the protobuf EDITIONS file option. It is
      // not an alternative spelling of `syntax` — in an editions file it REPLACES
      // it, and the two are mutually exclusive. Upstream's root allowed only
      // `optional($.syntax)`, so every editions file was two ERROR nodes at the
      // top of the file. Both are optional and both are refused together, which is
      // what the specification requires.
      optional($.edition),
      optional($.syntax),
      optional(repeat(choice(
        $.import,
        $.package,
        $.option,
        $.enum,
        $.message,
        $.extend,
        $.service,
        $.empty_statement,
      ))),
    ),

    empty_statement: _ => ';',

    // PATCH 1 (continued): the `edition` rule itself. The edition token is kept as
    // a FIELD rather than discarded, so a consumer can read WHICH edition a file
    // declares without re-reading its text.
    edition: $ => seq('edition', '=', field('value', $.string), ';'),

    // syntax = "syntax" "=" quote "proto3" quote ";"
    syntax: $ => seq('syntax', '=', choice('"proto3"', '"proto2"'), ';'),

    // import = "import" [ "weak" | "public" ] strLit ";"
    // PATCH 3: the `option` modifier. Editions added `import option "path";`,
    // which imports a file that declares only OPTIONS — the mechanism behind
    // `features`. It is a fourth modifier alongside `weak` and `public`, not a
    // different rule, because the rest of the import is identical.
    import: $ => seq(
      'import',
      optional(choice('weak', 'public', 'option')),
      field('path', $.string),
      ';',
    ),

    // package = "package" fullIdent ";"
    package: $ => seq(
      'package',
      $.full_ident,
      ';',
    ),

    // option = "option" optionName  "=" constant ";"
    // optionName = ( ident | "(" fullIdent ")" ) { "." ident }
    option: $ => seq(
      'option',
      $._option_name,
      '=',
      $.constant,
      ';',
    ),

    // PATCH 6: a parenthesised `(fullIdent)` is legal as ANY dotted segment, not
    // only as the first. `features.(pb.cpp).repeated_type` and
    // `(a.b).(c.d)` are both in the reference implementation's own option tests,
    // and upstream's rule — a paren segment allowed only first, bare identifiers
    // after every dot — made both ERROR nodes.
    _option_name: $ => seq(
      choice(
        $.identifier,
        seq('(', $.full_ident, ')'),
      ),
      repeat(seq(
        '.',
        choice(
          $.identifier,
          seq('(', $.full_ident, ')'),
        ),
      )),
    ),

    // enum = "enum" enumName enumBody
    // enumBody = "{" { option | enumField | emptyStatement } "}"
    // enumField = ident "=" [ "-" ] intLit [ "[" enumValueOption { ","  enumValueOption } "]" ]";"
    // enumValueOption = optionName "=" constant
    enum: $ => seq(
      // PATCH 8: `local`, a 2023-editions top-level modifier. Anonymous and
      // optional, so it changes what parses and nothing about what a consumer
      // reads.
      optional('local'),
      'enum',
      $.enum_name,
      $.enum_body,
    ),

    enum_name: $ => $.identifier,

    enum_body: $ => seq(
      '{',
      repeat(choice(
        $.option,
        $.enum_field,
        $.empty_statement,
        $.reserved,
      )),
      '}',
    ),

    enum_field: $ => seq(
      $.identifier,
      '=',
      optional('-'),
      $.int_lit,
      optional(seq(
        '[',
        $.enum_value_option,
        repeat(seq(',', $.enum_value_option)),
        ']',
      )),
      ';',
    ),

    enum_value_option: $ => seq(
      $._option_name,
      '=',
      $.constant,
    ),

    // message = "message" messageName messageBody
    // messageBody = "{" { field | enum | message | option | oneof | mapField | reserved | emptyStatement } "}"
    message: $ => seq(
      // PATCH 8: `local`, a 2023-editions top-level modifier. Anonymous and
      // optional, so it changes what parses and nothing about what a consumer
      // reads.
      optional('local'),
      'message',
      $.message_name,
      $.message_body,
    ),

    message_body: $ => seq(
      '{',
      repeat(choice(
        $.field,
        $.enum,
        $.message,
        $.option,
        $.oneof,
        $.map_field,
        $.reserved,
        $.extensions,
        $.extend,
        $.empty_statement,
      )),
      '}',
    ),

    message_name: $ => $.identifier,

    extend: $ => seq(
      // PATCH 8 (continued): see the note on `message`.
      optional('local'),
      'extend',
      // PATCH 7: a LEADING DOT on the extend target. `message_or_enum_type`
      // already allowed one, but `extend` used a bare `full_ident`, so
      // `extend .google.protobuf.FieldOptions { ... }` was an ERROR — and fully
      // qualified extend targets are the norm in real schemas, not an edge case.
      optional('.'),
      $.full_ident,
      $.message_body,
    ),

    // field = [ "repeated" ] type fieldName "=" fieldNumber [ "[" fieldOptions "]" ] ";"
    // fieldOptions = fieldOption { ","  fieldOption }
    // fieldOption = optionName "=" constant
    // PATCH 5: a proto2 GROUP is the second alternative, not a variation on the
    // first. The specification deprecates it, but it is not rare — 12 of the
    // reference implementation's 108 .proto files use it, so ruling it would have
    // left the lane unable to read a quarter of protobuf's own corpus. Structurally
    // it is a FIELD whose "type" is the keyword `group` and whose BODY is a nested
    // message rather than a `;`, so it needs its own alternative: sharing the
    // terminator would mean inventing an empty rule, which tree-sitter rejects.
    // The body is kept as a real `message_body`, so a group's members stay
    // reachable to the analyzer instead of being swallowed as an opaque block.
    field: $ => choice(
      seq(
        // This isn't allowed according to the spec and yet the proto3 compiler
        // accepts it so we put it here for parsing.
        optional(choice('optional','required')),
        optional('repeated'),
        $.type,
        $.identifier,
        '=',
        $.field_number,
        optional(seq('[', $.field_options, ']')),
        ';',
      ),
      seq(
        optional(choice('optional','required')),
        optional('repeated'),
        'group',
        field('name', $.identifier),
        '=',
        $.field_number,
        optional(seq('[', $.field_options, ']')),
        optional($.message_body),
      ),
    ),

    field_options: $ => seq(
      $.field_option,
      repeat(seq(',', $.field_option)),
    ),

    field_option: $ => seq(
      $._option_name,
      '=',
      $.constant,
    ),

    // oneof = "oneof" oneofName "{" { option | oneofField | emptyStatement } "}"
    // oneofField = type fieldName "=" fieldNumber [ "[" fieldOptions "]" ] ";"
    oneof: $ => seq(
      'oneof',
      $.identifier,
      '{',
      repeat(choice(
        $.option,
        $.oneof_field,
        $.empty_statement,
      )),
      '}',
    ),

    oneof_field: $ => seq(
      $.type,
      $.identifier,
      '=',
      $.field_number,
      optional(seq('[', $.field_options, ']')),
    ),

    // mapField = "map" "<" keyType "," type ">" mapName "=" fieldNumber [ "[" fieldOptions "]" ] ";"
    // keyType = "int32" | "int64" | "uint32" | "uint64" | "sint32" | "sint64" |
    //        "fixed32" | "fixed64" | "sfixed32" | "sfixed64" | "bool" | "string"
    map_field: $ => seq(
      'map',
      '<',
      $.key_type,
      ',',
      $.type,
      '>',
      $.identifier,
      '=',
      $.field_number,
      optional(seq('[', $.field_options, ']')),
      ';',
    ),

    key_type: $ => choice(
      'int32',
      'int64',
      'uint32',
      'uint64',
      'sint32',
      'sint64',
      'fixed32',
      'fixed64',
      'sfixed32',
      'sfixed64',
      'bool',
      'string',
    ),

    // type = "double" | "float" | "int32" | "int64" | "uint32" | "uint64"
    //    | "sint32" | "sint64" | "fixed32" | "fixed64" | "sfixed32" | "sfixed64"
    //    | "bool" | "string" | "bytes" | messageType | enumType
    type: $ => choice(
      'double',
      'float',
      'int32',
      'int64',
      'uint32',
      'uint64',
      'sint32',
      'sint64',
      'fixed32',
      'fixed64',
      'sfixed32',
      'sfixed64',
      'bool',
      'string',
      'bytes',
      $.message_or_enum_type,
    ),

    // reserved = "reserved" ( ranges | fieldNames ) ";"
    // ranges = range { "," range }
    // range =  intLit [ "to" ( intLit | "max" ) ]
    // fieldNames = fieldName { "," fieldName }
    reserved: $ => seq(
      'reserved',
      choice($.ranges, $.field_names),
      ';',
    ),

    // PATCH 4: an optional option list on an extension RANGE. The specification
    // allows `extensions <range> [ <options> ];`, and `descriptor.proto` uses the
    // `declaration` option on its own extension range — so upstream's
    // `extensions ranges ;` was an ERROR on the single most important file in the
    // language. Measured on the pre-patch wasm: 3 ERROR nodes, and the aggregate
    // it contains (`{number: … type: … full_name: …}`) then failed too, so a
    // small construct took 70 error nodes with it.
    extensions: $ => seq(
      'extensions',
      $.ranges,
      optional(seq('[', $.field_options, ']')),
      ';',
    ),

    ranges: $ => seq($.range, repeat(seq(',', $.range))),

    range: $ => seq(
      $.int_lit,
      optional(seq(
        'to',
        choice($.int_lit, 'max'),
      )),
    ),

    field_names: $ => seq(
      $._identifier_or_string,
      repeat(seq(',', $._identifier_or_string)),
    ),

    // messageType = [ "." ] { ident "." } messageName
    message_or_enum_type: $ => seq(
      optional('.'),
      repeat(seq(
        $.identifier,
        '.',
      )),
      $.identifier,
    ),

    // PATCH 2: a field number may be NEGATIVE. The specification's field-number
    // space is the signed 32-bit range with 19000-19999 reserved for the
    // implementation, and negative numbers are legal and do occur. Upstream's
    // `field_number` was a bare `int_lit` with no sign, so `int32 a = -1;` was an
    // ERROR node. The sign is a separate optional token rather than a change to
    // `int_lit`, because a negative sign is also legal in a `default` value and
    // folding it into `int_lit` would let a sign appear where the grammar forbids
    // one.
    field_number: $ => seq(optional('-'), $.int_lit),

    // service = "service" serviceName "{" { option | rpc | emptyStatement } "}"
    // rpc = "rpc" rpcName "(" [ "stream" ] messageType ")" "returns" "(" [ "stream" ]
    //          messageType ")" (( "{" {option | emptyStatement } "}" ) | ";")
    service: $ => seq(
      // PATCH 8 (continued): see the note on `message`.
      optional('local'),
      'service',
      $.service_name,
      '{',
      repeat(choice(
        $.option,
        $.rpc,
        $.empty_statement,
      )),
      '}',
    ),

    service_name: $ => $.identifier,

    rpc: $ => seq(
      'rpc',
      $.rpc_name,
      '(',
      optional('stream'),
      $.message_or_enum_type,
      ')',
      'returns',
      '(',
      optional('stream'),
      $.message_or_enum_type,
      ')',
      choice(
        seq(
          '{',
          repeat(choice(
            $.option,
            $.empty_statement,
          )),
          '}',
        ),
        ';',
      ),
    ),

    rpc_name: $ => $.identifier,

    // constant = fullIdent | ( [ "-" | "+" ] intLit ) | ( [ "-" | "+" ] floatLit ) | strLit | boolLit
    constant: $ => choice(
      $.full_ident,
      seq(
        optional(choice('-', '+')),
        $.int_lit,
      ),
      seq(
        optional(choice('-', '+')),
        $.float_lit,
      ),
      $.string,
      $.bool,

      // block_lit is not specified but is used in the real world
      // (i.e. grpc-gateway) so we define it
      $.block_lit,
    ),

    // block_lit is completely unspecified. I determined what is allowed
    // based on the "a bit of everything" grpc-gateway example which has
    // wildly inconsistent syntax and yet it actually parses and compiles
    // with protoc.
    block_lit: $ => seq(
      '{',
      repeat(seq(
        choice(
          $.identifier,
          seq('[', $.full_ident, ']'),
        ),
        optional(':'),
        choice(
          $.constant,
          array_of($.constant),
        ),
        optional(choice(',', ';')),
      )),
      '}',
    ),

    // ident = letter { letter | decimalDigit | "_" }
    identifier: $ => token(seq(
      choice(letter, '_'),
      optional(repeat(choice(
        letter,
        decimal_digit,
        '_',
      ))),
    )),

    _identifier_or_string: $ => choice($.identifier, $.string),

    // fullIdent = ident { "." ident }
    full_ident: $ => seq(
      $.identifier,
      optional(repeat(seq('.', $.identifier))),
    ),

    // boolLit = "true" | "false"
    bool: $ => choice($.true, $.false),
    true: $ => 'true',
    false: $ => 'false',

    // intLit     = decimalLit | octalLit | hexLit
    int_lit: $ => choice(
      $.decimal_lit,
      $.octal_lit,
      $.hex_lit,
    ),

    // decimalLit = ( "1" … "9" ) { decimalDigit }
    decimal_lit: $ => token(seq(
      /[1-9]/,
      repeat(decimal_digit),
    )),

    // octalLit   = "0" { octalDigit }
    octal_lit: $ => token(seq(
      '0',
      repeat(octal_digit),
    )),

    // hexLit     = "0" ( "x" | "X" ) hexDigit { hexDigit }
    hex_lit: $ => token(seq(
      '0',
      choice('x', 'X'),
      hex_digit,
      repeat(hex_digit),
    )),

    // floatLit = ( decimals "." [ decimals ] [ exponent ] | decimals exponent | "."decimals [ exponent ] ) | "inf" | "nan"
    // decimals  = decimalDigit { decimalDigit }
    // exponent  = ( "e" | "E" ) [ "+" | "-" ] decimals
    float_lit: $ => {
      const decimals = seq(
        decimal_digit,
        repeat(decimal_digit),
      );

      const exponent = seq(
        choice('e', 'E'),
        optional(choice('+', '-')),
        decimals,
      );

      return token(choice(
        seq(
          decimals,
          '.',
          optional(decimals),
          optional(exponent),
        ),
        seq(
          decimals,
          exponent,
        ),
        seq(
          '.',
          decimals,
          optional(exponent),
        ),
        'inf',
        'nan',
      ));
    },

    string: $ => repeat1(
      choice(
        seq(
          '"',
          repeat(choice(
            token.immediate(prec(1, /[^"\\]+/)),
            $.escape_sequence
          )),
          '"'
        ),

        seq(
          "'",
          repeat(choice(
            token.immediate(prec(1, /[^'\\]+/)),
            $.escape_sequence
          )),
          "'",
        ),
      )
    ),

    escape_sequence: $ => token.immediate(seq(
      '\\',
      choice(
        /[^xuU]/,
        /\d{2,3}/,
        /x[0-9a-fA-F]{2,}/,
        /u[0-9a-fA-F]{4}/,
        /U[0-9a-fA-F]{8}/
      )
    )),

    comment: $ => token(choice(
      seq('//', /.*/),
      seq(
        '/*',
        /[^*]*\*+([^/*][^*]*\*+)*/,
        '/'
      )
    ))
  }
});
