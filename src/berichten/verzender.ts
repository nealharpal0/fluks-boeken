/**
 * Het daadwerkelijk versturen van e-mail.
 *
 * - SmtpVerzender: verstuurt via SMTP over een TCP-verbinding van Cloudflare
 *   (poort 465 of 587; poort 25 is bij Cloudflare geblokkeerd). Eén verbinding
 *   wordt hergebruikt voor meerdere berichten binnen één cron-run.
 * - LogVerzender: verstuurt niets (demo-modus of als er geen SMTP is ingesteld).
 * - GeheugenVerzender: voor tests.
 */
import { WorkerMailer } from "worker-mailer";
import type { KlantConfig } from "../config/schema";

export interface UitgaandBericht {
  aan: string;
  onderwerp: string;
  html: string;
  tekst: string;
  /** Voor List-Unsubscribe (Gmail/Apple Mail tonen dan een afmeldknop). */
  afmeldUrl?: string;
}

export interface Verzender {
  /** "smtp" verstuurt echt; "log" alleen vastleggen. */
  readonly soort: "smtp" | "log" | "test";
  verstuur(bericht: UitgaandBericht): Promise<void>;
  /** Sluit een eventuele open verbinding. */
  sluit(): Promise<void>;
}

export class LogVerzender implements Verzender {
  readonly soort = "log" as const;
  async verstuur(): Promise<void> {}
  async sluit(): Promise<void> {}
}

export class GeheugenVerzender implements Verzender {
  readonly soort = "test" as const;
  verzonden: UitgaandBericht[] = [];
  /** Zet op een foutmelding om mislukken te simuleren. */
  faalMet: string | null = null;
  async verstuur(b: UitgaandBericht): Promise<void> {
    if (this.faalMet) throw new Error(this.faalMet);
    this.verzonden.push(b);
  }
  async sluit(): Promise<void> {}
}

function kopregels(b: UitgaandBericht): Record<string, string> {
  const h: Record<string, string> = { "Auto-Submitted": "auto-generated" };
  if (b.afmeldUrl) {
    h["List-Unsubscribe"] = `<${b.afmeldUrl}>`;
    h["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  return h;
}

const VERZEND_TIJDSLIMIET_MS = 30_000;

function metTijdslimiet<T>(belofte: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const limiet = new Promise<never>((_, nee) => {
    timer = setTimeout(() => nee(new Error(`Geen antwoord van de SMTP-server binnen ${ms / 1000} seconden`)), ms);
  });
  return Promise.race([belofte, limiet]).finally(() => clearTimeout(timer));
}

export class SmtpVerzender implements Verzender {
  readonly soort = "smtp" as const;
  private verbinding: Promise<WorkerMailer> | null = null;

  constructor(
    private readonly config: KlantConfig,
    private readonly wachtwoord: string,
  ) {}

  private verbind(): Promise<WorkerMailer> {
    const smtp = this.config.email.smtp!;
    this.verbinding ??= WorkerMailer.connect({
      host: smtp.host,
      port: smtp.poort,
      secure: smtp.beveiliging === "tls",
      startTls: smtp.beveiliging === "starttls",
      credentials: smtp.gebruikersnaam ? { username: smtp.gebruikersnaam, password: this.wachtwoord } : undefined,
      authType: ["plain", "login"],
      socketTimeoutMs: 15_000,
      responseTimeoutMs: 15_000,
    });
    return this.verbinding;
  }

  async verstuur(b: UitgaandBericht): Promise<void> {
    const e = this.config.email;
    let mailer: WorkerMailer;
    try {
      mailer = await this.verbind();
    } catch (fout) {
      this.verbinding = null; // volgende poging opnieuw verbinden
      throw new Error(`Kan geen verbinding maken met ${e.smtp?.host}:${e.smtp?.poort}: ${(fout as Error).message}`);
    }
    try {
      await metTijdslimiet(
        mailer.send({
          from: { name: e.afzenderNaam, email: e.afzenderAdres },
          to: b.aan,
          reply: e.antwoordAdres ?? this.config.bedrijf.email,
          subject: b.onderwerp,
          html: b.html,
          text: b.tekst,
          headers: kopregels(b),
        }),
        VERZEND_TIJDSLIMIET_MS,
      );
    } catch (fout) {
      // Na een fout is de verbinding mogelijk onbruikbaar: sluiten en bij het volgende bericht opnieuw verbinden.
      await this.sluit();
      throw fout;
    }
  }

  async sluit(): Promise<void> {
    const v = this.verbinding;
    this.verbinding = null;
    if (v) {
      try {
        await metTijdslimiet((await v).close(), 5_000);
      } catch {
        // verbinding was al dicht
      }
    }
  }
}

export function maakVerzender(config: KlantConfig, opties: { demo: boolean; smtpWachtwoord?: string }): Verzender {
  if (opties.demo || !config.email.smtp) return new LogVerzender();
  return new SmtpVerzender(config, opties.smtpWachtwoord ?? "");
}
