# Spieleabend: Host-Bildschirm + Handys

Drei Spiele: Schätz-Duell, Leopardy (mit Buzzer) und Erklären & Pantomime.
Der Laptop/TV ist der Host-Bildschirm, alle anderen spielen am Handy.

## Starten (zu Hause im WLAN)
1. Node.js 18 oder neuer installieren: https://nodejs.org
2. Ordner entpacken und starten:
   - Windows: Doppelklick auf `start.bat`
   - Mac: Doppelklick auf `start.command` (beim ersten Mal: Rechtsklick → Öffnen)
   - oder im Terminal: `node server.js`
3. Im Browser des Laptops öffnet sich `http://localhost:3000/host`.
   Dort erscheint ein QR-Code. Laptop und Handys müssen im selben WLAN sein.
4. Alle scannen den QR-Code, geben ihren Namen ein und werden automatisch auf Teams verteilt.
5. Am Host-Bildschirm wählst du das Spiel und startest.

Tipp: Laptop per HDMI an den Fernseher hängen und „Vollbild“ drücken.

## Die Spiele
- **Schätz-Duell:** Alle schätzen gleichzeitig am Handy. Wer am nächsten dran ist: +1, weniger als 5 % daneben: +1 Bonus. Wertung jeder für sich oder für das Team.
- **Leopardy:** Das Team am Zug wählt am Handy ein Feld. Dann buzzern alle. Falsch = Minuspunkte, dann dürfen die anderen Teams buzzern. Wer richtig liegt, wählt das nächste Feld.
- **Erklären & Pantomime:** Das Team schickt jemanden vor („Ich mach's!“ am Handy). Nur diese Person sieht die Begriffe auf ihrem Handy. Bis die Zeit um ist, kommt nach jedem Treffer der nächste Begriff. Alle Punkte der Runde zählen.

Bei Leopardy und Erklären & Pantomime wählst du vor dem Start, wie geantwortet wird:
- **Rausrufen:** Alle rufen laut. Bei Erklären & Pantomime drückt die Person, die erklärt oder vorspielt, „Richtig!“, erst dann kommt der nächste Begriff. Bei Leopardy entscheidest du am Host-Bildschirm mit Richtig/Falsch („Lösung gedrückt halten“ zeigt dir kurz die Lösung).
- **Eintippen:** Die Lösung wird am Handy eingetippt und automatisch geprüft, kleine Tippfehler sind egal.

Am Host-Bildschirm kannst du jederzeit Punkte korrigieren (+/− neben dem Teamstand),
Teams neu mischen, Leute entfernen oder ein Spiel vorzeitig beenden.

## Probleme?
- **Handy lädt nicht:** Gleiches WLAN? Gäste-WLANs blockieren das oft. Dann einen Handy-Hotspot nehmen und den Laptop damit verbinden.
- **Windows-Firewall fragt:** „Zugriff zulassen“ für private Netzwerke.
- **Anderer Port:** `PORT=4000 node server.js` (Windows: `set PORT=4000 && node server.js`).
- Der Spielstand liegt nur im Arbeitsspeicher. Nach einem Neustart des Servers einfach den neuen QR-Code scannen.

## Online stellen über GitHub + Render (gratis)
Vercel und GitHub Pages passen nicht: Der Server hält die Räume im Arbeitsspeicher und braucht dauerhaft offene Verbindungen.
Render startet dagegen einen normalen Node-Server, den es direkt aus GitHub baut.

1. Neues GitHub-Repository anlegen und den Inhalt dieses Ordners hochladen.
2. Auf https://render.com mit GitHub anmelden → „New“ → „Blueprint“ → das Repository wählen.
   Die Datei `render.yaml` stellt alles richtig ein (Free-Plan, Start mit `node server.js`).
3. Nach ein paar Minuten bekommst du eine Adresse wie `https://spieleabend-xxxx.onrender.com`.
   Host-Bildschirm: `…onrender.com/host`. Der QR-Code zeigt automatisch auf die öffentliche Adresse.

Gut zu wissen beim Gratis-Plan:
- Nach 15 Minuten ohne Anfragen schläft der Server ein. Der erste Aufruf danach dauert ca. 1 Minute.
  Solange der Host-Bildschirm offen ist, pingt er den Server regelmäßig an und hält ihn wach.
- Schläft er doch ein oder wird neu gestartet, sind die Räume weg: dann einfach den neuen QR-Code scannen.
- Jede Gruppe hat ihren eigenen Raum-Code, mehrere Spieleabende gleichzeitig sind kein Problem.

## KI-Helfer (optional, über Groq)
Mit einem kostenlosen Groq-Schlüssel hilft eine KI in allen Spielen mit:
- **Stadt-Land-Fluss:** prüft jede Antwort sofort (gibt es das, passt es zur Kategorie?).
- **Leopardy und Erklären/Pantomime/Zeichnen (Eintippen):** erkennt richtige Antworten, die anders geschrieben sind (Synonyme, Kurzformen, englische Namen).
- **KI-Moderator:** ein lockerer Satz nach jeder Schätz-Auflösung, jeder Stadt-Land-Fluss-Runde und am Spielende.

Einrichten:
1. Auf https://console.groq.com anmelden → „API Keys“ → neuen Schlüssel erstellen und kopieren.
2. Bei Render: Dienst „spieleabend“ → „Environment“ → `GROQ_API_KEY` mit dem Schlüssel eintragen → speichern (Render startet neu).
3. Lokal: `GROQ_API_KEY=dein_schlüssel node server.js` (Windows: `set GROQ_API_KEY=dein_schlüssel && node server.js`).

Am Host-Bildschirm steht in der Lobby, ob die KI bereit ist, und man kann sie dort ausschalten.
Ohne Schlüssel laufen alle Spiele normal weiter, nur ohne KI-Prüfung (bei Stadt-Land-Fluss zählt dann der Anfangsbuchstabe, der Host kann streichen).
Der Gratis-Tarif hat Grenzen (ungefähr 30 Anfragen pro Minute und 1.000 pro Tag), deshalb bündelt das Spiel die Prüfungen.

## Keine Wiederholungen
Der Host-Browser merkt sich, welche Fragen, Begriffe und Kategorien schon dran waren, auch über Neustarts hinweg.
Erst wenn eine Liste komplett durch ist, fängt sie von vorne an. Wer das zurücksetzen will: Browserdaten der Seite löschen.
