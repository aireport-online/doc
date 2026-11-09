# Doc

Een online tekstverwerker waarin je samen in één document schrijft, met volledige versiegeschiedenis.

- **Samenwerken in realtime**: iedereen met de link schrijft tegelijk in hetzelfde document. Je ziet elkaars cursor, selectie en naam, en wie het document open heeft. Wijzigingen worden zonder conflicten samengevoegd (CRDT), ook als je verbinding even wegvalt.
- **Versies**: tijdens het schrijven wordt elke paar minuten en na elke schrijfsessie automatisch een versie bewaard. Je kunt zelf een stand een naam geven, een versie bekijken met gemarkeerde wijzigingen (toegevoegd, verwijderd, opmaak gewijzigd) ten opzichte van de vorige, en een versie herstellen. Herstellen bewaart eerst de huidige stand, dus er gaat niets verloren.
- **Delen via links**: elk document heeft een link om mee te schrijven en een aparte link om alleen te lezen. Accounts zijn niet nodig.
- **Tekstverwerker**: koppen, vet, cursief, onderstrepen, doorhalen, markeren, links, opsommingen, genummerde lijsten en takenlijsten, uitlijning, citaten, codeblokken, tabellen en afbeeldingen (plakken, slepen of kiezen).
- **Exporteren**: afdrukken of opslaan als pdf, downloaden als html of markdown.

## Starten

Vereist Node.js 20 of nieuwer.

```bash
npm install
```

```bash
npm run dev
```

De app staat dan op http://localhost:5173 (de server zelf op poort 3001).

Voor productie:

```bash
npm run build
```

```bash
npm start
```

Eén proces serveert dan de webapp, de API en de websocket op http://localhost:3001.

Of met Docker:

```bash
docker build -t doc .
```

```bash
docker run -p 3001:3001 -v doc-data:/data doc
```

### Instellingen

| Variabele | Standaard | Betekenis |
| --- | --- | --- |
| `PORT` | `3001` | Poort van de server |
| `HOST` | `0.0.0.0` | Adres waarop de server luistert |
| `DATABASE_PATH` | `data/doc.sqlite` | Plaats van de SQLite-database (documenten, versies, afbeeldingen) |
| `AUTO_VERSION_MINUTES` | `5` | Hoe vaak er tijdens het schrijven hooguit een automatische versie bijkomt |

Zet de server achter een proxy met https; die moet websockets doorlaten op `/ws/`.

## Testen

```bash
npm test
```

```bash
npm run typecheck
```

De tests starten de echte server en verbinden er meerdere schrijvers mee: synchronisatie, alleen-lezen, versies bewaren, herstellen en verwijderen, bewaren over een herstart, en de vergelijking tussen versies.

## Hoe het werkt

```
server/   Express + ws. Houdt per open document een Yjs-document in het geheugen,
          synchroniseert het met alle verbonden browsers en schrijft het naar SQLite.
src/      React + Tiptap (ProseMirror). De editor is gekoppeld aan hetzelfde Yjs-document.
test/     node:test
```

- **Synchronisatie** (`server/collab.ts`): het standaard y-websocket-protocol. Een verbinding via de leeslink mag het document opvragen, maar wijzigingen van die verbinding worden door de server genegeerd.
- **Versies**: een versie is een momentopname van de volledige Yjs-toestand, met titel, aantal woorden en wie er sinds de vorige versie aan schreef. De browser zet zo'n momentopname om naar een document en vergelijkt het woord voor woord met de vorige versie (`src/lib/diff.ts`). Herstellen gebeurt op de server in één transactie, zodat iedereen die het document open heeft de herstelde inhoud direct ziet. Van de automatische versies zonder naam blijven de laatste 150 bewaard; versies met een naam blijven altijd.
- **Toegang**: de bewerklink en de leeslink bevatten elk een onraadbare sleutel. Wie de bewerklink heeft, kan alles: bewerken, versies herstellen en het document verwijderen. Er zijn geen accounts; de lijst "Documenten" op de startpagina wordt in de browser onthouden.

## Bekende grenzen

- Iedereen die de server kan bereiken, kan een nieuw document aanmaken. Zet de app achter eigen toegangscontrole (bijvoorbeeld een VPN of inlogproxy) als dat niet de bedoeling is.
- Eén serverproces houdt de open documenten in het geheugen; meerdere processen naast elkaar draaien wordt niet ondersteund.
- Opmerkingen bij tekst en een suggestiemodus zijn er nog niet.
