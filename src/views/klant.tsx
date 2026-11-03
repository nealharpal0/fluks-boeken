/** @jsxImportSource hono/jsx */
import type { Child, FC } from "hono/jsx";
import { prijsTekst } from "../berichten/sjablonen";
import type { Behandeling, KlantConfig } from "../config/schema";
import type { DagOverzicht } from "../lib/beschikbaarheid";
import {
  DAGNAMEN_KORT,
  datumVan,
  formatDatumLang,
  formatDuur,
  MAANDNAMEN_KORT,
  minutenTussen,
  tijdVan,
  weekdagIndex,
} from "../lib/tijd";
import { type Afspraak, STATUS_LABELS } from "../types";
import { type Melding, Pagina } from "./layout";

interface Basis {
  config: KlantConfig;
  demo: boolean;
  melding?: Melding | null;
}

function behandelingMeta(b: Behandeling): string {
  return [formatDuur(b.duurMinuten), b.vanafPrijs !== undefined ? `vanaf ${prijsTekst(b.vanafPrijs)}` : null].filter(Boolean).join(" · ");
}

// ---------------------------------------------------------------------------
// Startpagina
// ---------------------------------------------------------------------------

export const StartPagina: FC<Basis> = ({ config, demo, melding }) => {
  const actief = config.behandelingen.filter((b) => b.actief !== false);
  return (
    <Pagina titel={config.bedrijf.naam} config={config} demo={demo} melding={melding} smal beschrijving={`Maak online een afspraak bij ${config.bedrijf.naam}.`}>
      <section class="intro">
        <h1>Maak een afspraak</h1>
        <p>Kies een behandeling, zoek een moment dat je uitkomt en vraag je afspraak direct online aan.</p>
      </section>
      <h2 class="kop-sectie">Waarmee kunnen we je helpen?</h2>
      <ul class="behandelingen" role="list">
        {actief.map((b) => (
          <li>
            <a class="behandeling" href={`/boeken/${b.id}`}>
              <span class="behandeling-tekst">
                <span class="behandeling-naam">{b.naam}</span>
                {b.omschrijving ? <span class="behandeling-omschrijving">{b.omschrijving}</span> : null}
                <span class="behandeling-meta">{behandelingMeta(b)}</span>
              </span>
              <span class="pijl" aria-hidden="true">
                ›
              </span>
            </a>
          </li>
        ))}
      </ul>
      <OpeningstijdenBlok config={config} />
    </Pagina>
  );
};

const OpeningstijdenBlok: FC<{ config: KlantConfig }> = ({ config }) => {
  const dagen = Object.entries(config.openingstijden) as [string, string | string[] | null][];
  return (
    <section class="kaart openingstijden" aria-labelledby="openingstijden-kop">
      <h2 id="openingstijden-kop">Openingstijden</h2>
      <dl>
        {dagen.map(([dag, t]) => (
          <div>
            <dt>{dag[0]!.toUpperCase() + dag.slice(1)}</dt>
            <dd>{t === null || (Array.isArray(t) && !t.length) ? "Gesloten" : (Array.isArray(t) ? t : [t]).map((v) => v.replace("-", " – ")).join(", ")}</dd>
          </div>
        ))}
      </dl>
      <p class="klein">
        {config.bedrijf.adres.straat}, {config.bedrijf.adres.postcode} {config.bedrijf.adres.plaats}
      </p>
    </section>
  );
};

// ---------------------------------------------------------------------------
// Boekingspagina
// ---------------------------------------------------------------------------

export interface FormWaarden {
  naam: string;
  email: string;
  telefoon: string;
  opmerking: string;
  extra: Record<string, string>;
  toestemmingHerinnering: boolean;
  toestemmingReview: boolean;
  toestemmingOnderhoud: boolean;
}

export const LEGE_WAARDEN: FormWaarden = {
  naam: "",
  email: "",
  telefoon: "",
  opmerking: "",
  extra: {},
  toestemmingHerinnering: false,
  toestemmingReview: false,
  toestemmingOnderhoud: false,
};

export interface BoekPaginaProps extends Basis {
  behandeling: Behandeling;
  dagen: DagOverzicht[];
  datum: string | null;
  tijden: string[];
  tijd: string | null;
  vorigeVanaf: string | null;
  volgendeVanaf: string | null;
  vanaf: string;
  eersteVrijeDag: string | null;
  waarden: FormWaarden;
  fouten: Record<string, string>;
  /** Het gekozen tijdstip was net bezet: laat de klant in het formulier zelf een nieuwe tijd kiezen. */
  herkies?: boolean;
}

