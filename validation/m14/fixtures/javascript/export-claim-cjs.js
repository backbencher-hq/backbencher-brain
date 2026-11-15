// EXPORTS CLAIM EVIDENCE — CommonJS surface forms. The row's target stays the PROPERTY NAME; the
// evidence is which write form produced it (object literal, wholesale rebind, deep member, or a
// module.exports value). A CJS default value is NOT an ES default-export claim.
//
// THE FILE-LOCAL DECLARATION GUARD: `helper` and `declaredName` are declared IN THIS FILE and also
// written on `module.exports`. The claim exists only where no declaration answers the name, so those
// rows must stay UNMARKED and keep their bare spelling (the name model can resolve them honestly).
function helper() {
  return 1;
}

const declaredName = 2;

exports = { x: 1 };
module.exports = { helper, plain: 1, run() { return 2; }, declaredName };
module.exports.deep = 3;
module.exports = function () { return 5; };

// NEGATIVE: a VALUE REBIND (`exports = outsideValue`) replaces the surface value; it does not put a
// property named `outsideValue` on the export object, so it is NOT a moduleExports claim.
exports = outsideValue;
