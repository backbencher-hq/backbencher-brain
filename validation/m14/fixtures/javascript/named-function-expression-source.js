/**
 * NAMED FUNCTION EXPRESSION — the `uses` walk and the `calls` walk must name the SAME enclosing
 * callable.
 *
 * THE DEFECT THIS PINS. A named function expression (`return function handler(event) {…}`) rebinds
 * the code's actor to `handler`. The CALLS walk's `resolveCurrent` has always listed
 * `function_expression`, so a call inside it is sourced `handler`. The USES walk's rebinding clause
 * listed only `function_declaration`, `generator_function_declaration` and `method_definition`, so
 * every READ inside the same body was sourced to the OUTER function instead. Measured on bootstrap's
 * bundle, on the same line:
 *
 *   L348 calls  handler            -> off
 *   L348 uses   bootstrapHandler   -> handler\0EventHandler / oneOff / type / fn
 *
 * `bootstrapHandler` merely RETURNS `handler`; it does not read `oneOff`, `type` or `fn`. The `uses`
 * rows named a function that does not contain the read — the same "wrong attribution" class as the
 * receiver-owner findings, in the SOURCE dimension.
 *
 * WHY IT WENT UNNOTICED, and why this fixture is the right instrument. `differential.ts` matches on
 * `label + normTarget` and never on source; the per-label oracle agreement does the same; and
 * `verify-js-source-attribution.ts` asserts only the NULL-source class. So a source that names the
 * wrong symbol was invisible to every gate the lane owned. It was found by
 * `script/m14/javascript-source-attribution-census.ts`, which replays `resolveCurrent` over the tree.
 *
 * THE SHAPES, and a correction worth recording. The first draft of this file labelled three of the
 * four as "positive controls that already worked". That was FALSE, and the A/B proved it: before the
 * fix every one of the four emitted the OUTER function's name. A named function expression is not
 * rebinding in the uses walk at all, so whichever enclosing form happened to set `method` won —
 * a declaration, a `const` arrow, or a prototype assignment alike. So all four shapes are regression
 * tests for the ONE fix, and the reason to keep four is the opposite of why they were written: they
 * prove the fix COMPOSES with each other rebinding rule rather than replacing it.
 *
 *   outerDeclaration   enclosing form: function DECLARATION
 *   outerExpression    enclosing form: function DECLARATION   (the shape measured on bootstrap)
 *   outerArrow         enclosing form: `const` ARROW          (the variable_declarator rule)
 *   outerPrototype     enclosing form: `X.prototype.m = …`    (the rule the fix now wraps in else)
 *
 * Every row must attribute to the INNER named function, because that is where the read happens.
 */

// ── SHAPE 1: function DECLARATION (positive control: this already attributed correctly)
function outerDeclaration() {
  return function innerDeclarationRead() {
    return DECLARATION_TOKEN;
  };
}

// ── SHAPE 2: named function EXPRESSION returned from a function declaration (THE DEFECT)
function outerExpression() {
  return function handlerExpression(event) {
    return EVENT_TOKEN + event;
  };
}

// ── SHAPE 3: `const` arrow (positive control: the variable_declarator rule)
const outerArrow = () => {
  return function innerArrowRead() {
    return ARROW_TOKEN;
  };
};

// ── SHAPE 4: prototype assignment (positive control: the rule the fix wraps in an else-branch)
function PrototypeHost() {}
PrototypeHost.prototype.outerPrototype = function () {
  return function innerPrototypeRead() {
    return PROTOTYPE_TOKEN;
  };
};

const DECLARATION_TOKEN = 1;
const EVENT_TOKEN = 2;
const ARROW_TOKEN = 3;
const PROTOTYPE_TOKEN = 4;

module.exports = {
  outerDeclaration,
  outerExpression,
  outerArrow,
  PrototypeHost,
};
