// The no-namespace form. It cannot share a file with a namespaced form, because C#'s
// file-scoped namespace applies to every declaration after it — so this is a SECOND
// fixture rather than a third section of the first, and its whole job is one name: an
// exported type at global scope must be published under its BARE name, because
// `Acme.Whatever.GlobalScopeType` is a name the assembly does not export.

public class GlobalScopeType
{
    public void Free() { }
}

internal class GlobalScopeInternal { }