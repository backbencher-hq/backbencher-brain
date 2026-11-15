#Requires -Version 5.1

$AppName = "order-api"
$DefaultPort = 8080

function Get-Config {
    param(
        [string]$Env = "dev"
    )
    $config = [PSCustomObject]@{
        Name = $AppName
        Port = $DefaultPort
        Environment = $Env
    }
    return $config
}

function Start-App {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$ConfigPath,

        [ValidateRange(1, 65535)]
        [int]$Port = $DefaultPort
    )

    if (-not (Test-Path $ConfigPath)) {
        throw "Config not found: $ConfigPath"
    }

    $config = Get-Config -Env "prod"
    Write-Host "Starting $($config.Name) on port $Port"
}

function Stop-App {
    param(
        [string]$Name = $AppName
    )
    Get-Process -Name $Name -ErrorAction SilentlyContinue | Stop-Process -Force
}

class Deployment {
    [string]$Name
    [int]$Replicas

    Deployment([string]$name, [int]$replicas) {
        $this.Name = $name
        $this.Replicas = $replicas
    }

    [string] Status() {
        return "$($this.Name) running with $($this.Replicas) replicas"
    }
}

$deployment = [Deployment]::new("order-api", 3)
Write-Host $deployment.Status()
Start-App -ConfigPath ".\app.json" -Port $DefaultPort
