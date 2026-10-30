# Lokalny syntezator glosu

Silnik: Chatterbox Multilingual (licencja MIT), klon glosu z probki, obsluguje polski.
Dziala na tym komputerze, nasluch tylko na 127.0.0.1. Model pobiera sie raz (kilka GB).

1. Instalacja: `powershell -ExecutionPolicy Bypass -File voice-server\install.ps1`
2. Start: `D:\JarvisVoice\start.bat` (aplikacja desktopowa uruchamia go sama)
3. W Jarvisie: Ustawienia -> SYNTEZATOR GLOSU: wgraj probke (10-30 s czystej mowy, bez muzyki) i wlacz.

Po 30 min bezczynnosci model zwalnia pamiec karty i wraca sam przy nastepnym zdaniu.
Probki i pamiec podreczna sa w `D:\JarvisVoice`, poza repozytorium.
