# Lokalny, w pelni darmowy wykrywacz slowa "Jarvis" dla aplikacji desktopowej.
# Elektronowe Chromium nie ma dostepu do silnika Web Speech API (brak klucza
# Google), wiec zamiast tego korzystamy z wbudowanego w Windows rozpoznawania
# mowy (System.Speech) - dziala offline, bez limitow, bez kluczy API.
# Kazde wykrycie slowa "Jarvis" drukuje linie "WAKE" na stdout, ktora czyta
# proces glowny Electrona (main.js) i przekazuje dalej do okna aplikacji.

Add-Type -AssemblyName System.Speech

$recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$choices = New-Object System.Speech.Recognition.Choices
$choices.Add("Jarvis")
$grammarBuilder = New-Object System.Speech.Recognition.GrammarBuilder
$grammarBuilder.Append($choices)
$grammar = New-Object System.Speech.Recognition.Grammar($grammarBuilder)
$recognizer.LoadGrammar($grammar)
$recognizer.SetInputToDefaultAudioDevice()

Register-ObjectEvent -InputObject $recognizer -EventName SpeechRecognized -Action {
    [Console]::Out.WriteLine("WAKE")
    [Console]::Out.Flush()
} | Out-Null

$recognizer.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)

while ($true) {
    Start-Sleep -Seconds 2
}
