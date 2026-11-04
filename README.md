# Fluks Boeken

Een herbruikbaar online boekingssysteem voor kleine afspraakbedrijven: autodetailers, kappers, trimsalons, garages en vergelijkbare zaken. Volledig in het Nederlands, mobiel eerst, en te draaien op het **gratis plan van Cloudflare**.

Per klant maak je één installatie, die je instelt met één configbestand: [`klant.config.ts`](klant.config.ts).

---

## Inhoud

1. [Wat kan het?](#wat-kan-het)
2. [Snel proberen: de demo](#snel-proberen-de-demo)
3. [Per klant installeren (stap voor stap)](#per-klant-installeren-stap-voor-stap)
4. [De configuratie uitgelegd](#de-configuratie-uitgelegd)
5. [Automatische berichten](#automatische-berichten)
6. [E-mail (SMTP) instellen](#e-mail-smtp-instellen)
7. [Demo online zetten voor prospects](#demo-online-zetten-voor-prospects)
8. [Kosten: Cloudflare gratis plan](#kosten-cloudflare-gratis-plan)
9. [Privacy (AVG)](#privacy-avg)
10. [Beveiliging](#beveiliging)
11. [Ontwikkelen en testen](#ontwikkelen-en-testen)
12. [Updates uitrollen naar klanten](#updates-uitrollen-naar-klanten)

---

## Wat kan het?

**Voor de klant (de boekingspagina)**

- Behandeling kiezen, met duur en vanaf-prijs.
- Een dag kiezen en alleen tijden zien die écht vrij zijn: rekening houdend met de duur, openingstijden, pauzes, feestdagen, opruimtijd (buffer), het aantal plekken, blokkades en bestaande afspraken.
- Gegevens invullen, plus eigen extra velden per bedrijf (bijv. kenteken of naam van de hond).
- Optioneel foto's meesturen (bijv. van de auto of de hond). Ze worden in de browser verkleind en na 30 dagen automatisch verwijderd.
- Losse toestemmingsvinkjes voor herinneringen, een reviewverzoek en onderhouds-/seizoensberichten. **Standaard staan ze allemaal uit.**
- Een eigen afspraakpagina met "Zet in je agenda" (.ics en Google Agenda) en zelf annuleren tot een instelbaar aantal uur vooraf.
- Werkt ook zonder JavaScript, is snel (geen frameworks in de browser) en toegankelijk (getest met axe-core op WCAG 2.1 AA).

**Voor het bedrijf (het beheer, achter een wachtwoord)**

- Overzicht met nieuwe aanvragen: **accepteren of weigeren met één klik** (eventueel met een toelichting).
- Dubbele boekingen zijn onmogelijk, ook als twee klanten tegelijk op hetzelfde tijdstip klikken (zie [hoe](#hoe-dubbele-boekingen-worden-voorkomen)).
- Dag- en weekagenda, afspraak verzetten (met suggesties van vrije tijden), "klaar"-melden, annuleren, "niet verschenen", interne notities.
- Telefonische afspraken invoeren en tijden blokkeren (vakantie, tandarts, onderhoud).
- **iCal-feed**: alle afspraken automatisch in Google Agenda, Apple Agenda of Outlook.
- Berichtenlog met voorbeeldweergave van elke e-mail, en een knop voor een testmail.
- AVG-knop om alle gegevens van een klant te wissen.

**Automatisch (e-mail via SMTP, met nette Nederlandse sjablonen)**

- Ontvangstbevestiging en bevestiging, afwijzing, verzet- en annuleringsbericht.
- Herinnering 24 uur vooraf (alleen met toestemming).
- "Klaar"-bericht met één klik vanuit het beheer.
- Reviewverzoek na afloop met precies één herinnering, met een link naar het Google-profiel. **Geen review-gating**: iedereen krijgt dezelfde link, er wordt niet eerst gevraagd of iemand tevreden was.
- Onderhouds- en seizoensherinneringen (alleen met toestemming).
- Melding aan de eigenaar bij elke nieuwe aanvraag.

**Demo-modus** met het fictieve autodetailbedrijf **Glans & Co** en realistische voorbeelddata rond de dag van vandaag, om aan prospects te laten zien.

### Techniek in het kort

| Onderdeel | Keuze |
| --- | --- |
| Server | Cloudflare Workers + [Hono](https://hono.dev), TypeScript, server-side gerenderde HTML (Hono JSX) |
| Database | Cloudflare D1 (SQLite) |
| E-mail | SMTP via Cloudflare TCP-sockets ([worker-mailer](https://github.com/zou-yu/worker-mailer)) |
| Geplande taken | Cron Trigger, elke 15 minuten |
| Statische bestanden | Workers Static Assets (map `public/`) |
| Tests | Vitest in de echte Workers-runtime (`@cloudflare/vitest-plugin`) |

```
klant.config.ts          ← het enige bestand dat je per klant aanpast
wrangler.jsonc           ← Cloudflare-instellingen (naam + database-id per klant)
migrations/              ← databaseschema
public/                  ← CSS, JavaScript, logo's (public/klant/ voor het logo van de klant)
src/
  config/                ← schema, validatie, demo-config (Glans & Co)
  lib/                   ← tijdrekening, beschikbaarheid, iCal, beveiliging, kleuren
  db/                    ← databasefuncties (incl. atomische boeking)
  berichten/             ← e-mailsjablonen, opmaak, SMTP, berichtenlog
  views/, routes/        ← pagina's voor klant en beheer
  acties.ts              ← boeken, accepteren, verzetten, klaar melden, ...
  planner.ts             ← geplande berichten en opruimtaken (cron)
  demo/                  ← demodata
test/                    ← Vitest-tests
```

---

## Snel proberen: de demo

Je hebt [Node.js](https://nodejs.org) 20 of nieuwer nodig. Een Cloudflare-account is voor lokaal draaien niet nodig. Haal eerst het project op en ga de map in (alle `npm`-commando's werken alleen binnen de map `fluks-boeken`):

```bash
git clone https://github.com/nealharpal0/fluks-boeken.git
```

```bash
cd fluks-boeken
```

```bash
npm install
```

> Met npm 11/12 zie je mogelijk geen waarschuwing over "install scripts": de benodigde uitzonderingen (esbuild en workerd) staan al in `allowScripts` in `package.json`.

```bash
npm run demo
```

Open daarna <http://localhost:8787>. Het beheer staat op <http://localhost:8787/beheer>, het wachtwoord in de demo is `demo`. Onder **Beheer → Berichten** zie je precies welke e-mails een klant zou krijgen (in de demo wordt niets echt verstuurd).

---

## Per klant installeren (stap voor stap)

Reken op ongeveer een half uur per klant. Je hebt nodig:

- Node.js 20 of nieuwer;
- een **Cloudflare-account** (gratis). Het is verstandig om per klant een eigen account te gebruiken, het liefst op naam van de klant (zie [kosten](#kosten-cloudflare-gratis-plan) en [privacy](#privacy-avg));
- de **SMTP-gegevens** van het e-mailadres waarmee de klant mailt (zie [E-mail](#e-mail-smtp-instellen));
- het logo van de klant (SVG voor de website, PNG voor e-mails) en de link naar het Google-reviewformulier.

### Stap 1 – Een kopie voor de klant maken

Maak per klant een eigen kopie (bijvoorbeeld een privé-repository `fluks-boeken-bakkerij-jansen`) zodat de configuratie van klanten gescheiden blijft:

```bash
git clone https://github.com/nealharpal0/fluks-boeken.git fluks-boeken-klantnaam
```

```bash
cd fluks-boeken-klantnaam
```

```bash
npm install
```

Wil je later updates kunnen binnenhalen, houd dan de originele repository als `upstream` aan (zie [Updates uitrollen](#updates-uitrollen-naar-klanten)).

### Stap 2 – Inloggen bij Cloudflare

```bash
npx wrangler login
```

### Stap 3 – Database aanmaken (in de EU)

```bash
npx wrangler d1 create fluks-klantnaam --jurisdiction=eu
```

Je krijgt een `database_id` terug. Zet die in [`wrangler.jsonc`](wrangler.jsonc) bij `d1_databases`, en pas daar ook `"name"` aan (bijv. `"fluks-klantnaam"`; dit wordt ook het standaardadres `fluks-klantnaam.<jouw-account>.workers.dev`).

### Stap 4 – De configuratie invullen

1. Zet het logo in `public/klant/` (bijv. `logo.svg` en `logo.png`).
2. Vul [`klant.config.ts`](klant.config.ts) in: bedrijfsgegevens, kleuren, behandelingen, openingstijden, e-mail, enzovoort. Het bestand staat vol uitleg; de details staan [hieronder](#de-configuratie-uitgelegd).
3. Controleer de configuratie:

```bash
npm run check-config
```

Fouten (✖) moet je oplossen; waarschuwingen (⚠) zijn tips. Het script waarschuwt ook als er nog voorbeeldgegevens (`.example`) in staan. Een typecontrole van alles doe je met `npm run check`.

Je kunt de site van de klant lokaal bekijken met `npm run dev` (zet dan eerst de geheimen uit stap 5 in een bestand `.dev.vars`, zie [`.dev.vars.voorbeeld`](.dev.vars.voorbeeld)).

### Stap 5 – Geheimen instellen

Wachtwoorden staan nooit in de code, maar als versleutelde geheimen bij Cloudflare. Elk commando vraagt om de waarde:

```bash
npx wrangler secret put BEHEER_WACHTWOORD
```

```bash
npx wrangler secret put GEHEIME_SLEUTEL
```

```bash
npx wrangler secret put SMTP_WACHTWOORD
```

- `BEHEER_WACHTWOORD`: het wachtwoord waarmee de klant inlogt op `/beheer` (minimaal 10 tekens; kies een lange zin).
- `GEHEIME_SLEUTEL`: minimaal 32 willekeurige tekens. Hiermee worden inlogsessies en de agenda-link ondertekend. Genereer er een met:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

- `SMTP_WACHTWOORD`: het wachtwoord (of app-wachtwoord) van het SMTP-account.

> Tip: als je `GEHEIME_SLEUTEL` later vervangt, worden alle sessies uitgelogd en verandert de agenda-link.

### Stap 6 – Database klaarzetten en publiceren

```bash
npm run db:migreer
```

```bash
npm run deploy
```

De site staat nu op `https://<name>.<jouw-account>.workers.dev`.

### Stap 7 – Eigen domein koppelen (aanbevolen)

1. Zet het domein van de klant bij Cloudflare (gratis), of gebruik een subdomein zoals `boeken.klantnaam.nl`.
2. In het Cloudflare-dashboard: **Workers & Pages → jouw Worker → Settings → Domains & Routes → Add → Custom domain** en vul `boeken.klantnaam.nl` in.
3. Zet hetzelfde adres in `klant.config.ts` bij `basisUrl` (dit wordt gebruikt voor links in e-mails) en publiceer opnieuw met `npm run deploy`.

### Stap 8 – Controleren

1. Ga naar `/beheer`, log in en kijk of er bovenaan geen configuratiewaarschuwingen staan.
2. **Instellingen → Stuur een testmail.** Komt hij niet aan? Kijk onder **Berichten** naar de foutmelding.
3. **Instellingen → Agenda koppelen**: kopieer de link en voeg hem toe in Google/Apple Agenda.
4. Maak zelf een testafspraak via de boekingspagina, accepteer hem in het beheer en annuleer hem daarna.
5. Zet een link naar de boekingspagina op de website, Google-profiel ("Afspraak maken") en Instagram van de klant.

---

## De configuratie uitgelegd

Alles staat in [`klant.config.ts`](klant.config.ts). Tijden schrijf je als `"UU:MM"` (24-uurs) en tijdvakken als `"09:00-17:30"`. Het type staat in [`src/config/schema.ts`](src/config/schema.ts), zodat je editor je helpt met aanvullen.

| Onderdeel | Wat stel je in |
| --- | --- |
| `bedrijf` | Naam, slogan, logo (`logo` voor de site, `logoEmail` als PNG voor e-mails), adres, telefoon, e-mail, KvK, `googleReviewUrl`, eventueel een eigen `privacyUrl`. |
| `huisstijl` | `primaireKleur` (hexcode) en optioneel `accentKleur`. De tekstkleur op knoppen en de linkkleur worden automatisch zo gekozen dat ze goed leesbaar zijn (WCAG-contrast). |
| `basisUrl` | Het openbare adres, bijv. `https://boeken.klantnaam.nl` (zonder `/` aan het eind). Kan ook met de variabele `BASIS_URL` in `wrangler.jsonc`. |
| `tijdzone` | Standaard `Europe/Amsterdam`. Zomer- en wintertijd gaan automatisch goed. |
| `behandelingen` | Per behandeling: `id` (voor de URL), `naam`, `omschrijving`, `duurMinuten`, `vanafPrijs`, optioneel `onderhoudNaWeken` + `onderhoudTekst`, en `actief: false` om tijdelijk te verbergen. |
| `openingstijden` | Per weekdag een tijdvak, meerdere tijdvakken (`["09:00-12:00", "13:00-17:00"]`) of `null` voor gesloten. |
| `pauzes` | Een lijst die voor elke dag geldt (`["12:30-13:00"]`), of per weekdag. Afspraken lopen nooit over een pauze heen. |
| `feestdagenGesloten` | Standaard `true`: dicht op Nieuwjaarsdag, Pasen, Koningsdag, Hemelvaart, Pinksteren en Kerst (automatisch berekend). |
| `uitzonderingen` | Afwijkende dagen: `{ "2026-12-24": "08:00-14:00", "2026-12-31": null }`. Gaat vóór feestdagen. |
| `planning` | `tijdslotMinuten` (om de hoeveel minuten een starttijd), `bufferMinuten` (opruimtijd na elke afspraak), `capaciteit` (aantal afspraken tegelijk, bijv. 2 stoelen), `minimaalUrenVooraf`, `maximaalDagenVooruit`, `automatischBevestigen` (zonder handmatig accepteren) en `annulerenTotUrenVooraf` (0 = klant kan niet zelf annuleren). |
| `formulier` | `telefoonVerplicht`, `extraVelden` (eigen velden zoals kenteken), `fotos` (aan/uit, maximaal aantal, uitleg) en de voorbeeldtekst van het opmerkingenveld. |
| `email` | Afzendernaam en -adres, antwoordadres, `beheerderAdres` (voor meldingen) en `smtp` (host, poort, beveiliging, gebruikersnaam), of `null` om alleen te loggen. |
| `berichten` | Welke automatische berichten aan staan en wanneer, seizoensberichten, eigen teksten en de afsluiting onder elke e-mail. Zie [Automatische berichten](#automatische-berichten). |
| `privacy` | `fotosBewarenDagen` en `gegevensBewarenMaanden` (daarna automatisch anonimiseren). |
| `ical` | `metKlantgegevens`: naam en telefoonnummer van de klant tonen in de agenda-feed. |

### Hoe beschikbaarheid werkt

Een tijd wordt alleen aangeboden als:

1. de afspraak (zonder buffer) helemaal binnen één openingsvenster valt, dus niet over een pauze of sluitingstijd heen;
2. de afspraak plus buffer nergens overlapt met een blokkade;
3. er op geen enkel moment meer dan `capaciteit` afspraken tegelijk lopen (aanvragen tellen ook mee, zodat een aangevraagd tijdstip niet twee keer wordt aangevraagd);
4. het moment binnen de boekingstermijn valt (`minimaalUrenVooraf` en `maximaalDagenVooruit`).

Starttijden liggen op een raster (`tijdslotMinuten`), plus direct aansluitend op bestaande afspraken en blokkades, zodat de agenda niet versnippert.

Een behandeling die langer duurt dan het langste openingsvenster kan nooit geboekt worden; `npm run check-config` waarschuwt daarvoor.

### Hoe dubbele boekingen worden voorkomen

De controle "is dit tijdstip nog vrij?" en het opslaan gebeuren in **één SQL-instructie** (`INSERT … SELECT … WHERE <geen conflict>`). D1 voert elke instructie atomisch en na elkaar uit. Als twee klanten tegelijk op hetzelfde tijdstip klikken, slaagt de eerste en krijgt de tweede de melding dat het tijdstip net geboekt is; zijn of haar ingevulde gegevens blijven staan en er kan direct een andere tijd gekozen worden. Accepteren, verzetten en handmatig invoeren in het beheer gebruiken dezelfde controle. Zie [`src/db/afspraken.ts`](src/db/afspraken.ts) en de tests in [`test/dubbele-boekingen.test.ts`](test/dubbele-boekingen.test.ts).

---

## Automatische berichten

| Bericht | Wanneer | Toestemming nodig? |
| --- | --- | --- |
| Aanvraag ontvangen | Direct na een aanvraag | Nee (hoort bij de afspraak) |
| Melding aan de eigenaar | Direct na een aanvraag (`meldingNieuweAanvraag`) | – |
| Bevestiging | Na accepteren (of direct bij `automatischBevestigen`) | Nee |
| Afwijzing | Na weigeren, met optionele toelichting en een knop om een ander moment te kiezen | Nee |
| Verzet / geannuleerd | Na verzetten of annuleren | Nee |
| Aanvraag verlopen | Als een aanvraag niet vóór het tijdstip is beantwoord | Nee |
| Herinnering | `urenVooraf` (standaard 24) uur voor de afspraak. Niet als de bevestiging pas kort daarvoor kwam. | **Ja** |
| Klaar | Als je in het beheer op de klaar-knop drukt (bijv. "Auto is klaar") | Nee |
| Reviewverzoek | `urenNaAfloop` uur na afloop, alleen als `googleReviewUrl` is ingesteld. Niet vaker dan eens per `nietVakerDanDagen` per klant. | **Ja** |
| Reviewherinnering | Precies één keer, `herinneringNaDagen` later, en alleen als er nog niet op de reviewlink is geklikt | **Ja** |
| Onderhoud | `onderhoudNaWeken` na een behandeling, tenzij de klant inmiddels opnieuw geboekt heeft | **Ja** |
| Seizoen | Op de ingestelde datum (bijv. `"03-15"`), aan klanten met toestemming die in de afgelopen 18 maanden kwamen | **Ja** |

Alle berichten met toestemming bevatten een afmeldlink en de `List-Unsubscribe`-kop (one-click afmelden in Gmail en Apple Mail).

**Geen review-gating.** Het reviewverzoek gaat naar iedereen die daar toestemming voor gaf, ongeacht of de klant tevreden was, en linkt direct naar het Google-reviewformulier. Selectief alleen tevreden klanten om een review vragen is in strijd met de regels van Google en de ACM. De link loopt via `/r/<token>`, zodat we weten dat er geklikt is en de herinnering dan wegblijft.

**Nooit dubbel.** Elk bericht heeft een unieke sleutel in de tabel `berichten` (bijv. `herinnering:12:2026-11-09T10:00`). Bestaat die al, dan wordt er niets verstuurd; ook niet als de cron-taak twee keer tegelijk draait. Een mislukt bericht wordt bij de volgende runs tot drie keer opnieuw geprobeerd.

### Eigen teksten

Onder `berichten.teksten` kun je per berichtsoort een eigen `onderwerp` en `tekst` opgeven. Een lege regel begint een nieuwe alinea. Beschikbare plaatshouders:

| Plaatshouder | Voorbeeld |
| --- | --- |
| `{voornaam}`, `{naam}` | Sanne, Sanne de Vries |
| `{behandeling}` / `{Behandeling}` | handwas buiten / Handwas buiten |
| `{datum}`, `{tijd}` | maandag 9 november 2026, 10:00 |
| `{bedrijf}` | Glans & Co |
| `{<id van een extra veld>}` | bijv. `{hond}` → Bobbie, `{kenteken}` → AB-123-C |

Berichtsoorten: `aanvraag_ontvangen`, `bevestiging`, `afwijzing`, `verzet`, `geannuleerd`, `verlopen`, `herinnering`, `klaar`, `review`, `review_herinnering`, `onderhoud`, `nieuwe_aanvraag`. De gegevenstabel (datum, tijd, adres) en knoppen worden altijd automatisch toegevoegd. De standaardteksten staan in [`src/berichten/sjablonen.ts`](src/berichten/sjablonen.ts).

---

## E-mail (SMTP) instellen

Cloudflare blokkeert poort 25. Gebruik **poort 465** met `beveiliging: "tls"` of **poort 587** met `beveiliging: "starttls"`. Het wachtwoord zet je als geheim (`SMTP_WACHTWOORD`), nooit in de config.

| Provider | host | poort / beveiliging | Let op |
| --- | --- | --- | --- |
| Google Workspace / Gmail | `smtp.gmail.com` | 465 / `tls` | Gebruik een [app-wachtwoord](https://support.google.com/accounts/answer/185833) (vereist 2-stapsverificatie). |
| Microsoft 365 | `smtp.office365.com` | 587 / `starttls` | SMTP AUTH moet voor de mailbox aanstaan. |
| TransIP, Strato, Hostnet, Antagonist, … | zie de hostingprovider | meestal 465 / `tls` | Gebruik het wachtwoord van de mailbox. |
| Brevo (gratis tot 300 mails/dag) | `smtp-relay.brevo.com` | 587 / `starttls` | Handig als de klant geen eigen mailhosting heeft. |

Tips:

- Laat het afzenderadres (`afzenderAdres`) horen bij het SMTP-account, anders worden mails geweigerd of als spam gezien.
- Controleer of het domein **SPF**, **DKIM** en **DMARC** heeft ingesteld (vaak al zo bij de mailprovider).
- Antwoorden van klanten gaan naar `antwoordAdres` (of `bedrijf.email`).
- Zonder SMTP (`smtp: null`) wordt alles alleen gelogd onder **Beheer → Berichten**: handig om eerst rustig te testen.

---

## Demo online zetten voor prospects

De demo is een aparte omgeving (`env.demo` in [`wrangler.jsonc`](wrangler.jsonc)) met een eigen database. Hij gebruikt de ingebouwde Glans & Co-configuratie ([`src/config/demo.config.ts`](src/config/demo.config.ts)), verstuurt nooit echte e-mails, toont een demobalk en ververst de voorbeelddata elke nacht (na 03:00) en bij de knop **Demodata opnieuw laden** in het beheer.

```bash
npx wrangler d1 create fluks-boeken-demo --jurisdiction=eu
```

Zet de `database_id` in `wrangler.jsonc` onder `env.demo.d1_databases`. Links in de voorbeeldmails gebruiken automatisch het adres waarop de demo bezocht wordt; wil je een vast adres, zet dan `"BASIS_URL"` onder `env.demo.vars`. Daarna:

```bash
npm run db:migreer:demo
```

```bash
npm run deploy:demo
```

Het beheerwachtwoord van de demo is `demo`. Je hoeft voor de demo geen geheimen in te stellen.

---

## Kosten: Cloudflare gratis plan

Fluks Boeken is gebouwd om binnen het **gratis Workers-plan** te passen. De limieten (stand: november 2026, zie [Workers-limieten](https://developers.cloudflare.com/workers/platform/limits/) en [D1-prijzen](https://developers.cloudflare.com/d1/platform/pricing/)):

| Limiet (gratis plan) | Waarde | Gebruik door Fluks Boeken |
| --- | --- | --- |
| Requests naar de Worker | 100.000 per dag | Een boeking kost ±5 paginaweergaven. Statische bestanden (CSS, JS, logo's) zijn gratis en tellen niet mee. |
| CPU-tijd per request / cron-run | 10 ms | Een boekingspagina kost ±3,5 ms CPU, de weekagenda ±1 ms. Wachten op de database telt niet mee. |
| Cron Triggers | 5 per account | 1 per installatie. |
| D1 gelezen rijen | 5 miljoen per dag | Een boekingspagina leest ±10 rijen, een boeking ±40, een cron-run ±15 (ook met jaren aan historie; dit wordt door een test bewaakt). |
| D1 geschreven rijen | 100.000 per dag | Een boeking schrijft enkele tientallen rijen (inclusief indexen en e-maillog). |
| D1 opslag | 500 MB per database, 5 GB per account, 10 databases | Foto's worden in de browser verkleind (±200–400 kB) en na 30 dagen verwijderd. |
| Uitgaande verbindingen | 6 tegelijk, 50 externe subrequests | E-mails van één run gaan over één SMTP-verbinding, maximaal 25 per run. |

Voor een typisch klein bedrijf (tientallen afspraken per dag) zit je op een paar procent van deze limieten.

**Wat kost wél geld?**

- Een domeinnaam (bij de registrar, ±€10 per jaar), als de klant die nog niet heeft.
- E-mail: meestal zit SMTP al in het mailpakket van de klant.
- Veel klanten in **één** Cloudflare-account? Dan loop je tegen 5 cron triggers en 10 databases aan. Gebruik dan per klant een eigen (gratis) account, of neem Workers Paid ($5 per maand per account) waarmee je ruim voldoende hebt voor honderden klanten.

---

## Privacy (AVG)

Wat Fluks Boeken standaard doet:

- **Dataminimalisatie**: alleen naam, e-mail, telefoon en wat de klant zelf invult.
- **Toestemming apart en standaard uit** voor herinneringen, reviewverzoeken en onderhouds-/seizoensberichten. Het tijdstip van toestemming wordt vastgelegd (bewijs).
- **Afmelden** kan via een link in elk niet-noodzakelijk bericht en via one-click `List-Unsubscribe`. Afmelden geldt voor alle afspraken met dat e-mailadres. Een afmeldlink openen meldt nog niet af (mailscanners openen links automatisch); daarvoor is een klik op de knop nodig.
- **Bewaartermijnen**: foto's worden na `fotosBewarenDagen` (standaard 30) verwijderd, klantgegevens na `gegevensBewarenMaanden` (standaard 24) automatisch geanonimiseerd. Verstuurde e-mails worden na verzending niet in hun geheel bewaard (behalve in de demo).
- **Recht op verwijdering**: in het beheer wis je met één knop alle gegevens van een klant.
- **Geen tracking**: geen analytics, geen advertentie- of trackingcookies, geen externe scripts of lettertypes. Alleen het beheer gebruikt een noodzakelijk inlogcookie.
- **Ingebouwde privacyverklaring** op `/privacy` (of verwijs met `privacyUrl` naar de eigen verklaring van de klant).
- **Data in de EU**: maak de database aan met `--jurisdiction=eu` (zie stap 3).
- **Foto's** zijn alleen voor de ingelogde beheerder zichtbaar.

Rollen en afspraken:

- De klant (het bedrijf) is **verwerkingsverantwoordelijke**. Als jij de installatie beheert, ben jij **verwerker**: sluit een verwerkersovereenkomst met de klant.
- Cloudflare en de e-mailprovider zijn (sub)verwerkers. Cloudflare biedt een standaard [verwerkersovereenkomst (DPA)](https://www.cloudflare.com/cloudflare-customer-dpa/) die onderdeel is van de voorwaarden. Een eigen Cloudflare-account op naam van de klant maakt de rollen het duidelijkst.
- De **agenda-feed** bevat (als `ical.metKlantgegevens` aan staat) namen en telefoonnummers en wordt door Google/Apple opgehaald. De link is geheim; deel hem niet en zet `metKlantgegevens` uit als de klant dat niet wil.

---

## Beveiliging

- Beheerwachtwoord en sleutels staan als versleutelde geheimen bij Cloudflare, niet in de code. Wachtwoorden worden in constante tijd vergeleken; na 10 foute pogingen in 15 minuten wordt inloggen per IP-adres tijdelijk geblokkeerd.
- Sessies zijn ondertekende cookies (`HttpOnly`, `Secure`, `SameSite=Strict`), 14 dagen geldig.
- Formulieren in het beheer zijn beschermd tegen CSRF (Origin-controle).
- Strikte Content-Security-Policy, geen inline scripts, `X-Frame-Options`, `nosniff`, `Referrer-Policy`.
- Alle uitvoer wordt ge-escaped (ook in e-mails); geüploade bestanden worden op inhoud gecontroleerd (alleen echte JPEG/PNG/WebP).
- Het boekingsformulier heeft een verborgen veld tegen spambots en een limiet van 10 aanvragen per uur per IP-adres.
- Klantlinks (afspraakpagina, afmelden, review) gebruiken een willekeurig token van 144 bits.

Extra beveiliging nodig? Zet [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/) (gratis tot 50 gebruikers) voor het pad `/beheer`.

---

## Ontwikkelen en testen

```bash
npm test
```

```bash
npm run check
```

De tests draaien in de echte Workers-runtime met een echte (lokale) D1-database en dekken onder meer:

- **beschikbaarheid**: openingstijden, pauzes, feestdagen, buffer, capaciteit, blokkades, boekingstermijn, zomertijd;
- **dubbele boekingen**: tien gelijktijdige boekingen op één slot (precies één slaagt), capaciteit, accepteren, verzetten en handmatig invoeren;
- **berichten**: sjablonen, eigen teksten, geen review-gating, nooit dubbel versturen, opnieuw proberen, herinnering 24 uur vooraf, reviewverzoek met precies één herinnering, onderhouds- en seizoensberichten alleen met toestemming, afmelden, AVG-opruiming;
- **HTTP**: de volledige boekingsflow, foto-upload, annuleren, login, rate limiting, CSRF, beheerpagina's, iCal-feed, cron-handler, demo-modus en configfouten;
- **efficiëntie**: het aantal gelezen D1-rijen blijft klein, ook met jaren historie.

Lokaal ontwikkelen met de klantconfig:

```bash
cp .dev.vars.voorbeeld .dev.vars
```

```bash
npm run dev
```

Geplande taken lokaal uitproberen kan met `npx wrangler dev --test-scheduled` en dan <http://localhost:8787/__scheduled> openen.

---

## Updates uitrollen naar klanten

In de kopie van een klant:

```bash
git remote add upstream https://github.com/nealharpal0/fluks-boeken.git
```

```bash
git pull upstream main
```

```bash
npm install
```

```bash
npm test
```

```bash
npm run db:migreer
```

```bash
npm run deploy
```

`klant.config.ts`, `wrangler.jsonc` en `public/klant/` zijn de enige bestanden die per klant verschillen; houd daar rekening mee bij een merge. Nieuwe databasewijzigingen komen als extra bestand in `migrations/` en worden met `npm run db:migreer` toegepast.
