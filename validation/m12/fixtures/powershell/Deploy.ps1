param([string]$Env = "dev")

function Get-Config {
  param([string]$Name)
  $path = Join-Path -Path "." -ChildPath "$Name.json"
  return $path
}

function Start-App {
  param([int]$Port = 8080)
  $proc = Start-Process -FilePath "dotnet" -ArgumentList "run" -PassThru
  return $proc
}

function Stop-App {
  param([string]$Name)
  Stop-Process -Name $Name -Force
}

class Deployment {
  [string]$Name
  [int]$Port

  Deployment([string]$name, [int]$port) {
    $this.Name = $name
    $this.Port = $port
  }

  [string] Describe() {
    return "Deployment $($this.Name) on port $($this.Port)"
  }
}

$cfg = Get-Config -Name "app"
$app = [Deployment]::new("app", 8080)
$desc = $app.Describe()
if ($null -ne $app) {
  Start-App -Port $app.Port
}
Stop-App -Name "app"
Write-Host $desc
