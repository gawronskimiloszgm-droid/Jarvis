// Skrypty PowerShell dla narzedzi "komputera": wyszukiwanie plikow (indeks
// Windows Search + zapas), skan autostartu, polaczenia sieciowe, lista
// zainstalowanych programow, historia Defendera. Parametry wstrzykiwane
// tylko jako literaly w apostrofach (patrz q()).

const q = (s) => `'${String(s ?? '').replace(/'/g, "''")}'`;
const HEAD = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n';

// Wyszukiwanie przez indeks Windows Search (szybkie, dziala po NAZWIE i po
// TRESCI plikow indeksowanych przez system). Gdy usluga indeksowania jest
// wylaczona - zapas: rekursywne Get-ChildItem po typowych folderach.
function searchFilesScript({ query, days = 0, ext = '', limit = 40 }) {
  const words = String(query || '')
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}._-]/gu, ''))
    .filter(Boolean)
    .slice(0, 6);
  const wordsLiteral = words.map(q).join(',');
  return `${HEAD}
$words = @(${wordsLiteral})
$days = ${Number(days) | 0}
$ext = ${q(ext.replace(/[^a-z0-9]/gi, ''))}
$limit = ${Math.min(Number(limit) | 0 || 40, 100)}
$results = @()
try {
  $conn = New-Object -ComObject ADODB.Connection
  $conn.Open("Provider=Search.CollatorDSO;Extended Properties='Application=Windows';")
  $dq = [char]34
  $conds = @("System.ItemType <> 'Directory'")
  foreach ($w in $words) { $e = $w.Replace("'", "''"); $conds += "(System.FileName LIKE '%$e%' OR CONTAINS('$dq$e*$dq'))" }
  if ($ext) { $conds += "System.FileExtension = '.$ext'" }
  if ($days -gt 0) { $since = (Get-Date).AddDays(-$days).ToString('yyyy-MM-dd'); $conds += "System.DateModified >= '$since'" }
  $sql = "SELECT TOP $limit System.ItemPathDisplay, System.Size, System.DateModified FROM SystemIndex WHERE " + ($conds -join ' AND ') + " ORDER BY System.DateModified DESC"
  $rs = $conn.Execute($sql)
  while (-not $rs.EOF) {
    $results += [pscustomobject]@{ path = [string]$rs.Fields.Item(0).Value; size = [int64]$rs.Fields.Item(1).Value; modified = ([datetime]$rs.Fields.Item(2).Value).ToString('s') }
    $rs.MoveNext()
  }
  $rs.Close(); $conn.Close()
  $src = 'indeks'
} catch { $src = 'zapas' }
if ($results.Count -eq 0) {
  $roots = @("$env:USERPROFILE\\Desktop", "$env:USERPROFILE\\Documents", "$env:USERPROFILE\\Downloads")
  $items = foreach ($r in $roots) { if (Test-Path $r) { Get-ChildItem $r -Recurse -File -ErrorAction SilentlyContinue -Depth 6 } }
  foreach ($w in $words) { $items = $items | Where-Object { $_.Name -like "*$w*" } }
  if ($ext) { $items = $items | Where-Object { $_.Extension -eq ".$ext" } }
  if ($days -gt 0) { $items = $items | Where-Object { $_.LastWriteTime -ge (Get-Date).AddDays(-$days) } }
  $results = @($items | Sort-Object LastWriteTime -Descending | Select-Object -First $limit | ForEach-Object { [pscustomobject]@{ path = $_.FullName; size = $_.Length; modified = $_.LastWriteTime.ToString('s') } })
  if ($src -ne 'indeks') { $src = 'zapas' } else { $src = 'zapas' }
}
[pscustomobject]@{ source = $src; count = @($results).Count; files = @($results) } | ConvertTo-Json -Compress -Depth 4
`;
}

// Programy uruchamiane ze startem systemu (rejestr Run + folder Autostart +
// zaplanowane zadania logowania). Czyste odczyty, nic nie zmienia.
function startupScript() {
  return `${HEAD}
$items = @()
$keys = @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run')
foreach ($k in $keys) {
  if (Test-Path $k) {
    $p = Get-ItemProperty $k
    foreach ($prop in $p.PSObject.Properties) {
      if ($prop.Name -notmatch '^PS') { $items += [pscustomobject]@{ where = $k -replace 'HKCU:.*','Rejestr (uzytkownik)' -replace 'HKLM:.*','Rejestr (system)'; name = $prop.Name; command = [string]$prop.Value } }
    }
  }
}
$folders = @("$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs\\Startup", "$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\StartUp")
foreach ($f in $folders) { if (Test-Path $f) { Get-ChildItem $f -File -ErrorAction SilentlyContinue | ForEach-Object { $items += [pscustomobject]@{ where = 'Folder Autostart'; name = $_.Name; command = $_.FullName } } } }
try {
  Get-ScheduledTask -ErrorAction Stop | Where-Object { $_.State -ne 'Disabled' -and ($_.Triggers | Where-Object { $_.CimClass.CimClassName -match 'Logon|Boot' }) -and $_.TaskPath -notmatch '^\\\\Microsoft\\\\' } | ForEach-Object {
    $a = $_.Actions | Select-Object -First 1
    $items += [pscustomobject]@{ where = 'Zadanie zaplanowane'; name = $_.TaskName; command = ([string]$a.Execute + ' ' + [string]$a.Arguments).Trim() }
  }
} catch {}
[pscustomobject]@{ count = $items.Count; items = $items } | ConvertTo-Json -Compress -Depth 4
`;
}

