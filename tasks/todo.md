# Co-Viewer

## Anforderungen

- Privater Raum für zwei Personen mit synchroner MP4-Wiedergabe.
- Vor Anmeldung ausschließlich schwarzer Bildschirm und Raumcode-Eingabe.
- Erst nach gültigem Zugang die Filmübersicht und den Player laden.
- Öffentlich ausschließlich generischer Quellcode ohne konkrete Medienbezüge.
- Kein kostenpflichtiger Tarif, Probeabo, automatisches Upgrade oder Supportkontakt.

## Umsetzung

- [x] Synchronen Player und zwei Teilnehmerplätze implementieren.
- [x] Private Medienauslieferung, begrenzte Anmeldeversuche und getrennte Tokens.
- [x] Serverseitige Medienkonfiguration und allgemeine Seitenmetadaten.
- [x] Schwarzen Zugangsschirm vor die Filmübersicht setzen.
- [x] 27 Backend-/Modelltests, TypeScript und vorherige Browser-Synchronisierung.
- [x] Bereinigten generischen Quellstand veröffentlichen; alte Historie privat sichern.
- [x] Anonymen HTML-/JavaScript-Inhalt und neuen Login im Browser prüfen.
- [x] Geschützten Produktionsbuild und API mit zwei Sitzungen prüfen und veröffentlichen.
- [x] Mobile Darstellung, Abmelden, Neuladen und Abschlusskontrolle.

## Betrieb

Next.js / React, Vercel Hobby, private Blob-Datei und kleiner gemeinsamer Zustand.
Zustandsabfragen verlangen starke ETags ohne Kompression für bedingte Updates.
Leere POST-Streams werden korrekt verarbeitet. Raumzugänge gelten 24 Stunden,
Medienlinks vier Stunden, Präsenz 90 Sekunden. Umgebungen bleiben getrennt.
Private Betriebsdaten und Medien befinden sich ausschließlich in ignorierten Dateien
und serverseitigen Umgebungsvariablen.

## Abnahme

27 Tests, TypeScript und Produktionsbuild bestanden. Der echte API-Test prüft
Zugang, getrennte Token-Zwecke, zwei Plätze, Synchronisierung und privaten Stream.
Anonymes HTML und sieben öffentliche JavaScript-Dateien enthalten keine privaten
Medienbezüge; die Metadaten-, Medien- und Raumendpunkte antworten ohne Token mit 401.
Zwei Browser-Sitzungen spielten gleichzeitig, übernahmen Pause und Spulen und
stellten den Zustand nach Neuladen wieder her. Mobile Code-Eingabe bei 390x844
ohne Überlauf geprüft; Abmelden entfernt die private Ansicht. Testplätze sind frei.
Der geprüfte Produktionsbuild wurde veröffentlicht. Keine 5xx-Fehler im abgefragten
Logzeitraum. Hobby ist aktiv, ohne Probeabo oder Upgrade. Alte Quellhistorie ist
privat archiviert; das öffentliche Repository beginnt mit dem generischen Stand.

## Raumcode-Aktualisierung

- [x] Achtstellige Codes mit führender Null unterstützen; privaten Code aktualisieren.
- [ ] Regressionstest, Produktion veröffentlichen und neuen/alten Zugang prüfen.
