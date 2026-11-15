package com.acme.recv;

import java.util.List;

public class ReceiverOwnerType {
  static class Widget {
    int width;

    void paint() {
    }

    Widget self() {
      return this;
    }
  }

  static class Helper {
    static void help() {
    }
  }

  Widget fieldWidget;

  void fieldCase() {
    fieldWidget.paint();
  }

  void paramCase(Widget paramWidget) {
    paramWidget.paint();
  }

  void localCase() {
    Widget localWidget = new Widget();
    localWidget.paint();
  }

  void returnCase(Widget w) {
    w.self().paint();
  }

  void staticCase() {
    Helper.help();
  }

  void importedParamCase(List<String> list) {
    list.clear();
  }

  void readCase(Widget paramWidget) {
    int total = paramWidget.width;
    System.out.println(total);
  }

  void thisFieldCase() {
    this.fieldWidget.paint();
  }

  void unknownCase(Object unknown) {
    unknown.toString();
  }

  static class Base {
    Widget inheritedWidget;
  }

  static class Child extends Base {
    void inheritedFieldCase() {
      inheritedWidget.paint();
    }
  }
}
