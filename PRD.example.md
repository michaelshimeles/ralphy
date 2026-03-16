# Example Project PRD

Ein einfaches Beispiel-Projekt, um Ralphy zu demonstrieren.

## Kontext

Wir bauen eine kleine CLI-Anwendung, die Markdown-Dateien in HTML konvertiert.

## Tasks

- [ ] Projekt-Setup: package.json erstellen mit TypeScript und Vitest
- [ ] Funktion schreiben, die Markdown-Headings (#, ##, ###) in HTML-Tags konvertiert
- [ ] Funktion schreiben, die **bold** und *italic* Text konvertiert
- [ ] Funktion schreiben, die Listen (- item) in HTML-Listen konvertiert
- [ ] CLI-Entry-Point erstellen, der eine Datei einliest und konvertiert
- [ ] README.md mit Nutzungsanleitung schreiben

## Akzeptanzkriterien

- Alle Tests gruen
- TypeScript kompiliert ohne Fehler
- CLI kann mit `npx ts-node src/index.ts input.md` ausgefuehrt werden

## Notizen

- Keine externen Markdown-Libraries verwenden (Lernzweck)
- Einfache Regex-basierte Konvertierung reicht aus
