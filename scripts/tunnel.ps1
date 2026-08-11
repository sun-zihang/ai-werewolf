param(
  [string]$Url = "http://localhost:3001"
)
$ErrorActionPreference = "Stop"

$cloudflared = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
if (-not (Test-Path $cloudflared)) { $cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source }
if (-not $cloudflared) { Write-Error "cloudflared not found"; exit 1 }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host "Need admin to temporarily switch DNS (auto-restored after tunnel stops). Please click Yes on the UAC prompt."
  Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile","-ExecutionPolicy","Bypass","-File","`"$PSCommandPath`"","-Url","`"$Url`""
  exit 0
}

$utf8 = New-Object System.Text.UTF8Encoding($false)
$dbg = Join-Path $env:TEMP "cfd-debug-err.txt"
$log = Join-Path $env:TEMP "cfd-tunnel.log"
$urlFile = Join-Path $env:TEMP "cfd-tunnel-url.txt"
Remove-Item -LiteralPath $log, $urlFile, $dbg -ErrorAction SilentlyContinue
[System.IO.File]::WriteAllText($dbg, "elevated start" + [Environment]::NewLine, $utf8)

$iface = (Get-NetAdapter | Where-Object { $_.Status -eq "Up" } | Select-Object -First 1).Name
$oldDns = @(Get-DnsClientServerAddress -InterfaceAlias $iface -AddressFamily IPv4 | Where-Object { $_.ServerAddresses } | Select-Object -ExpandProperty ServerAddresses)
$newDns = @("223.5.5.5", "1.1.1.1")

try {
  Set-DnsClientServerAddress -InterfaceAlias $iface -ServerAddresses $newDns
  [System.IO.File]::AppendAllText($dbg, "dns set ok" + [Environment]::NewLine, $utf8)
} catch {
  [System.IO.File]::AppendAllText($dbg, ("dns set FAILED: " + $_.Exception.Message) + [Environment]::NewLine, $utf8)
}

try {
  $errLog = Join-Path $env:TEMP "cfd-tunnel.err.log"
  $proc = Start-Process -FilePath $cloudflared -ArgumentList @("tunnel","--url",$Url,"--no-autoupdate") -RedirectStandardOutput $log -RedirectStandardError $errLog -NoNewWindow -PassThru
  [System.IO.File]::AppendAllText($dbg, ("cloudflared started pid=" + $proc.Id) + [Environment]::NewLine, $utf8)

  # 轮询日志提取 URL（共享读，避免文件锁）
  for ($i = 0; $i -lt 180; $i++) {
    Start-Sleep -Seconds 1
    if ($proc.HasExited) { break }
    if (-not (Test-Path $log)) { continue }
    try {
      $fs = [System.IO.File]::Open($log, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
      $sr = New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::UTF8)
      $text = $sr.ReadToEnd()
      $sr.Close()
      $fs.Close()
    } catch { $text = "" }
    $m = [regex]::Match($text, "https://[a-z0-9-]+\.trycloudflare\.com")
    if ($m.Success) {
      Set-Content -LiteralPath $urlFile -Value $m.Value -Encoding UTF8
      break
    }
    # 兜底：从本地管理接口读取 quick tunnel 地址（日志可能因重定向缓冲为空）
    try {
      $qt = Invoke-RestMethod "http://127.0.0.1:20241/quicktunnel" -TimeoutSec 3
      if ($qt.hostname) {
        Set-Content -LiteralPath $urlFile -Value ("https://" + $qt.hostname) -Encoding UTF8
        break
      }
    } catch { }
  }
  # 保持脚本存活：隧道运行期间不退出（关闭此窗口即停止隧道并恢复 DNS）
  $proc.WaitForExit()
  if (Test-Path $errLog) {
    $e = [System.IO.File]::ReadAllText($errLog, [System.Text.Encoding]::UTF8)
    if ($e) { [System.IO.File]::AppendAllText($dbg, ("stderr: " + $e.Substring(0, [Math]::Min(1500, $e.Length))) + [Environment]::NewLine, $utf8) }
  }
} catch {
  [System.IO.File]::AppendAllText($dbg, ("ERROR: " + $_.Exception.Message) + [Environment]::NewLine, $utf8)
} finally {
  if ($oldDns.Count -gt 0) {
    try { Set-DnsClientServerAddress -InterfaceAlias $iface -ServerAddresses $oldDns } catch { }
  }
  [System.IO.File]::AppendAllText($dbg, "done, dns restored" + [Environment]::NewLine, $utf8)
}