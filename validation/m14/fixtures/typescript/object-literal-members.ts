// W1/W2/W3 regression fixture (M37.21 #611 web-family master review).
// W1: object-literal shorthand methods are members of the owning variable —
//     their calls attribute to the METHOD (never the enclosing class/method
//     or the module leaf). Nested object methods (JD18-class) are their own
//     scope, exactly like the JS analyzer contract.
// W2: computed member calls (o[key]()) are skipped — no fabricated targets.
// W3: static blocks and property initializers attribute to the CLASS (J5).
class Service {
  static count = Logger.init();
  static boot() { return Logger.tag("boot"); }
  handler = new Handler(this.ctx);
  static { warm(); }
  run() {
    const local = { deep() { inside(); } };
    local.deep();
    const fn = handlers[mode];
    fn();
  }
}
const util = { run() { helper(); this.setup(); }, calc: () => { util.run(); } };
util.run();
export { Service, util };
