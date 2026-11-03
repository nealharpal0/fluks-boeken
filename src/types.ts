/** Bindings en variabelen die Cloudflare aan de Worker meegeeft (zie wrangler.jsonc). */
export interface Bindings {
  DB: D1Database;
  ASSETS?: Fetcher;
  /** "productie" (standaard) of "demo". */
  MODUS?: string;
  /** Overschrijft config.basisUrl, bijv. voor de demo-omgeving. */
  BASIS_URL?: string;
  /** Geheim: wachtwoord voor het beheer. */
  BEHEER_WACHTWOORD?: string;
  /** Geheim: willekeurige lange tekst om sessies en de agenda-link te ondertekenen. */
  GEHEIME_SLEUTEL?: string;
  /** Geheim: wachtwoord van het SMTP-account. */
  SMTP_WACHTWOORD?: string;
}

declare global {
  namespace Cloudflare {
    interface Env extends Bindings {}
  }
}

/** Status van een afspraak. */
export type AfspraakStatus =
  | "aangevraagd"
  | "bevestigd"
  | "afgerond"
  | "geweigerd"
  | "geannuleerd"
  | "verlopen"
  | "niet_verschenen";

/** Statussen die een tijdslot bezet houden. */
export const BEZETTENDE_STATUSSEN: AfspraakStatus[] = ["aangevraagd", "bevestigd", "afgerond"];

export const STATUS_LABELS: Record<AfspraakStatus, string> = {
  aangevraagd: "Aanvraag",
  bevestigd: "Bevestigd",
  afgerond: "Afgerond",
  geweigerd: "Geweigerd",
  geannuleerd: "Geannuleerd",
  verlopen: "Verlopen",
  niet_verschenen: "Niet verschenen",
};

export interface Afspraak {
  id: number;
  token: string;
  behandeling_id: string;
  behandeling_naam: string;
  start: string;
  eind: string;
  bezet_tot: string;
  status: AfspraakStatus;
  naam: string;
  email: string;
  telefoon: string;
  opmerking: string;
  extra_velden: string;
  toestemming_herinnering: number;
  toestemming_review: number;
  toestemming_onderhoud: number;
  toestemming_op: string | null;
  interne_notitie: string;
  reden: string;
  bron: string;
  bevestigd_op: string | null;
  klaar_op: string | null;
  review_geklikt_op: string | null;
  geanonimiseerd: number;
  aangemaakt_op: string;
  gewijzigd_op: string;
}

export interface Blokkade {
  id: number;
  start: string;
  eind: string;
  reden: string;
}

export interface BerichtRij {
  id: number;
  sleutel: string;
  soort: string;
  afspraak_id: number | null;
  ontvanger: string;
  onderwerp: string;
  status: "bezig" | "verzonden" | "mislukt" | "gelogd";
  pogingen: number;
  fout: string;
  inhoud_html: string | null;
  inhoud_tekst: string | null;
  aangemaakt_op: string;
  verzonden_op: string | null;
}
