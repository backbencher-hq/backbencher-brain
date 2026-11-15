# Fixture: `renders` and `mixes_in` are RULED for PowerShell — this file is the
# positive control for the constructs that make BOTH rulings true rather than a
# failure to look.
#
# The lane's whole-population census
# (script/m14/powershell-extended-census.ts → validation/m14/measurements/powershell-extended-census.json)
# measured 1,181 admitted .ps1/.psm1/.psd1 files over 30 repositories:
#
#   renders    15 `ConvertTo-Html` sites in 1 file, 0 `Out-GridView`, 0 `Show-Command`,
#              1 `XamlReader` mention — and the vocabulary has 0 component symbol kinds
#              among its 32 SymbolKinds. A serializer that turns OBJECTS into HTML TEXT
#              renders no component, and its target is data, not a component symbol.
#   mixes_in   273 class statements and 50 class base-list entries — that base list IS
#              conformance (`extends`/`implements`, already emitted) — plus 326 runtime
#              member-attachment sites (Add-Member 127, Update-TypeData 17,
#              Update-FormatData 10, Add-Type 172). The member-set argument of
#              -Value/-MemberName is ALWAYS inline (script block 25, array-wrapped script
#              block 33, string 61) and never a named declaration. The only 3
#              declaration-shaped hits are -Name arguments — a member's own name, and
#              Add-Type naming the type it compiles — which are not member sets.
#
# WHAT THIS FILE PINS, IN BOTH DIRECTIONS:
#
#   FIRE (1) `class Widget : BaseWidget, IWidget` — the base list is conformance. The
#            class header cannot say which base is a class and which are interfaces
#            (PowerShell resolves that at runtime), so the positional grammar shape is
#            all the information there is: first name extends, the rest implement.
#   FIRE (2) a real function with a param block and a call — the ordinary shape the
#            file's other edges hang from.
#   FORBID (A) `ConvertTo-Html` and `[Windows.Markup.XamlReader]::Parse` — the two
#            render-sounding constructs the language actually has. The first serializes
#            objects to text; the second constructs UI from XAML TEXT, and neither
#            target is a declared component. A rule keyed on the words "html" or "markup"
#            would emit `renders` here.
#   FORBID (B) `Add-Member` and `Update-TypeData` — runtime member attachment, the
#            impostor family for `mixes_in`. Both attach a member to a VALUE or a TYPE
#            NAME at runtime, with the member set INLINE (`-Value { … }`); neither
#            declaration composes a named member set into a type, which is what the
#            vocabulary's mixin is.
#
# A rule that fired `renders` on a serializer, or `mixes_in` on Add-Member, would pass
# on a corpus zero and be wrong the moment a corpus carried these shapes. This file is
# those shapes.

class Widget : BaseWidget, IWidget {
    [string] $Name

    [string] Describe() {
        return "widget: $($this.Name)"
    }
}

# FIRE (2): a function with a param block, calling a declared function.
function Get-WidgetLabel {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [Widget] $Widget
    )

    Format-Label -Text $Widget.Describe()
}

function Format-Label {
    param([string] $Text)

    return "[$Text]"
}

$widget = [Widget]::new()
$widget.Name = "alpha"

# FORBID (A), first form: an object serializer. `ConvertTo-Html` turns objects into
# HTML TEXT; it renders no component and its target is the object it was given.
$widgets = @($widget)
$html = $widgets | ConvertTo-Html -Title "widgets"

# FORBID (A), second form: a markup reader. XamlReader constructs UI from XAML text,
# so the thing rendered is a document, not a component a source declaration names.
$xaml = "<TextBlock xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation' />"
$reader = [Windows.Markup.XamlReader]::Parse($xaml)

# FORBID (B), first form: attach a member to an OBJECT VALUE at runtime. The member
# set is the inline script block; no declaration composes it into a type.
$widget | Add-Member -MemberType ScriptMethod -Name Describe -Value {
    return "attached"
}

# FORBID (B), second form: attach a member to a TYPE NAME at runtime. `Widget` is the
# HOST the member is attached to, and the member set is again the inline block.
Update-TypeData -TypeName Widget -MemberType ScriptProperty -MemberName Label -Value {
    return "label"
}

Get-WidgetLabel -Widget $widget
