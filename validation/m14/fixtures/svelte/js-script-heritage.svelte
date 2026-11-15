<script>
  // M49 W12 svelte heritage pin. Corpus shape
  // (svelte/tests/runtime-legacy/samples/attribute-casing-custom-element):
  // a PLAIN JS <script> (no lang="ts") declaring a custom element with an
  // EXTERNAL base. The TS-shaped fixtures (relationship-kinds,
  // relationship-kind-catalog) both use IN-FILE bases, and the TS branch went
  // through the TS grammar's extends_clause — so this shape (external base via
  // tree-sitter-JAVASCRIPT's bare-expression class_heritage) was pinned by
  // nothing on either side.
  class MyCustomElement extends HTMLElement {
    constructor() {
      super();
      this._value = null;
    }

    connectedCallback() {
      this.render();
    }

    render() {
      return this._value;
    }
  }

  class Extended extends MyCustomElement {}

  class Qualified extends Lib.Base {}

  window.customElements.define('my-custom-element', MyCustomElement);
</script>

<my-custom-element />
