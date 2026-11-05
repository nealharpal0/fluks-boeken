/**
 * Het configuratieschema van Fluks Boeken.
 *
 * Elke klantinstallatie heeft precies één configbestand (`klant.config.ts`
 * in de hoofdmap) dat aan dit type voldoet. Je editor helpt je dan met
 * aanvullen en waarschuwt bij typefouten; `npm run check-config` controleert
 * daarnaast de inhoud (tijden, kleuren, e-mailadressen, enzovoort).
 */

export const WEEKDAGEN = [
  "maandag",
  "dinsdag",
  "woensdag",
  "donderdag",
  "vrijdag",
  "zaterdag",
  "zondag",
] as const;

export type Weekdag = (typeof WEEKDAGEN)[number];

/**
 * Een of meer tijdvakken op een dag, als "HH:MM-HH:MM".
 * `null` (of een lege lijst) betekent: gesloten.
 */
export type Tijdvakken = string | string[] | null;

export interface Behandeling {
  /** Korte, unieke code voor in de URL, bijv. "handwas" (kleine letters, cijfers, streepjes). */
  id: string;
  /** Naam zoals de klant hem ziet, bijv. "Handwas buiten". */
  naam: string;
  /** Korte uitleg (één of twee zinnen). */
  omschrijving?: string;
  /** Hoe lang de behandeling duurt, in minuten. */
  duurMinuten: number;
  /** Vanaf-prijs in euro's (bijv. 35 of 49.5). Laat weg om geen prijs te tonen. */
  vanafPrijs?: number;
  /**
   * Na hoeveel weken een onderhoudsherinnering mag worden gestuurd
   * (alleen aan klanten die daar toestemming voor gaven). Laat weg voor geen herinnering.
   */
  onderhoudNaWeken?: number;
  /** Eigen tekst voor de onderhoudsherinnering van deze behandeling. */
  onderhoudTekst?: string;
  /** Zet op `false` om de behandeling tijdelijk niet online boekbaar te maken. */
  actief?: boolean;
}

export interface ExtraVeld {
  /** Code van het veld, bijv. "kenteken" of "naam_hond". */
  id: string;
  /** Label boven het invoerveld. */
  label: string;
  verplicht?: boolean;
  /** Voorbeeldtekst in het lege veld. */
  placeholder?: string;
  /** Korte uitleg onder het veld. */
  hulptekst?: string;
  /** Maximaal aantal tekens (standaard 100). */
  maxLengte?: number;
}

export interface Seizoensherinnering {
  /** Unieke code, bijv. "voorjaar". */
  id: string;
  /** Datum waarop de herinnering verstuurd wordt, als "MM-DD" (bijv. "03-15"). */
  datum: string;
  onderwerp: string;
  /** Tekst van de e-mail. Lege regel = nieuwe alinea. Je kunt {voornaam} en {bedrijf} gebruiken. */
  tekst: string;
}

export type BerichtSoort =
  | "aanvraag_ontvangen"
  | "bevestiging"
  | "afwijzing"
  | "verzet"
  | "geannuleerd"
  | "verlopen"
  | "herinnering"
  | "klaar"
  | "review"
  | "review_herinnering"
  | "onderhoud"
  | "seizoen"
  | "nieuwe_aanvraag"
  | "klant_annulering"
  | "test";

export interface TekstAanpassing {
  /** Eigen onderwerpregel. Je kunt plaatshouders gebruiken, zie README. */
  onderwerp?: string;
  /** Eigen hoofdtekst. Lege regel = nieuwe alinea. */
  tekst?: string;
}

export interface SmtpInstellingen {
  host: string;
  /** Meestal 465 (beveiliging "tls") of 587 (beveiliging "starttls"). Poort 25 is geblokkeerd bij Cloudflare. */
  poort: number;
  beveiliging: "tls" | "starttls" | "geen";
  gebruikersnaam: string;
  /** Het wachtwoord staat NIET hier, maar in het geheim SMTP_WACHTWOORD. */
}

export interface KlantConfig {
  bedrijf: {
    naam: string;
    /** Korte slogan onder de naam. */
    slogan?: string;
    /** Pad naar het logo in de map public/ (bijv. "/klant/logo.svg") of een volledige URL. */
    logo?: string;
    /** Logo voor e-mails: gebruik PNG of JPG, want SVG werkt niet in alle mailprogramma's. */
    logoEmail?: string;
    adres: { straat: string; postcode: string; plaats: string };
    telefoon?: string;
    /** Openbaar contactadres. */
    email: string;
    website?: string;
    kvk?: string;
    /** Link waar klanten een Google-review kunnen schrijven (bijv. https://g.page/r/.../review). */
    googleReviewUrl?: string;
    /** Link naar je eigen privacyverklaring. Laat weg om de ingebouwde pagina te gebruiken. */
    privacyUrl?: string;
  };

