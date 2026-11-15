// CONV-CS-2 (#751) family alignment: with NO markers the payload keys must
// still exist — detectedFrameworks = [] (never undefined; python's empty
// payload shell), frameworkPatterns = [], and framework resolves to null.
// Consumers reading across languages get one none-value, not three.
using System;

public class Plain
{
    public int Value;
}
