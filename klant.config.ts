/**
 * ============================================================
 *  FLUKS BOEKEN – CONFIGURATIE VAN DEZE KLANT
 * ============================================================
 *
 * Dit is het enige bestand dat je per klant aanpast. Het staat nu ingevuld
 * met een fictieve trimsalon als voorbeeld; vervang alles door de gegevens
 * van je klant. Controleer daarna met:   npm run check-config
 *
 * Wachtwoorden en andere geheimen horen hier NIET in. Die zet je met
 * `npx wrangler secret put ...` (zie README, stap 5).
 *
 * Tijden schrijf je als "UU:MM" (24-uurs), tijdvakken als "09:00-17:30".
 */
import { defineConfig } from "./src/config/schema";

export default defineConfig({
  // ---------------------------------------------------------------
  // Bedrijfsgegevens (zichtbaar voor klanten en in e-mails)
  // ---------------------------------------------------------------
  bedrijf: {
    naam: "Trimsalon De Vrolijke Vacht",
    slogan: "Met liefde getrimd, in je eigen buurt",
    // Zet het logo in de map public/klant/ en verwijs ernaar vanaf de "/".
    logo: "/klant/logo.svg",
    // Voor e-mails: PNG of JPG (SVG wordt in Gmail/Outlook niet getoond).
    logoEmail: "/klant/logo.png",
    adres: { straat: "Kerkstraat 1", postcode: "1234 AB", plaats: "Voorbeeldstad" },
    telefoon: "06 12 34 56 78",
    email: "info@vrolijkevacht.example",
    website: "https://vrolijkevacht.example",
    kvk: "00000000",
    // Zoek je bedrijf op Google Maps → "Reviews" → "Review schrijven" → kopieer de link.
    googleReviewUrl: "https://g.page/r/VOORBEELD/review",
    // privacyUrl: "https://vrolijkevacht.example/privacy", // weglaten = ingebouwde privacypagina
  },

  // ---------------------------------------------------------------
  // Huisstijl
  // ---------------------------------------------------------------
  huisstijl: {
    primaireKleur: "#7c3aed", // knoppen, koppen, accenten
    accentKleur: "#f59e0b",
  },

  // Het adres waarop deze installatie straks bereikbaar is (zonder / aan het eind).
  // Kan ook via de variabele BASIS_URL in wrangler.jsonc worden overschreven.
  basisUrl: "https://boeken.vrolijkevacht.example",
  tijdzone: "Europe/Amsterdam",

  // ---------------------------------------------------------------
  // Behandelingen: duur in minuten, prijs in euro's ("vanaf")
  // ---------------------------------------------------------------
  behandelingen: [
    {
      id: "wassen-fohnen",
      naam: "Wassen & föhnen",
      omschrijving: "Wassen met een shampoo die past bij de vacht, föhnen en doorborstelen.",
      duurMinuten: 60,
      vanafPrijs: 35,
      onderhoudNaWeken: 8,
    },
    {
      id: "volledige-trimbeurt",
      naam: "Volledige trimbeurt",
      omschrijving: "Wassen, föhnen, knippen of trimmen in model, nagels knippen en oren reinigen.",
      duurMinuten: 120,
      vanafPrijs: 59,
      onderhoudNaWeken: 8,
      onderhoudTekst: "Het is alweer acht weken geleden dat {hond} bij ons was. Tijd voor een nieuwe trimbeurt?",
    },
    {
      id: "puppy-kennismaking",
      naam: "Puppy-kennismaking",
      omschrijving: "Rustig wennen aan de salon, een korte wasbeurt en veel aandacht. Voor pups tot 6 maanden.",
      duurMinuten: 45,
      vanafPrijs: 25,
    },
    {
      id: "nagels",
      naam: "Nagels knippen",
      duurMinuten: 15,
      vanafPrijs: 10,
    },
  ],

  // ---------------------------------------------------------------
  // Openingstijden (null = gesloten). Meerdere blokken mag ook:
  //   dinsdag: ["09:00-12:00", "13:00-17:00"]
  // ---------------------------------------------------------------
  openingstijden: {
    maandag: null,
    dinsdag: "09:00-17:00",
    woensdag: "09:00-17:00",
    donderdag: "09:00-20:00",
    vrijdag: "09:00-17:00",
    zaterdag: "09:00-14:00",
    zondag: null,
  },
  // Vaste pauze op elke dag. Per dag kan ook: { donderdag: ["12:30-13:00", "17:00-17:30"] }
  pauzes: ["12:30-13:00"],
  // Dicht op Nieuwjaarsdag, Pasen, Koningsdag, Hemelvaart, Pinksteren en Kerst.
  feestdagenGesloten: true,
  // Afwijkende dagen (vakantie kun je ook in het beheer blokkeren).
  uitzonderingen: {
    "2026-12-24": "09:00-13:00",
    "2026-12-31": null,
  },

  // ---------------------------------------------------------------
  // Planning
  // ---------------------------------------------------------------
  planning: {
    tijdslotMinuten: 15, // om de hoeveel minuten een starttijd wordt aangeboden
    bufferMinuten: 15, // schoonmaak-/voorbereidingstijd na elke afspraak
    capaciteit: 1, // aantal afspraken tegelijk (bijv. 2 trimtafels = 2)
    minimaalUrenVooraf: 12, // niet later boeken dan 12 uur van tevoren
    maximaalDagenVooruit: 60, // tot 60 dagen vooruit boeken
    automatischBevestigen: false, // false = jij accepteert elke aanvraag met één klik
    annulerenTotUrenVooraf: 24, // klant mag tot 24 uur vooraf zelf annuleren (0 = uit)
  },

  // ---------------------------------------------------------------
  // Boekingsformulier
  // ---------------------------------------------------------------
  formulier: {
    telefoonVerplicht: true,
    extraVelden: [
      { id: "hond", label: "Naam van je hond", verplicht: true, maxLengte: 40 },
      { id: "ras", label: "Ras", placeholder: "Bijv. labradoodle", maxLengte: 60 },
    ],
    fotos: {
      aan: true,
      maxAantal: 3,
      uitleg: "Een foto van de vacht helpt ons de juiste tijd en prijs in te schatten. Niet verplicht.",
    },
    opmerkingPlaceholder: "Bijv. gevoelig bij de oren, of liever niet te kort",
  },

  // ---------------------------------------------------------------
  // E-mail (SMTP). Het SMTP-wachtwoord zet je als geheim:
  //   npx wrangler secret put SMTP_WACHTWOORD
  // ---------------------------------------------------------------
  email: {
    afzenderNaam: "Trimsalon De Vrolijke Vacht",
    afzenderAdres: "afspraken@vrolijkevacht.example",
    antwoordAdres: "info@vrolijkevacht.example",
    beheerderAdres: "eigenaar@vrolijkevacht.example",
    smtp: {
      host: "smtp.voorbeeldprovider.example",
      poort: 465, // 465 = "tls", 587 = "starttls"
      beveiliging: "tls",
      gebruikersnaam: "afspraken@vrolijkevacht.example",
    },
  },

  // ---------------------------------------------------------------
  // Automatische berichten
  // ---------------------------------------------------------------
  berichten: {
    meldingNieuweAanvraag: true,
    herinnering: { aan: true, urenVooraf: 24 }, // alleen bij toestemming van de klant
    klaar: { aan: true, knopTekst: "Hond is klaar" },
    review: {
      aan: true, // alleen bij toestemming; iedereen krijgt dezelfde link (geen review-gating)
      urenNaAfloop: 3,
      herinneringNaDagen: 4, // precies één herinnering als er nog niet geklikt is
      nietVakerDanDagen: 180,
    },
    onderhoud: { aan: true }, // per behandeling: onderhoudNaWeken
    seizoen: [
      {
        id: "zomer",
        datum: "05-15",
        onderwerp: "Klaar voor de zomer?",
        tekst: "Hoi {voornaam},\n\nMet warm weer is een luchtige vacht extra fijn voor je hond. Plan op tijd een trimbeurt, want de zomer is druk!",
      },
    ],
    // Eigen teksten per bericht (optioneel). Plaatshouders: {voornaam}, {naam}, {behandeling},
    // {datum}, {tijd}, {bedrijf} en de id's van extra velden, zoals {hond}.
    teksten: {
      klaar: {
        onderwerp: "{hond} is klaar om opgehaald te worden",
        tekst: "Hoi {voornaam},\n\n{hond} is helemaal klaar en zit fris en vrolijk op je te wachten. Je bent welkom om op te halen!",
      },
    },
    afsluiting: "Groetjes,\nTrimsalon De Vrolijke Vacht",
  },

  // ---------------------------------------------------------------
  // Privacy (AVG)
  // ---------------------------------------------------------------
  privacy: {
    fotosBewarenDagen: 30, // foto's automatisch verwijderen na de afspraak
    gegevensBewarenMaanden: 24, // klantgegevens daarna automatisch anonimiseren
  },

  // Agenda-feed (Google/Apple): toon naam en telefoonnummer van de klant in het agenda-item.
  ical: { metKlantgegevens: true },
});
