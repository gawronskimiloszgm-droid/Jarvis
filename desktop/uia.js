// Windows UI Automation (UIA): Jarvis widzi i klika NAZWANE elementy okna
// ("Zapisz", "Szukaj", pole adresu) zamiast zgadywac piksele z obrazka.
// Dziala z wiekszoscia klasycznych aplikacji Win32/WPF/UWP i przegladarkami
// (nie z grami i nie z elementami rysowanymi bez dostepnosci).
//
// Skrypty PowerShell sa budowane tutaj, a parametry wstrzykiwane WYLACZNIE
// jako literaly w apostrofach z podwojonymi apostrofami - nic od modelu nie
// trafia do skryptu jako kod.

const HEADER = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms
Add-Type -Namespace J -Name W -MemberDefinition '
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, System.IntPtr e);
'
$AE = [System.Windows.Automation.AutomationElement]
$hwnd = [J.W]::GetForegroundWindow()
$root = $AE::FromHandle($hwnd)
$wantedTypes = 'Button','Edit','MenuItem','ListItem','CheckBox','RadioButton','Hyperlink','TabItem','ComboBox','Text','TreeItem','SplitButton','Document'
function Get-Items($root) {
  $cond = New-Object System.Windows.Automation.AndCondition(
    (New-Object System.Windows.Automation.PropertyCondition($AE::IsOffscreenProperty, $false)),
    (New-Object System.Windows.Automation.PropertyCondition($AE::IsEnabledProperty, $true))
  )
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
  $out = New-Object System.Collections.ArrayList
  foreach ($el in $all) {
    try {
      $c = $el.Current
      $t = $c.ControlType.ProgrammaticName -replace '^ControlType\\.',''
      if ($wantedTypes -notcontains $t) { continue }
      $name = [string]$c.Name
      if (-not $name -and $t -ne 'Edit' -and $t -ne 'Document') { continue }
      $r = $c.BoundingRectangle
      if ($r.IsEmpty -or $r.Width -lt 2 -or $r.Height -lt 2) { continue }
      [void]$out.Add([pscustomobject]@{ el = $el; name = $name; type = $t; id = [string]$c.AutomationId; x = [int]($r.X + $r.Width / 2); y = [int]($r.Y + $r.Height / 2); w = [int]$r.Width; h = [int]$r.Height })
    } catch {}
    if ($out.Count -ge 400) { break }
  }
  return $out
}
$winTitle = ''
try { $winTitle = [string]$root.Current.Name } catch {}
`;

const q = (s) => `'${String(s ?? '').replace(/'/g, "''")}'`;

// Lista klikalnych/wpisywalnych elementow aktywnego okna.
function listScript(limit = 120) {
  return `${HEADER}
$items = Get-Items $root
$scr = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$list = @($items | Select-Object -First ${Number(limit) | 0} | ForEach-Object {
  [pscustomobject]@{ name = $_.name; type = $_.type; id = $_.id; x = $_.x; y = $_.y; px = [math]::Round(100 * $_.x / $scr.Width, 1); py = [math]::Round(100 * $_.y / $scr.Height, 1) }
})
[pscustomobject]@{ window = $winTitle; screen = @($scr.Width, $scr.Height); elements = $list } | ConvertTo-Json -Compress -Depth 4
`;
}

// Znajduje element po nazwie (dokladna > poczatek > zawieranie) i klika/wywoluje.
function clickScript(name, type) {
  return `${HEADER}
$want = ${q(name)}.ToLower()
$wantType = ${q(type)}
$items = Get-Items $root | Where-Object { -not $wantType -or $_.type -eq $wantType }
$best = $items | Where-Object { $_.name.ToLower() -eq $want } | Select-Object -First 1
if (-not $best) { $best = $items | Where-Object { $_.name.ToLower().StartsWith($want) } | Select-Object -First 1 }
if (-not $best) { $best = $items | Where-Object { $_.name.ToLower().Contains($want) } | Select-Object -First 1 }
if (-not $best) { [pscustomobject]@{ ok = $false; error = 'Nie znalazlem elementu o takiej nazwie w aktywnym oknie.'; window = $winTitle } | ConvertTo-Json -Compress; exit }
$how = 'klik'
try {
  $p = $best.el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $p.Invoke(); $how = 'invoke'
} catch {
  [J.W]::SetCursorPos($best.x, $best.y) | Out-Null
  Start-Sleep -Milliseconds 40
  [J.W]::mouse_event(0x0002, 0, 0, 0, [System.IntPtr]::Zero)
  [J.W]::mouse_event(0x0004, 0, 0, 0, [System.IntPtr]::Zero)
}
[pscustomobject]@{ ok = $true; clicked = $best.name; type = $best.type; how = $how; window = $winTitle } | ConvertTo-Json -Compress
`;
}

// Wpisuje tekst w pole (po nazwie albo pierwsze pole edycji okna).
function typeScript(name, text) {
  return `${HEADER}
$want = ${q(name)}.ToLower()
$items = Get-Items $root | Where-Object { $_.type -eq 'Edit' -or $_.type -eq 'Document' -or $_.type -eq 'ComboBox' }
$best = $null
if ($want) {
  $best = $items | Where-Object { $_.name.ToLower() -eq $want } | Select-Object -First 1
  if (-not $best) { $best = $items | Where-Object { $_.name.ToLower().Contains($want) } | Select-Object -First 1 }
} else { $best = $items | Select-Object -First 1 }
if (-not $best) { [pscustomobject]@{ ok = $false; error = 'Nie znalazlem pola do wpisania tekstu.'; window = $winTitle } | ConvertTo-Json -Compress; exit }
$how = 'value'
try {
  $vp = $best.el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
  $vp.SetValue(${q(text)})
} catch {
  $best.el.SetFocus()
  Start-Sleep -Milliseconds 80
  [System.Windows.Forms.Clipboard]::SetText(${q(text)})
  [System.Windows.Forms.SendKeys]::SendWait('^v')
  $how = 'wklejone'
}
[pscustomobject]@{ ok = $true; field = $best.name; type = $best.type; how = $how; window = $winTitle } | ConvertTo-Json -Compress
`;
}

module.exports = { listScript, clickScript, typeScript, q };
