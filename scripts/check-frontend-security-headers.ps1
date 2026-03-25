param(
  [string[]]$Urls = @("https://reactiv.pro", "https://www.reactiv.pro"),
  [int]$TimeoutSec = 15
)

$requiredHeaders = @(
  "strict-transport-security",
  "x-frame-options",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy"
)

$cspHeaders = @(
  "content-security-policy",
  "content-security-policy-report-only"
)

function Has-HeaderValue {
  param(
    [hashtable]$Headers,
    [string]$Name
  )

  if (-not $Headers) {
    return $false
  }

  $value = $Headers[$Name]
  if ($null -eq $value) {
    return $false
  }

  return -not [string]::IsNullOrWhiteSpace([string]$value)
}

function Request-Headers {
  param(
    [string]$Url,
    [int]$Timeout
  )

  try {
    $response = Invoke-WebRequest -UseBasicParsing -Method Get -Uri $Url -TimeoutSec $Timeout
    return [pscustomobject]@{
      Url = $Url
      StatusCode = [int]$response.StatusCode
      Headers = $response.Headers
      Error = $null
    }
  } catch {
    $errorMessage = $_.Exception.Message
    $response = $_.Exception.Response
    if ($response -and $response.Headers) {
      $statusCode = 0
      try {
        $statusCode = [int]$response.StatusCode.value__
      } catch {
        $statusCode = 0
      }

      return [pscustomobject]@{
        Url = $Url
        StatusCode = $statusCode
        Headers = $response.Headers
        Error = $errorMessage
      }
    }

    return [pscustomobject]@{
      Url = $Url
      StatusCode = 0
      Headers = @{}
      Error = $errorMessage
    }
  }
}

$hasFailures = $false

foreach ($url in $Urls) {
  $result = Request-Headers -Url $url -Timeout $TimeoutSec
  $headers = $result.Headers

  Write-Output "=== $($result.Url) ==="
  if ($result.StatusCode -gt 0) {
    Write-Output "status: $($result.StatusCode)"
  } else {
    Write-Output "status: unavailable"
  }

  if ($result.Error) {
    Write-Output "request-error: $($result.Error)"
  }

  foreach ($name in $requiredHeaders) {
    if (Has-HeaderValue -Headers $headers -Name $name) {
      Write-Output "[ok] ${name}: $($headers[$name])"
    } else {
      Write-Output "[missing] $name"
      $hasFailures = $true
    }
  }

  $hasCsp = $false
  foreach ($name in $cspHeaders) {
    if (Has-HeaderValue -Headers $headers -Name $name) {
      $hasCsp = $true
      Write-Output "[ok] ${name}: $($headers[$name])"
    }
  }

  if (-not $hasCsp) {
    Write-Output "[missing] content-security-policy or content-security-policy-report-only"
    $hasFailures = $true
  }

  Write-Output ""
}

if ($hasFailures) {
  Write-Output "Frontend security headers check: FAILED"
  exit 1
}

Write-Output "Frontend security headers check: PASSED"
