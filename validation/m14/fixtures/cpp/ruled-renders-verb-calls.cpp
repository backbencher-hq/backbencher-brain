// THE CLOSEST C++ CONSTRUCT TO `renders`, MEASURED — AND WHY IT IS NOT THE VALUE.
//
// The canonical contract (src/ast/types.ts, Renders): "A component RENDERS another component: source
// = the rendering symbol, target = the rendered component", measured on TSX/JSX `<Button/>` inside a
// component. C++ has no component/markup construct in the language. What it has is CALLS whose names
// happen to be render verbs: `panel.addWidget(button)`, `panel.paint()`, `draw(canvas, widget)`.
// Each is an ordinary call to a named function/method — `calls` states exactly that — and no C++
// syntax says "this component produces that component as output". A `renders` edge here would assert
// a component relation the language never declares.
struct Button { };
struct Panel {
  void addWidget(Button* b);
  void paint();
};

void draw(Panel& p, Button* b);

void buildPanel(Panel& p, Button* b) {
  p.addWidget(b);
  p.paint();
  draw(p, b);
}
