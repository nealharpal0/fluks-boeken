import { env } from "cloudflare:test";
import { type App, maakApp } from "../src/app";
import { GeheugenVerzender } from "../src/berichten/verzender";
import demoConfig from "../src/config/demo.config";
import type { KlantConfig } from "../src/config/schema";
import { type NieuweAfspraak, maakAfspraak } from "../src/db/afspraken";
import { bezetTotVan, eindVan } from "../src/lib/beschikbaarheid";
import type { Moment } from "../src/lib/tijd";
import type { Afspraak } from "../src/types";

/** Een voorspelbare testconfiguratie (gebaseerd op de demo). */
export function testConfig(aanpassen: (c: KlantConfig) => void = () => {}): KlantConfig {
  const c = structuredClone(demoConfig) as KlantConfig;
  c.basisUrl = "https://boeken.test";
  c.tijdzone = "Europe/Amsterdam";
  c.uitzonderingen = {};
  c.email.smtp = { host: "smtp.test", poort: 465, beveiliging: "tls", gebruikersnaam: "test" };
  aanpassen(c);
  return c;
}

export interface TestApp {
  app: App;
  verzender: GeheugenVerzender;
  /** Zet de klok. */
  zetNu: (m: Moment) => void;
  /** Wacht tot alle e-mails op de achtergrond verwerkt zijn. */
  wacht: () => Promise<void>;
}

export function testApp(nu: Moment, config: KlantConfig = testConfig()): TestApp {
  let klok = nu;
  const verzender = new GeheugenVerzender();
  const app = maakApp(env, { config, verzender, nu: () => klok });
  return {
    app,
    verzender,
    zetNu: (m) => {
      klok = m;
    },
    wacht: async () => {
      while (app.achtergrond.length) {
        const lijst = app.achtergrond.splice(0);
        await Promise.all(lijst);
      }
    },
  };
}

export async function leegDatabase(): Promise<void> {
  await env.DB.batch(
    ["fotos", "berichten", "afspraken", "blokkades", "afmeldingen", "limieten", "instellingen"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  );
}

/** Zet direct een afspraak in de database (voor het opbouwen van testsituaties). */
export async function zetAfspraak(
  app: App,
  start: Moment,
  over: Partial<NieuweAfspraak> & { duur?: number } = {},
): Promise<Afspraak> {
  const duur = over.duur ?? 60;
  const a = await maakAfspraak(
    app.db,
    {
      behandelingId: "handwas",
      behandelingNaam: "Handwas buiten",
      start,
      eind: eindVan(start, duur),
      bezetTot: bezetTotVan(start, duur, app.config.planning.bufferMinuten),
      status: "bevestigd",
      bevestigdOp: null,
      naam: "Test Klant",
      email: "klant@voorbeeld.nl",
      telefoon: "0612345678",
      opmerking: "",
      extraVelden: {},
      toestemmingHerinnering: true,
      toestemmingReview: true,
      toestemmingOnderhoud: true,
      bron: "online",
      ...over,
    },
    app.config.planning.capaciteit,
  );
  if (!a) throw new Error(`Testafspraak op ${start} kon niet worden geplaatst (bezet)`);
  return a;
}
