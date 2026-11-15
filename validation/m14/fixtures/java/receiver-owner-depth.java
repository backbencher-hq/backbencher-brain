package com.acme.depth;

import static java.util.Collections.sort;

import java.util.List;

/**
 * DEPTH CAMPAIGN (2026-10-19): the receiver-IDENTITY evidence classes that a calls edge's
 * leaf target drops and that are provable WITHOUT a project index, because the file states
 * them itself:
 *
 *   this        — an implicit-`this` call (JLS 15.12.1) and an explicit `this.m()`: the
 *                 enclosing type is the instance receiver.
 *   super       — `super.m()`: the first IN-FILE base that declares the method.
 *   enum        — `Mode.ONE.act()`: an enum constant's static type IS the enum (JLS 8.9.1).
 *   initializer — `var` whose initializer states the type (JLS 14.4).
 *
 * The negatives are as important as the positives: a STATIC-IMPORTED method called
 * unqualified is not an implicit-this member (JLS 7.5.3/7.5.4), a member of an ENCLOSING
 * class is not the inner class's own member (`widthFromOuter`), and a CLASS-QUALIFIED static
 * call stays owner-less by the 2026-10-18 contract (its fixture's forbid pins that).
 */
public class ReceiverOwnerDepth {
  static class Widget {
    int width;

    void paint() {}

    Widget self() {
      return this;
    }
  }

  enum Mode {
    ONE {
      void act() {}
    },
    TWO;

    void act() {}
  }

  static class Base {
    void baseWork() {}
  }

  static class Child extends Base {
    Widget widgetField;

    void helper() {}

    Base makeBase() {
      return null;
    }

    void implicitThisCase() {
      helper();
    }

    void explicitThisCase() {
      this.helper();
    }

    void superCase() {
      super.baseWork();
    }

    void enumCase() {
      Mode.ONE.act();
      Mode.TWO.act();
    }

    void varCase() {
      var w = new Widget();
      w.paint();
      var b = makeBase();
      b.baseWork();
    }

    Widget[] widgets;

    void newCase() {
      new Widget().paint();
    }

    void castCase(Object unknown) {
      ((Widget) unknown).paint();
    }

    void elementCase() {
      widgets[0].paint();
    }

    void externalClassCase(StringBuilder sb) {
      new StringBuilder().append("x");
    }

    void staticImportCase(List<String> xs) {
      sort(xs);
    }

    void enclosingMemberCase() {
      widthFromOuter();
    }
  }

  int readField;

  void helperOuter() {}

  int widthFromOuter() {
    return 1;
  }

  void implicitOuterCase() {
    helperOuter();
  }

  void readCase() {
    int viaThis = this.readField;
    int bare = readField;
    System.out.println(viaThis + bare);
  }
}
