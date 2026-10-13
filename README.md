# co_viewer

Ein privater Co-Viewer für zwei Personen. Ein schwarzer Zugangsschirm zeigt nur
das Raumcode-Feld. Erst nach gültigem Code werden die private Filmübersicht und
anschließend der gemeinsame Player geladen. Abspielen, Pausieren und Spulen
gelten für beide; Lautstärke und Vollbild bleiben individuell.

## Datenschutz und Aufbau

- Next.js und TypeScript auf Vercel, Funktionen in Frankfurt.
- Filmtitel, Dauer und Medienpfad werden ausschließlich serverseitig konfiguriert.
  Öffentlicher HTML-Code, JavaScript und Git-Historie enthalten keine konkreten
  Filmdaten. Metadaten bleiben allgemein, Suchmaschinen werden ausgeschlossen.
- Der Raumcode wird serverseitig als Hash geprüft; Fehlversuche sind begrenzt.
- Ein signierter Lobbyzugang gilt 24 Stunden und belegt keinen Zuschauerplatz.
- Ein separater Teilnehmerzugang schützt Raumsteuerung und Medienlinks.
- Höchstens zwei aktive Zuschauer; ein verlassener Platz wird wieder frei.
- Private MP4-Auslieferung per befristetem Link direkt aus Vercel Blob.
- Synchronisierung etwa alle zwei Sekunden, Heartbeat alle 20 Sekunden.
  Ungecachte Zustandsabfragen und bedingte Schreibvorgänge verhindern Datenverlust
  bei gleichzeitigen Aktionen. Neuladen stellt die Sitzung im Browsertab wieder her.
- Entwicklung, Vorschau und Produktion verwenden getrennte Zustandsbereiche.
- Medien und Zugangsdaten gehören weder ins Repository noch ins Deployment-Paket.

## Einrichtung

1. Node.js 24, dann `npm ci`.
2. Vercel-Projekt mit einem privaten Blob-Store verbinden.
3. `.env.example` als Vorlage für lokale und serverseitige Variablen nutzen.
   `MOVIE_TITLE`, `MOVIE_DURATION` (Sekunden), `MOVIE_RESOLUTION` und `MOVIE_YEAR`
   beschreiben das private Medium. Diese Variablen dürfen kein `NEXT_PUBLIC_`-Präfix
   erhalten und werden nicht an anonyme Besucher gesendet.
4. `scripts/create-access.mjs` erzeugt einen neuen Code und Sitzungsschlüssel in
   ignorierten Dateien. Nicht bei jedem Start ausführen: Das rotiert den Zugang.
5. `node --env-file=.env.local scripts/upload-film.mjs PFAD_ZUR_MP4` lädt eine
   browserkompatible MP4 hoch. Der Medienpfad kommt aus `MEDIA_BLOB_PATH`.
6. `npm run dev -- --port 3001` starten. Mit `npm test`, `npm run typecheck` und
   `npm run build` prüfen. `node scripts/check-room.mjs http://localhost:3001`
   testet den echten Zugang, zwei Teilnehmer, Synchronisierung und privaten Stream.
7. Produktionsbuild zunächst geschützt bereitstellen, testen und erst danach
   mit `vercel promote` veröffentlichen.

## Grenzen

Ein konfiguriertes Medium, ein privater Raum, keine Upload-Oberfläche oder
Benutzerkonten. Die kostenlosen Vercel-Kontingente begrenzen Speicher, Transfer
und Synchronisierungsabfragen. Die Anwendung führt keinen Tarifwechsel aus.
Erschöpfte Kontingente können den Dienst unterbrechen. Der Upload verweigert
Dateien über 900 MB, vorhandene Zieldateien und mehr als 950 MB belegten Speicher;
zusätzlich muss die bisherige Kontonutzung vor einem Upload geprüft werden.
