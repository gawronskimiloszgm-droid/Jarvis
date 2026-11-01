// Sprawdzenie i uruchomienie odtwarzania Spotify przez systemowe sterowanie multimediami Windows.
// Klawisz multimedialny tylko przelacza stan, wiec na grajacej muzyce zatrzymalby ja. TryPlay nie.
//
// Sprawdzone na aplikacji ze Sklepu Microsoft: samo "spotify:" zostawia pauze, a link do utworu
// zwykle gra sam, ale potrafi zostac na pauzie, stad odczekanie przed wymuszeniem przy linku.

const BASE = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$T=[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
$A=([System.WindowsRuntimeSystemExtensions].GetMethods()|?{$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'})[0]
function W($o,$t){$k=$A.MakeGenericMethod($t).Invoke($null,@($o));[void]$k.Wait(4000);$k.Result}
function S{(W ($T::RequestAsync()) $T).GetSessions()|?{$_.SourceAppUserModelId -match 'spotify'}|select -First 1}
`;

/** openFirst: uruchom aplikacje, gdy jej nie ma. forceAfter: po ilu sekundach wymuszac start. limit: jak dlugo w ogole czekac. */
function ensurePlayingScript({ openFirst = false, forceAfter = 0, limit = 15 } = {}) {
  return `$ErrorActionPreference='SilentlyContinue'
${BASE}
${openFirst ? "if(-not (S)){Start-Process 'spotify:'}" : ''}
$t0=Get-Date;$on=$false;$s=$null
while(((Get-Date)-$t0).TotalSeconds -lt ${limit}){
$s=S
if($s){
if("$($s.GetPlaybackInfo().PlaybackStatus)" -eq 'Playing'){$on=$true;break}
if(((Get-Date)-$t0).TotalSeconds -ge ${forceAfter}){[void](W ($s.TryPlayAsync()) ([bool]))}
}
Start-Sleep -Milliseconds 1500
}
$n='';if($s){$i=W ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]);if($i.Title){$n="$($i.Artist) - $($i.Title)"}}
@{playing=$on;tytul=$n}|ConvertTo-Json -Compress`;
}

/** Odpowiedz skryptu; zepsuta albo pusta znaczy, ze nic nie gra. */
function parseResult(output) {
  try {
    const m = /\{[\s\S]*\}/.exec(String(output || ''));
    const r = JSON.parse(m[0]);
    return { playing: r.playing === true, tytul: String(r.tytul || '') };
  } catch {
    return { playing: false, tytul: '' };
  }
}

module.exports = { ensurePlayingScript, parseResult };