// Polaczenia sieciowe: kto laczy sie na zewnatrz i co nasluchuje.
function networkScript() {
  return `${HEAD}
$procs = @{}
Get-Process | ForEach-Object { $procs[$_.Id] = $_.ProcessName }
$est = @(Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue | Where-Object { $_.RemoteAddress -notmatch '^(127\\.|::1|0\\.0\\.0\\.0|fe80)' } | ForEach-Object { [pscustomobject]@{ process = $procs[[int]$_.OwningProcess]; pid = $_.OwningProcess; remote = "$($_.RemoteAddress):$($_.RemotePort)"; local = $_.LocalPort } })
$lis = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -match '^(0\\.0\\.0\\.0|::)$' } | ForEach-Object { [pscustomobject]@{ process = $procs[[int]$_.OwningProcess]; pid = $_.OwningProcess; port = $_.LocalPort } })
[pscustomobject]@{ established = $est; listening = $lis } | ConvertTo-Json -Compress -Depth 4
`;
}

// Status i historia Windows Defendera (wykryte zagrozenia, ostatnie skany).
function defenderScript() {
  return `${HEAD}
$o = [ordered]@{}
try {
  $s = Get-MpComputerStatus
  $o.status = [ordered]@{ antivirus = [bool]$s.AntivirusEnabled; realtime = [bool]$s.RealTimeProtectionEnabled; signatures = [string]$s.AntivirusSignatureLastUpdated; signatureAge = [int]$s.AntivirusSignatureAge; lastQuickScan = [string]$s.QuickScanEndTime; lastFullScan = [string]$s.FullScanEndTime }
} catch { $o.status = @{ error = $_.Exception.Message } }
try {
  $o.threats = @(Get-MpThreatDetection -ErrorAction Stop | Sort-Object InitialDetectionTime -Descending | Select-Object -First 15 | ForEach-Object {
    $t = Get-MpThreat -ThreatID $_.ThreatID -ErrorAction SilentlyContinue
    [pscustomobject]@{ at = [string]$_.InitialDetectionTime; threat = if ($t) { [string]$t.ThreatName } else { [string]$_.ThreatID }; resources = @($_.Resources | Select-Object -First 2); remediated = [bool]$_.ActionSuccess }
  })
} catch { $o.threats = @() }
$o | ConvertTo-Json -Compress -Depth 5
`;
}

function defenderScanScript(kind) {
  const type = kind === 'full' ? 'FullScan' : 'QuickScan';
  return `${HEAD}
try { Update-MpSignature -ErrorAction Stop } catch {}
Start-MpScan -ScanType ${type} -AsJob | Out-Null
[pscustomobject]@{ ok = $true; started = ${q(type)} } | ConvertTo-Json -Compress
`;
}

// Zawieszenie/wznowienie procesu (kwarantanna: proces przestaje dzialac, ale
// nic nie jest kasowane, wiec mozna to cofnac). Procesow krytycznych systemu
// i samej aplikacji NIE ruszamy, cokolwiek by o to poprosic.
const PROTECTED = ['system', 'idle', 'registry', 'smss', 'csrss', 'wininit', 'winlogon', 'lsass', 'services', 'svchost', 'dwm', 'explorer', 'fontdrvhost', 'electron', 'j.a.r.v.i.s.', 'jarvis', 'powershell', 'node'];

function suspendScript(target, resume = false) {
  const t = String(target ?? '').trim().replace(/.exe$/i, '');
  const isPid = /^[0-9]+$/.test(t);
  return `${HEAD}
Add-Type -Namespace J -Name N -MemberDefinition '[DllImport("ntdll.dll")] public static extern uint NtSuspendProcess(System.IntPtr h); [DllImport("ntdll.dll")] public static extern uint NtResumeProcess(System.IntPtr h);'
$protected = @(${PROTECTED.map(q).join(',')})
$procs = @(${isPid ? `Get-Process -Id ${Number(t)} -ErrorAction SilentlyContinue` : `Get-Process -Name ${q(t)} -ErrorAction SilentlyContinue`})
if (-not $procs.Count) { [pscustomobject]@{ ok = $false; error = 'Nie ma takiego procesu.' } | ConvertTo-Json -Compress; exit }
$done = @()
foreach ($p in $procs) {
  if ($protected -contains $p.ProcessName.ToLower() -or $p.Id -eq $PID) { continue }
  try { [void][J.N]::${resume ? 'NtResumeProcess' : 'NtSuspendProcess'}($p.Handle); $done += $p.Id } catch {}
}
if (-not $done.Count) { [pscustomobject]@{ ok = $false; error = 'To proces chroniony albo nie udalo sie nim zarzadzac.' } | ConvertTo-Json -Compress; exit }
[pscustomobject]@{ ok = $true; ${resume ? 'resumed' : 'suspended'} = $done } | ConvertTo-Json -Compress
`;
}

module.exports = { suspendScript, PROTECTED, searchFilesScript, startupScript, networkScript, defenderScript, defenderScanScript, q };
