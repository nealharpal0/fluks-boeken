/**
 * Demo-configuratie: het fictieve autodetailbedrijf "Glans & Co".
 * Wordt gebruikt als de omgevingsvariabele MODUS op "demo" staat
 * (npm run demo / npm run deploy:demo). Alle gegevens zijn verzonnen.
 */
import { defineConfig } from "./schema";

export default defineConfig({
  bedrijf: {
    naam: "Glans & Co",
    slogan: "Autodetailing met oog voor elk detail",
    logo: "/demo/logo.svg",
    logoEmail: "/demo/logo.png",
    adres: { straat: "Poetsstraat 7", postcode: "1234 AB", plaats: "Voorbeeldstad" },
    telefoon: "06 12 34 56 78",
    email: "info@glansenco.example",
    website: "https://glansenco.example",
    kvk: "00000000",
    googleReviewUrl: "https://www.google.com/maps/search/?api=1&query=Glans+%26+Co",
  },

  huisstijl: {
    primaireKleur: "#0f5e7a",
    accentKleur: "#e8a33d",
  },

  basisUrl: "http://localhost:8787",
  tijdzone: "Europe/Amsterdam",

  behandelingen: [
    {
      id: "handwas",
      naam: "Handwas buiten",
      omschrijving: "Voorwas, contactloze foam, handwas met de two-bucket-methode en droogdoeken. Inclusief velgen.",
      duurMinuten: 60,
      vanafPrijs: 35,
      onderhoudNaWeken: 6,
      onderhoudTekst: "Het is alweer zes weken geleden dat je auto bij ons een handwas kreeg. Met regelmatig wassen blijft de lak langer mooi en beschermd.",
    },
    {
      id: "interieur",
      naam: "Interieur dieptereiniging",
      omschrijving: "Stofzuigen, bekleding en matten shampooën, kunststof reinigen en voeden, ruiten binnen.",
      duurMinuten: 120,
      vanafPrijs: 119,
      onderhoudNaWeken: 26,
    },
    {
      id: "complete-detailing",
      naam: "Complete detailing",
      omschrijving: "In- en exterieur van top tot teen: handwas, kleibehandeling, wax en interieur dieptereiniging.",
      duurMinuten: 240,
      vanafPrijs: 249,
      onderhoudNaWeken: 26,
    },
    {
      id: "polijsten",
      naam: "Lak polijsten (1 stap)",
      omschrijving: "Verwijdert lichte krassen en waas, voor een diepe glans. Inclusief handwas en kleibehandeling.",
      duurMinuten: 240,
      vanafPrijs: 299,
    },
    {
      id: "coating",
      naam: "Keramische coating",
      omschrijving: "Langdurige bescherming (tot 2 jaar) tegen vuil, strooizout en uv. Inclusief voorbereiding.",
      duurMinuten: 300,
      vanafPrijs: 649,
      onderhoudNaWeken: 26,
      onderhoudTekst: "Je keramische coating is nu een half jaar oud. Een onderhoudsbeurt houdt het waterafstotende effect op peil en verlengt de levensduur.",
    },
    {
      id: "velgen",
      naam: "Velgen & banden",
      omschrijving: "Velgen grondig reinigen (ook de binnenkant), vliegroest verwijderen en banden zwarten.",
      duurMinuten: 30,
      vanafPrijs: 25,
    },
  ],

  openingstijden: {
    maandag: "08:00-18:00",
    dinsdag: "08:00-18:00",
    woensdag: "08:00-18:00",
    donderdag: "08:00-18:00",
    vrijdag: "08:00-18:00",
    zaterdag: "09:00-16:00",
    zondag: null,
  },
  pauzes: ["12:30-13:00"],
  feestdagenGesloten: true,
  uitzonderingen: {
    "2026-12-24": "08:00-14:00",
    "2026-12-31": "08:00-14:00",
  },

  planning: {
    tijdslotMinuten: 30,
    bufferMinuten: 15,
    capaciteit: 1,
    minimaalUrenVooraf: 12,
    maximaalDagenVooruit: 60,
    automatischBevestigen: false,
    annulerenTotUrenVooraf: 24,
  },

  formulier: {
    telefoonVerplicht: true,
    extraVelden: [
      { id: "kenteken", label: "Kenteken", placeholder: "AB-123-C", hulptekst: "Handig, maar niet verplicht.", maxLengte: 12 },
      { id: "auto", label: "Merk en model", placeholder: "Bijv. Volkswagen Golf", maxLengte: 60 },
    ],
    fotos: {
      aan: true,
      maxAantal: 3,
      uitleg: "Een paar foto's van de lak of het interieur helpen ons om de prijs goed in te schatten. Niet verplicht.",
    },
    opmerkingPlaceholder: "Bijv. veel hondenharen in de kofferbak, of krassen op de motorkap",
  },

  email: {
    afzenderNaam: "Glans & Co",
    afzenderAdres: "afspraken@glansenco.example",
    antwoordAdres: "info@glansenco.example",
    beheerderAdres: "eigenaar@glansenco.example",
    smtp: null, // demo: niets versturen, alles is zichtbaar onder Beheer → Berichten
  },

  berichten: {
    meldingNieuweAanvraag: true,
    herinnering: { aan: true, urenVooraf: 24 },
    klaar: { aan: true, knopTekst: "Auto is klaar" },
    review: { aan: true, urenNaAfloop: 3, herinneringNaDagen: 4, nietVakerDanDagen: 180 },
    onderhoud: { aan: true },
    seizoen: [
      {
        id: "voorjaar",
        datum: "03-15",
        onderwerp: "Tijd om het wintervuil eraf te halen",
        tekst: "Hoi {voornaam},\n\nStrooizout en wintervuil zijn slecht voor je lak. Dit is hét moment voor een grondige voorjaarsbeurt, zodat je auto weer straalt.",
      },
      {
        id: "najaar",
        datum: "10-15",
        onderwerp: "Maak je auto winterklaar",
        tekst: "Hoi {voornaam},\n\nDe winter komt eraan. Een laag wax of coating beschermt je lak tegen strooizout en vuil. Plan nu je afspraak, dan ben je op tijd klaar.",
      },
    ],
    teksten: {
      klaar: {
        onderwerp: "Je auto staat glanzend voor je klaar",
        tekst: "Hoi {voornaam},\n\nGoed nieuws: we zijn klaar met de {behandeling}. Je auto staat voor je klaar en je kunt hem ophalen tijdens onze openingstijden.\n\nVergeet de sleutel niet ;-)",
      },
    },
    afsluiting: "Tot snel!\nTeam Glans & Co",
  },

  privacy: {
    fotosBewarenDagen: 30,
    gegevensBewarenMaanden: 24,
  },

  ical: { metKlantgegevens: true },
});
