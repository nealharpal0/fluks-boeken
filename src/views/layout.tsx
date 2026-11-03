/** @jsxImportSource hono/jsx */
import type { Child, FC, PropsWithChildren } from "hono/jsx";
import type { KlantConfig } from "../config/schema";
import { leesbaarOpWit, tekstKleurOp, verdonker } from "../lib/kleur";

/** Versienummer voor statische bestanden, zodat browsers na een update de nieuwe CSS/JS laden. */
export const ASSET_VERSIE = "1";

export interface Melding {
  soort: "succes" | "fout" | "info";
  tekst: string;
}

function huisstijlCss(config: KlantConfig): string {
  const p = config.huisstijl.primaireKleur;
  const accent = config.huisstijl.accentKleur ?? p;
  return `:root{--primair:${p};--primair-tekst:${tekstKleurOp(p)};--primair-donker:${verdonker(p, 0.18)};--primair-zacht:${verdonker(p, -0.9)};--link:${leesbaarOpWit(p)};--accent:${accent};}`;
}

export const MeldingBalk: FC<{ melding?: Melding | null }> = ({ melding }) =>
  melding ? (
    <div class={`melding melding-${melding.soort}`} role={melding.soort === "fout" ? "alert" : "status"}>
      {melding.tekst}
    </div>
  ) : null;

export interface PaginaProps {
  titel: string;
  config: KlantConfig;
  demo: boolean;
  beschrijving?: string;
  melding?: Melding | null;
  /** Beheerpagina: andere navigatie en geen indexering. */
  beheer?: { actief: string; ingelogd: boolean };
  /** Extra inhoud in de kop, rechts. */
  kopRechts?: Child;
  smal?: boolean;
}

const BEHEER_NAV: [string, string][] = [
  ["/beheer", "Overzicht"],
  ["/beheer/agenda", "Agenda"],
  ["/beheer/nieuw", "Nieuwe afspraak"],
  ["/beheer/blokkades", "Blokkades"],
  ["/beheer/berichten", "Berichten"],
  ["/beheer/instellingen", "Instellingen"],
];

export const Pagina: FC<PropsWithChildren<PaginaProps>> = (p) => {
  const b = p.config.bedrijf;
  const volledigeTitel = p.beheer ? `${p.titel} – Beheer ${b.naam}` : p.titel === b.naam ? b.naam : `${p.titel} – ${b.naam}`;
  return (
    <html lang="nl">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{volledigeTitel}</title>
        {p.beschrijving ? <meta name="description" content={p.beschrijving} /> : null}
        {p.beheer || p.demo ? <meta name="robots" content="noindex, nofollow" /> : null}
        <meta name="theme-color" content={p.config.huisstijl.primaireKleur} />
        <link rel="icon" href={b.logo ?? "/favicon.svg"} />
        <link rel="stylesheet" href={`/stijl.css?v=${ASSET_VERSIE}`} />
        <style dangerouslySetInnerHTML={{ __html: huisstijlCss(p.config) }} />
        <script src={`/app.js?v=${ASSET_VERSIE}`} defer></script>
      </head>
      <body class={p.beheer ? "beheer" : "klant"}>
        <a class="overslaan" href="#inhoud">
          Naar de inhoud
        </a>
        {p.demo ? (
          <aside class="demo-balk" aria-label="Demo-melding">
            <strong>Demo</strong> – dit is een voorbeeldomgeving van Fluks Boeken met een fictief bedrijf. Er worden geen echte e-mails verstuurd.
            {p.beheer ? null : (
              <>
                {" "}
                <a href="/beheer">Bekijk het beheer</a> (wachtwoord: <code>demo</code>).
              </>
            )}
          </aside>
        ) : null}
        <header class="kop">
          <div class={`kop-binnen ${p.smal && !p.beheer ? "smal" : ""}`}>
            <a href={p.beheer ? "/beheer" : "/"} class="merk">
              {b.logo ? <img src={b.logo} alt="" width="40" height="40" /> : null}
              <span>
                <span class="merk-naam">{b.naam}</span>
                {p.beheer ? <span class="merk-sub">Beheer</span> : b.slogan ? <span class="merk-sub">{b.slogan}</span> : null}
              </span>
            </a>
            {p.kopRechts}
          </div>
          {p.beheer?.ingelogd ? (
            <nav class="beheer-nav" aria-label="Beheer">
              <ul>
                {BEHEER_NAV.map(([href, label]) => (
                  <li>
                    <a href={href} aria-current={p.beheer?.actief === href ? "page" : undefined}>
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
        </header>
        <main id="inhoud" class={p.smal && !p.beheer ? "inhoud smal" : "inhoud"} tabindex={-1}>
          <MeldingBalk melding={p.melding} />
          {p.children}
        </main>
        <footer class="voet">
          <div class={p.smal && !p.beheer ? "smal" : ""}>
            {p.beheer ? (
              <p>
                Fluks Boeken · <a href="/">Naar de boekingspagina</a>
              </p>
            ) : (
              <>
                <p>
                  <strong>{b.naam}</strong> · {b.adres.straat}, {b.adres.postcode} {b.adres.plaats}
                  {b.telefoon ? (
                    <>
                      {" "}
                      · <a href={`tel:${b.telefoon.replace(/[^\d+]/g, "")}`}>{b.telefoon}</a>
                    </>
                  ) : null}{" "}
                  · <a href={`mailto:${b.email}`}>{b.email}</a>
                </p>
                <p>
                  <a href={b.privacyUrl ?? "/privacy"}>Privacy</a>
                  {b.kvk ? <> · KvK {b.kvk}</> : null} · Online boeken met Fluks Boeken
                </p>
              </>
            )}
          </div>
        </footer>
      </body>
    </html>
  );
};

/** Eenvoudige foutpagina. */
export const FoutPagina: FC<{ config: KlantConfig; demo: boolean; titel: string; tekst: string; terug?: string }> = (p) => (
  <Pagina titel={p.titel} config={p.config} demo={p.demo} smal>
    <div class="kaart">
      <h1>{p.titel}</h1>
      <p>{p.tekst}</p>
      <p>
        <a class="knop" href={p.terug ?? "/"}>
          Terug naar de startpagina
        </a>
      </p>
    </div>
  </Pagina>
);
