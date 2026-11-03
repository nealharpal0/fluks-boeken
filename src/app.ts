/** De "app-context": alles wat route-handlers en geplande taken nodig hebben. */
import { maakVerzender, type Verzender } from "./berichten/verzender";
import { isDemo, laadConfig } from "./config/laden";
import type { KlantConfig } from "./config/schema";
import { type Moment, nuLokaal } from "./lib/tijd";
import type { Bindings } from "./types";

export interface App {
  env: Bindings;
  db: D1Database;
  config: KlantConfig;
  demo: boolean;
  tijdzone: string;
  verzender: Verzender;
  /** Huidige lokale tijd van het bedrijf ("JJJJ-MM-DDTUU:MM"). */
  nu: () => Moment;
  /**
   * Werk dat na het antwoord mag doorlopen (zoals e-mails versturen). De
   * HTTP-laag geeft dit door aan `waitUntil`; tests wachten er zelf op.
   */
  achtergrond: Promise<unknown>[];
}

export interface AppOpties {
  verzender?: Verzender;
  nu?: () => Moment;
  /** Alleen voor tests: een andere configuratie gebruiken. */
  config?: KlantConfig;
}

const configCache = new Map<string, KlantConfig>();

export function maakApp(env: Bindings, opties: AppOpties = {}): App {
  const sleutel = `${env.MODUS ?? ""}|${env.BASIS_URL ?? ""}`;
  let config = opties.config ?? configCache.get(sleutel);
  if (!config) {
    config = laadConfig(env);
    configCache.set(sleutel, config);
  }
  const demo = isDemo(env);
  const tijdzone = config.tijdzone ?? "Europe/Amsterdam";
  return {
    env,
    db: env.DB,
    config,
    demo,
    tijdzone,
    verzender: opties.verzender ?? maakVerzender(config, { demo, smtpWachtwoord: env.SMTP_WACHTWOORD }),
    nu: opties.nu ?? (() => nuLokaal(tijdzone)),
    achtergrond: [],
  };
}