  huisstijl: {
    /** Hoofdkleur als hexcode, bijv. "#0f766e". De tekstkleur op knoppen wordt automatisch gekozen. */
    primaireKleur: string;
    /** Optionele tweede kleur voor accenten. */
    accentKleur?: string;
  };

  /** Het openbare adres van deze installatie, zonder / aan het eind. Wordt gebruikt voor links in e-mails. */
  basisUrl: string;

  /** Tijdzone van het bedrijf (standaard "Europe/Amsterdam"). */
  tijdzone?: string;

  behandelingen: Behandeling[];

  /** Openingstijden per weekdag, bijv. maandag: "08:00-18:00" of ["08:00-12:00", "13:00-17:00"]. */
  openingstijden: Record<Weekdag, Tijdvakken>;

  /** Vaste pauzes. Een lijst geldt voor elke dag; per weekdag kan ook. */
  pauzes?: string[] | Partial<Record<Weekdag, string[]>>;

  /** Gesloten op de officiële Nederlandse feestdagen (standaard: ja). */
  feestdagenGesloten?: boolean;

  /**
   * Afwijkende dagen: "JJJJ-MM-DD": null (gesloten) of andere tijden.
   * Bijv. { "2026-12-24": "08:00-14:00", "2026-12-31": null }
   */
  uitzonderingen?: Record<string, Tijdvakken>;

  planning: {
    /** Om de hoeveel minuten een starttijd wordt aangeboden (bijv. 15 of 30). */
    tijdslotMinuten: number;
    /** Opruim-/voorbereidingstijd na elke afspraak, in minuten. */
    bufferMinuten: number;
    /** Hoeveel afspraken er tegelijk kunnen plaatsvinden (aantal plekken/stoelen/bruggen). */
    capaciteit: number;
    /** Hoeveel uur van tevoren een klant minimaal moet boeken. */
    minimaalUrenVooraf: number;
    /** Hoeveel dagen vooruit klanten kunnen boeken. */
    maximaalDagenVooruit: number;
    /** Aanvragen direct bevestigen in plaats van eerst handmatig accepteren. */
    automatischBevestigen: boolean;
    /** Tot hoeveel uur vooraf een klant zelf online mag annuleren (0 = niet online annuleren). */
    annulerenTotUrenVooraf: number;
  };

  formulier: {
    telefoonVerplicht: boolean;
    extraVelden?: ExtraVeld[];
    fotos: {
      aan: boolean;
      /** Maximaal aantal foto's per aanvraag (1–5). */
      maxAantal: number;
      /** Uitleg boven de uploadknop, bijv. "Een foto van de lak helpt ons de prijs in te schatten." */
      uitleg?: string;
    };
    /** Voorbeeldtekst in het opmerkingenveld. */
    opmerkingPlaceholder?: string;
  };

  email: {
    afzenderNaam: string;
    /** Afzenderadres; moet passen bij je SMTP-account. */
    afzenderAdres: string;
    /** Adres waar antwoorden van klanten heen gaan (standaard bedrijf.email). */
    antwoordAdres?: string;
    /** Hier komen meldingen van nieuwe aanvragen binnen. */
    beheerderAdres: string;
    /** SMTP-server. `null` = niet versturen, alleen loggen (handig om te testen). */
    smtp: SmtpInstellingen | null;
  };

  berichten: {
    /** Stuur de beheerder een e-mail bij elke nieuwe aanvraag. */
    meldingNieuweAanvraag: boolean;
    herinnering: { aan: boolean; urenVooraf: number };
    klaar: {
      aan: boolean;
      /** Tekst op de knop in het beheer, bijv. "Auto is klaar". */
      knopTekst: string;
    };
    review: {
      aan: boolean;
      /** Hoeveel uur na afloop het reviewverzoek verstuurd wordt. */
      urenNaAfloop: number;
      /** Na hoeveel dagen één herinnering volgt (als er nog niet op de link is geklikt). */
      herinneringNaDagen: number;
      /** Dezelfde klant krijgt niet vaker dan eens per zoveel dagen een reviewverzoek. */
      nietVakerDanDagen: number;
    };
    onderhoud: { aan: boolean };
    seizoen: Seizoensherinnering[];
    /** Eigen onderwerpen/teksten per berichtsoort. */
    teksten?: Partial<Record<BerichtSoort, TekstAanpassing>>;
    /** Afsluiting onder elke e-mail, bijv. "Tot snel!\nTeam Glans & Co". */
    afsluiting?: string;
  };

  privacy: {
    /** Foto's worden zoveel dagen na de afspraak automatisch verwijderd. */
    fotosBewarenDagen: number;
    /** Klantgegevens worden zoveel maanden na de afspraak automatisch geanonimiseerd. */
    gegevensBewarenMaanden: number;
  };

  ical: {
    /** Toon naam en telefoonnummer van de klant in de agenda-feed. */
    metKlantgegevens: boolean;
  };
}

/** Hulpfunctie zodat je editor het configbestand kan controleren en aanvullen. */
export function defineConfig(config: KlantConfig): KlantConfig {
  return config;
}