function dagdeel(tijd: string): "Ochtend" | "Middag" | "Avond" {
  if (tijd < "12:00") return "Ochtend";
  if (tijd < "17:00") return "Middag";
  return "Avond";
}

function boekLink(b: Behandeling, params: Record<string, string | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return `/boeken/${b.id}${s ? `?${s}` : ""}`;
}

const Stap: FC<{ nummer: number; titel: string; id?: string; children?: Child }> = (p) => (
  <section class="stap" id={p.id} aria-labelledby={`${p.id}-kop`}>
    <h2 id={`${p.id}-kop`}>
      <span class="stap-nummer" aria-hidden="true">
        {p.nummer}
      </span>
      <span class="sr-only">Stap {p.nummer}: </span>
      {p.titel}
    </h2>
    {p.children}
  </section>
);

export const BoekPagina: FC<BoekPaginaProps> = (p) => {
  const b = p.behandeling;
  const tijdenPerDeel = new Map<string, string[]>();
  for (const t of p.tijden) {
    const deel = dagdeel(t);
    tijdenPerDeel.set(deel, [...(tijdenPerDeel.get(deel) ?? []), t]);
  }
  const foutLijst = Object.entries(p.fouten);
  return (
    <Pagina titel={`${b.naam} boeken`} config={p.config} demo={p.demo} melding={p.melding} smal>
      <p class="kruimel">
        <a href="/">‹ Alle behandelingen</a>
      </p>
      <div class="kaart gekozen-behandeling">
        <h1>{b.naam}</h1>
        {b.omschrijving ? <p>{b.omschrijving}</p> : null}
        <p class="behandeling-meta">{behandelingMeta(b)}</p>
      </div>

      <Stap nummer={1} titel="Kies een dag" id="dag">
        <nav class="dagen-nav" aria-label="Andere weken">
          {p.vorigeVanaf ? (
            <a class="knop-licht klein-knop" href={boekLink(b, { vanaf: p.vorigeVanaf })}>
              ‹ Eerder
            </a>
          ) : (
            <span />
          )}
          {p.volgendeVanaf ? (
            <a class="knop-licht klein-knop" href={boekLink(b, { vanaf: p.volgendeVanaf })}>
              Later ›
            </a>
          ) : null}
        </nav>
        <ul class="dagen" role="list">
          {p.dagen.map((d) => {
            const wd = weekdagIndex(d.datum);
            const gekozen = d.datum === p.datum;
            const label = `${formatDatumLang(d.datum, false)}: ${d.aantalVrij ? `${d.aantalVrij} tijden vrij` : d.geslotenReden ?? "vol"}`;
            const inhoud = (
              <>
                <span class="dag-naam">{DAGNAMEN_KORT[wd]}</span>
                <span class="dag-nummer">{Number(d.datum.slice(8, 10))}</span>
                <span class="dag-maand">{MAANDNAMEN_KORT[Number(d.datum.slice(5, 7)) - 1]}</span>
                <span class="dag-status">{d.aantalVrij ? "vrij" : d.geslotenReden ? "dicht" : "vol"}</span>
              </>
            );
            return (
              <li>
                {d.aantalVrij ? (
                  <a
                    class={`dag ${gekozen ? "gekozen" : ""}`}
                    href={`${boekLink(b, { vanaf: p.vanaf, datum: d.datum })}#tijd`}
                    aria-current={gekozen ? "date" : undefined}
                    aria-label={label}
                  >
                    {inhoud}
                  </a>
                ) : (
                  <span class="dag niet-beschikbaar" aria-label={label}>
                    {inhoud}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        {!p.dagen.some((d) => d.aantalVrij) ? (
          <p class="leeg">
            In deze periode is er geen plek meer.{" "}
            {p.eersteVrijeDag ? (
              <a href={`${boekLink(b, { vanaf: p.eersteVrijeDag, datum: p.eersteVrijeDag })}#tijd`}>
                Eerstvolgende vrije dag: {formatDatumLang(p.eersteVrijeDag)}
              </a>
            ) : p.volgendeVanaf ? (
              <a href={boekLink(b, { vanaf: p.volgendeVanaf })}>Bekijk latere dagen</a>
            ) : null}
          </p>
        ) : null}
      </Stap>

      {p.datum ? (
        <Stap nummer={2} titel={`Kies een tijd op ${formatDatumLang(p.datum, false)}`} id="tijd">
          {p.tijden.length ? (
            [...tijdenPerDeel.entries()].map(([deel, tijden]) => (
              <div class="dagdeel">
                <h3>{deel}</h3>
                <ul class="tijden" role="list">
                  {tijden.map((t) => (
                    <li>
                      <a
                        class={`tijd ${t === p.tijd ? "gekozen" : ""}`}
                        href={`${boekLink(b, { vanaf: p.vanaf, datum: p.datum, tijd: t })}#gegevens`}
                        aria-current={t === p.tijd ? "time" : undefined}
                      >
                        {t}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          ) : (
            <p class="leeg">Op deze dag zijn geen tijden meer vrij. Kies een andere dag.</p>
          )}
        </Stap>
      ) : null}

      {p.datum && (p.tijd || (p.herkies && p.tijden.length)) ? (
        <Stap nummer={3} titel="Jouw gegevens" id="gegevens">
          <p class="samenvatting">
            <strong>{b.naam}</strong>
            <br />
            {formatDatumLang(p.datum)}
            {p.tijd ? ` om ${p.tijd}` : null}
            <br />
            <span class="klein">Duur ca. {formatDuur(b.duurMinuten)}</span>
          </p>
          {foutLijst.length ? (
            <div class="foutoverzicht" role="alert" tabindex={-1} id="fouten">
              <h3>Controleer de volgende {foutLijst.length === 1 ? "punt" : "punten"}:</h3>
              <ul>
                {foutLijst.map(([veld, tekst]) => (
                  <li>{veld === "algemeen" ? tekst : <a href={veld === "tijd" || veld === "behandeling" ? "#tijd" : `#veld-${veld}`}>{tekst}</a>}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <BoekFormulier {...p} />
        </Stap>
      ) : null}
    </Pagina>
  );
};

const Veld: FC<{
  id: string;
  label: string;
  fout?: string;
  hulp?: string;
  verplicht?: boolean;
  invoer: (attrs: Record<string, string | boolean | undefined>) => unknown;
}> = (p) => {
  const beschrijving = [p.hulp ? `hulp-${p.id}` : null, p.fout ? `fout-${p.id}` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div class={`veld ${p.fout ? "met-fout" : ""}`}>
      <label for={`veld-${p.id}`}>
        {p.label}
        {p.verplicht ? null : <span class="optioneel"> (optioneel)</span>}
      </label>
      {p.hulp ? (
        <p class="hulp" id={`hulp-${p.id}`}>
          {p.hulp}
        </p>
      ) : null}
      {p.fout ? (
        <p class="veldfout" id={`fout-${p.id}`}>
          {p.fout}
        </p>
      ) : null}
      {p.invoer({
        id: `veld-${p.id}`,
        "aria-describedby": beschrijving,
        "aria-invalid": p.fout ? "true" : undefined,
        required: p.verplicht || undefined,
      }) as never}
    </div>
  );
};

const BoekFormulier: FC<BoekPaginaProps> = (p) => {
  const cfg = p.config;
  const w = p.waarden;
  const f = p.fouten;
  const fotosAan = cfg.formulier.fotos.aan;
  const toonHerinnering = cfg.berichten.herinnering.aan;
  const toonReview = cfg.berichten.review.aan && !!cfg.bedrijf.googleReviewUrl;
  const toonOnderhoud = cfg.berichten.onderhoud.aan && (cfg.behandelingen.some((b) => b.onderhoudNaWeken) || cfg.berichten.seizoen.length > 0);
  return (
    <form
      method="post"
      action={`/boeken/${p.behandeling.id}#gegevens`}
      enctype={fotosAan ? "multipart/form-data" : undefined}
      class="formulier"
      data-boekformulier
      novalidate
    >
      <input type="hidden" name="datum" value={p.datum ?? ""} />
      {p.tijd ? (
        <input type="hidden" name="tijd" value={p.tijd} />
      ) : (
        <fieldset class="toestemmingen">
          <legend>Kies een ander tijdstip op {p.datum ? formatDatumLang(p.datum, false) : ""}</legend>
          <p class="hulp">Je gegevens blijven bewaard; kies een nieuwe tijd en verstuur opnieuw.</p>
          <ul class="tijden" role="list">
            {p.tijden.map((t, i) => (
              <li>
                <label class="tijd tijd-keuze">
                  <input type="radio" name="tijd" value={t} required checked={i === 0} />
                  <span>{t}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      <div class="valstrik" aria-hidden="true">
        <label for="veld-website">Laat dit veld leeg</label>
        <input id="veld-website" name="website" type="text" tabindex={-1} autocomplete="off" />
      </div>

      <Veld id="naam" label="Naam" verplicht fout={f.naam} invoer={(a) => <input {...a} name="naam" type="text" autocomplete="name" value={w.naam} maxlength={100} />} />
      <Veld id="email" label="E-mailadres" verplicht fout={f.email} hulp="Hierop ontvang je de bevestiging." invoer={(a) => <input {...a} name="email" type="email" autocomplete="email" inputmode="email" value={w.email} maxlength={254} />} />
      <Veld id="telefoon" label="Telefoonnummer" verplicht={cfg.formulier.telefoonVerplicht} fout={f.telefoon} invoer={(a) => <input {...a} name="telefoon" type="tel" autocomplete="tel" inputmode="tel" value={w.telefoon} maxlength={20} />} />
      {(cfg.formulier.extraVelden ?? []).map((v) => (
        <Veld id={`extra_${v.id}`} label={v.label} verplicht={v.verplicht} fout={f[`extra_${v.id}`]} hulp={v.hulptekst} invoer={(a) => <input {...a} name={`extra_${v.id}`} type="text" value={w.extra[v.id] ?? ""} placeholder={v.placeholder} maxlength={v.maxLengte ?? 100} />} />
      ))}
      <Veld id="opmerking" label="Opmerking" fout={f.opmerking} invoer={(a) => (
          <textarea {...a} name="opmerking" rows={3} maxlength={1000} placeholder={cfg.formulier.opmerkingPlaceholder}>
            {w.opmerking}
          </textarea>
        )} />

      {fotosAan ? (
        <Veld
          id="fotos"
          label={`Foto's (maximaal ${cfg.formulier.fotos.maxAantal})`}
          fout={f.fotos}
          hulp={cfg.formulier.fotos.uitleg ?? "Je kunt eventueel foto's meesturen."}
         invoer={(a) => (
            <>
              <input {...a} name="fotos" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple data-max={String(cfg.formulier.fotos.maxAantal)} />
              <div class="foto-voorbeelden" data-foto-voorbeelden aria-live="polite"></div>
            </>
          )} />
      ) : null}

      {toonHerinnering || toonReview || toonOnderhoud ? (
        <fieldset class="toestemmingen">
          <legend>Berichten die je van ons wilt ontvangen</legend>
          <p class="hulp">
            Je ontvangt altijd een bevestiging van je afspraak. Hieronder kies je zelf of je daarnaast iets van ons wilt horen. Afmelden kan altijd via de link in elke e-mail.
          </p>
          {toonHerinnering ? (
            <label class="vinkje">
              <input type="checkbox" name="toestemming_herinnering" value="ja" checked={w.toestemmingHerinnering} />
              <span>Stuur mij {cfg.berichten.herinnering.urenVooraf} uur van tevoren een herinnering per e-mail.</span>
            </label>
          ) : null}
          {toonReview ? (
            <label class="vinkje">
              <input type="checkbox" name="toestemming_review" value="ja" checked={w.toestemmingReview} />
              <span>Je mag me na afloop één keer vragen om een review (met hooguit één herinnering).</span>
            </label>
          ) : null}
          {toonOnderhoud ? (
            <label class="vinkje">
              <input type="checkbox" name="toestemming_onderhoud" value="ja" checked={w.toestemmingOnderhoud} />
              <span>Stuur me af en toe een onderhouds- of seizoensherinnering, bijvoorbeeld als het tijd is voor een nieuwe beurt.</span>
            </label>
          ) : null}
        </fieldset>
      ) : null}

      <p class="klein">
        We gebruiken je gegevens alleen voor deze afspraak en de berichten die je hierboven kiest. Lees onze{" "}
        <a href={cfg.bedrijf.privacyUrl ?? "/privacy"}>privacyverklaring</a>.
      </p>
      <button type="submit" class="knop groot" data-bezig-tekst="Even geduld…">
        {cfg.planning.automatischBevestigen ? "Afspraak maken" : "Afspraak aanvragen"}
      </button>
      {cfg.planning.automatischBevestigen ? null : (
        <p class="klein">Je aanvraag is pas definitief als we hem hebben bevestigd. Je hoort zo snel mogelijk van ons.</p>
      )}
    </form>
  );
};

// ---------------------------------------------------------------------------
// Afspraakpagina voor de klant
// ---------------------------------------------------------------------------

export const AfspraakPagina: FC<
  Basis & { afspraak: Afspraak; nieuw: boolean; magAnnuleren: boolean; agendaUrl: string; googleAgendaUrl: string }
> = (p) => {
  const a = p.afspraak;
  const actief = a.status === "aangevraagd" || a.status === "bevestigd";
  const kop =
    p.nieuw && a.status === "aangevraagd"
      ? "Bedankt! We hebben je aanvraag ontvangen"
      : p.nieuw && a.status === "bevestigd"
        ? "Gelukt! Je afspraak staat vast"
        : "Je afspraak";
  const uitleg: Record<string, string> = {
    aangevraagd: "We bekijken je aanvraag zo snel mogelijk. Zodra hij is bevestigd, krijg je een e-mail. Tot die tijd is de afspraak nog niet definitief.",
    bevestigd: "Je afspraak is bevestigd. We zien je graag!",
    afgerond: "Deze afspraak is afgerond. Bedankt voor je bezoek!",
    geweigerd: "Deze aanvraag konden we helaas niet inplannen.",
    geannuleerd: "Deze afspraak is geannuleerd.",
    verlopen: "Deze aanvraag is verlopen omdat we hem niet op tijd konden bevestigen.",
    niet_verschenen: "Deze afspraak is voorbij.",
  };
  return (
    <Pagina titel="Je afspraak" config={p.config} demo={p.demo} melding={p.melding} smal>
      <div class="kaart">
        <h1>{kop}</h1>
        <p>
          <span class={`status status-${a.status}`}>{STATUS_LABELS[a.status]}</span>
        </p>
        <p>{uitleg[a.status]}</p>
        <dl class="gegevens">
          <div>
            <dt>Behandeling</dt>
            <dd>{a.behandeling_naam}</dd>
          </div>
          <div>
            <dt>Datum</dt>
            <dd>{formatDatumLang(datumVan(a.start))}</dd>
          </div>
          <div>
            <dt>Tijd</dt>
            <dd>
              {tijdVan(a.start)} – {tijdVan(a.eind)} (ca. {formatDuur(minutenTussen(a.start, a.eind))})
            </dd>
          </div>
          <div>
            <dt>Adres</dt>
            <dd>
              {p.config.bedrijf.adres.straat}, {p.config.bedrijf.adres.postcode} {p.config.bedrijf.adres.plaats}
            </dd>
          </div>
          {a.reden && (a.status === "geweigerd" || a.status === "geannuleerd") && a.reden !== "Geannuleerd door klant" ? (
            <div>
              <dt>Toelichting</dt>
              <dd>{a.reden}</dd>
            </div>
          ) : null}
        </dl>
        {p.nieuw && a.status === "aangevraagd" ? <p>We hebben je een e-mail gestuurd met de details van je aanvraag.</p> : null}
        {a.status === "bevestigd" ? (
          <div class="knoppen">
            <a class="knop" href={p.agendaUrl}>
              Zet in je agenda
            </a>
            <a class="knop-licht" href={p.googleAgendaUrl} target="_blank" rel="noopener">
              Google Agenda
            </a>
          </div>
        ) : null}
        {!actief ? (
          <p>
            <a class="knop" href={`/boeken/${a.behandeling_id}`}>
              Nieuwe afspraak maken
            </a>
          </p>
        ) : null}
      </div>
      {actief ? (
        <div class="kaart">
          <h2>Verhinderd?</h2>
          {p.magAnnuleren ? (
            <form method="post" action={`/afspraak/${a.token}/annuleren`} data-bevestig="Weet je zeker dat je deze afspraak wilt annuleren?">
              <p>Je kunt je afspraak tot {p.config.planning.annulerenTotUrenVooraf} uur van tevoren zelf annuleren.</p>
              <button type="submit" class="knop-gevaar">
                Afspraak annuleren
              </button>
            </form>
          ) : (
            <p>
              Neem contact met ons op
              {p.config.bedrijf.telefoon ? (
                <>
                  {" "}
                  via <a href={`tel:${p.config.bedrijf.telefoon.replace(/[^\d+]/g, "")}`}>{p.config.bedrijf.telefoon}</a> of
                </>
              ) : (
                " via"
              )}{" "}
              <a href={`mailto:${p.config.bedrijf.email}`}>{p.config.bedrijf.email}</a>.
            </p>
          )}
        </div>
      ) : null}
    </Pagina>
  );
};

// ---------------------------------------------------------------------------
// Afmelden en privacy
// ---------------------------------------------------------------------------

export const AfmeldPagina: FC<Basis & { token: string; klaar: boolean }> = (p) => (
  <Pagina titel="Afmelden" config={p.config} demo={p.demo} smal>
    <div class="kaart">
      {p.klaar ? (
        <>
          <h1>Je bent afgemeld</h1>
          <p>
            Je ontvangt van ons geen herinneringen, reviewverzoeken en onderhoudsberichten meer. Berichten over afspraken die je zelf maakt (zoals een bevestiging) blijf je
            wel ontvangen.
          </p>
          <p>
            <a href="/">Naar de startpagina</a>
          </p>
        </>
      ) : (
        <form method="post" action={`/afmelden/${p.token}`}>
          <h1>Afmelden voor berichten</h1>
          <p>Wil je geen herinneringen, reviewverzoeken en onderhoudsberichten meer van {p.config.bedrijf.naam} ontvangen?</p>
          <button type="submit" class="knop">
            Ja, meld me af
          </button>
        </form>
      )}
    </div>
  </Pagina>
);

export const PrivacyPagina: FC<Basis> = ({ config, demo }) => {
  const b = config.bedrijf;
  return (
    <Pagina titel="Privacyverklaring" config={config} demo={demo} smal>
      <article class="kaart tekst">
        <h1>Privacyverklaring</h1>
        <p>
          {b.naam} ({b.adres.straat}, {b.adres.postcode} {b.adres.plaats}
          {b.kvk ? `, KvK ${b.kvk}` : ""}) is verantwoordelijk voor de verwerking van de gegevens die je via deze boekingspagina invult.
        </p>
        <h2>Welke gegevens en waarvoor</h2>
        <ul>
          <li>Naam, e-mailadres en telefoonnummer: om je afspraak in te plannen en je daarover te informeren (uitvoering van de overeenkomst).</li>
          <li>Extra gegevens die je invult (zoals een opmerking{config.formulier.extraVelden?.length ? ` of ${config.formulier.extraVelden.map((v) => v.label.toLowerCase()).join(", ")}` : ""}): om de afspraak goed voor te bereiden.</li>
          {config.formulier.fotos.aan ? <li>Foto's die je meestuurt: om de behandeling in te schatten. We verwijderen ze automatisch {config.privacy.fotosBewarenDagen} dagen na je afspraak.</li> : null}
          <li>Herinneringen, reviewverzoeken en onderhouds- of seizoensberichten sturen we alleen als je daar zelf een vinkje voor zet (toestemming). Je kunt je altijd afmelden via de link in elke e-mail.</li>
        </ul>
        <h2>Hoe lang bewaren we je gegevens?</h2>
        <p>
          Je gegevens worden {config.privacy.gegevensBewarenMaanden} maanden na je laatste afspraak automatisch geanonimiseerd. Foto's verwijderen we na {config.privacy.fotosBewarenDagen} dagen.
        </p>
        <h2>Met wie delen we je gegevens?</h2>
        <p>
          We verkopen je gegevens nooit. De boekingspagina draait op servers van Cloudflare; e-mails worden verstuurd via onze e-mailprovider. Met deze partijen zijn afspraken
          gemaakt over de bescherming van je gegevens. We gebruiken geen tracking- of advertentiecookies; alleen het beheer gebruikt een noodzakelijk inlogcookie.
        </p>
        <h2>Je rechten</h2>
        <p>
          Je mag je gegevens inzien, laten corrigeren of laten verwijderen, en je toestemming altijd intrekken. Stuur daarvoor een e-mail naar{" "}
          <a href={`mailto:${b.email}`}>{b.email}</a>. Heb je een klacht? Dan kun je ook terecht bij de Autoriteit Persoonsgegevens.
        </p>
      </article>
    </Pagina>
  );
};
