package com.acme.evidence;

import java.io.IOException;
import java.io.Reader;
import java.io.FileReader;
import java.util.List;
import java.util.function.Consumer;

public class ReceiverOwnerEvidence {
  static class Widget {
    void paint() {
    }
  }

  void lambdaCase() {
    Consumer<Widget> consumer = (Widget typed) -> typed.paint();
  }

  void untypedLambdaCase(List<Widget> widgets) {
    widgets.forEach(w -> w.paint());
  }

  void enhancedForCase(List<Widget> widgets) {
    for (Widget loopWidget : widgets) {
      loopWidget.paint();
    }
  }

  void tryResourceCase() {
    try (Reader reader = new FileReader("x")) {
      reader.read();
    } catch (IOException caughtEx) {
      caughtEx.printStackTrace();
    }
  }

  void multiCatchCase() {
    try {
      System.out.println("x");
    } catch (RuntimeException | Error multi) {
      multi.printStackTrace();
    }
  }
}
