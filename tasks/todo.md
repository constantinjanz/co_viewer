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
- [ ] Bereinigten generischen Quellstand veröffentlichen; alte Historie privat sichern.
- [ ] Anonymen HTML-/JavaScript-Inhalt und neuen Login im Browser prüfen.
- [ ] Geschützten Produktionsbuild prüfen, veröffentlichen und zwei Sitzungen testen.
- [ ] Mobile Darstellung, Abmelden, Neuladen und Abschlusskontrolle.

## Betrieb

Next.js / React, Vercel Hobby, private Blob-Datei und kleiner gemeinsamer Zustand.
Zustandsabfragen verlangen starke ETags ohne Kompression für bedingte Updates.
Leere POST-Streams werden korrekt verarbeitet. Raumzugänge gelten 24 Stunden,
Medienlinks vier Stunden, Präsenz 90 Sekunden. Umgebungen bleiben getrennt.
Private Betriebsdaten und Medien befinden sich ausschließlich in ignorierten Dateien
und serverseitigen Umgebungsvariablen.
