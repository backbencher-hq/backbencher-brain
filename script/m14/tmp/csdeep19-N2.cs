namespace Ns {
  public class Base { public virtual string M() => ""; }
  public class Derived : Other.Base { public override string M() => ""; }
  namespace Other { public class Base { public virtual string M() => ""; } }
}
