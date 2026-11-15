#requires -Module ActiveDirectory
param([string]$Environment)

# Returns the config path for an environment.
function Get-ConfigPath {
  param(
    [string]$EnvName,
    [int]$Retries = 3
  )
  $path = Join-Path -Path $PSScriptRoot -ChildPath "$EnvName.config"
  for ($i = 0; $i -lt $Retries; $i++) {
    if (Test-Path $path) { break }
  }
  return $path
}

# Deployment class with constructor and methods.
class Deployment {
  [string]$Name
  [int]$Port = 8080

  Deployment([string]$name) {
    $this.Name = $name
  }

  [void] Start() {
    Start-Service -Name $this.Name
  }

  static [Deployment] FromName([string]$name) {
    return [Deployment]::new($name)
  }
}

class ProdDeployment : Deployment {
  ProdDeployment([string]$name) {
    $this.Name = $name
  }
}

enum EnvironmentKind { Dev; Staging; Prod }

$svc = Get-Service -Name "web"
$next = [Deployment]::new("api")
$deploy = [Deployment]::FromName("web")
$status = $svc.Status

foreach ($item in $list) {
  Write-Host $item
}

switch ($Environment) {
  "prod" { $mode = "production" }
  default { $mode = "development" }
}

try {
  Get-Item -Path "./missing"
} catch [System.IO.FileNotFoundException] {
  Write-Error $_
}

Get-Process | Where-Object { $_.CPU -gt 10 } | Stop-Process

Import-Module -Name Az.Accounts -Force
using module ./helpers.psm1
. ./bootstrap.ps1
& ./run-check.ps1
