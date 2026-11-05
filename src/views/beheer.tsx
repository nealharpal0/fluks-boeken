/** @jsxImportSource hono/jsx */
import type { Child, FC } from "hono/jsx";
import type { KlantConfig } from "../config/schema";
import { extraVeldenVan } from "../db/afspraken";
import type { FotoInfo } from "../db/overig";
import { openingOp } from "../lib/beschikbaarheid";
import {
  DAGNAMEN,
  datumVan,
  formatDatumKort,
  formatDatumLang,
  formatDuur,
  maandagVan,
  minutenTussen,
  minutenVan,
  plusDagen,
  tijdVan,
} from "../lib/tijd";
import { type Afspraak, type BerichtRij, type Blokkade, STATUS_LABELS } from "../types";
import { type Melding, Pagina } from "./layout";

interface Basis {
  config: KlantConfig;
  demo: boolean;
  melding?: Melding | null;
}

const BeheerPagina: FC<Basis & { titel: string; actief: string; children?: Child }> = (p) => (
  <Pagina titel={p.titel} config={p.config} demo={p.demo} melding={p.melding} beheer={{ actief: p.actief, ingelogd: true }}>
    {p.children}
  </Pagina>
);

const Status: FC<{ a: Pick<Afspraak, "status"> }> = ({ a }) => <span class={`status status-${a.status}`}>{STATUS_LABELS[a.status]}</span>;

function wanneer(a: Pick<Afspraak, "start" | "eind">): string {
  return `${formatDatumKort(datumVan(a.start))} · ${tijdVan(a.start)}–${tijdVan(a.eind)}`;
}

// ---------------------------------------------------------------------------
// Inloggen
// ---------------------------------------------------------------------------

export const InlogPagina: FC<Basis & { fout?: string; terug: string; configFout?: string }> = (p) => (
  <Pagina titel="Inloggen" config={p.config} demo={p.demo} beheer={{ actief: "", ingelogd: false }} melding={p.melding}>
    <div class="kaart inloggen">
      <h1>Inloggen</h1>
      {p.configFout ? (
        <div class="melding melding-fout" role="alert">
          {p.configFout}
        </div>
      ) : (
        <form method="post" action="/beheer/inloggen">
          <input type="hidden" name="terug" value={p.terug} />
          {p.fout ? (
            <p class="veldfout" id="fout-wachtwoord" role="alert">
              {p.fout}
            </p>
          ) : null}
          <div class={`veld ${p.fout ? "met-fout" : ""}`}>
            <label for="wachtwoord">Wachtwoord</label>
            <input
              id="wachtwoord"
              name="wachtwoord"
              type="password"
              autocomplete="current-password"
              required
              autofocus
              aria-describedby={p.fout ? "fout-wachtwoord" : undefined}
              aria-invalid={p.fout ? "true" : undefined}
            />
          </div>
          {p.demo ? <p class="hulp">Demo: het wachtwoord is <code>demo</code>.</p> : null}
          <button type="submit" class="knop">
            Inloggen
          </button>
        </form>
      )}
    </div>
  </Pagina>
);

// ---------------------------------------------------------------------------
// Overzicht
// ---------------------------------------------------------------------------

const AanvraagKaart: FC<{ a: Afspraak; fotos: number; config: KlantConfig }> = ({ a, fotos, config }) => {
  const extra = extraVeldenVan(a);
  return (
    <li class="kaart aanvraag">
      <div class="aanvraag-kop">
        <div>
          <h3>
            <a href={`/beheer/afspraak/${a.id}`}>{a.naam}</a>
          </h3>
          <p class="aanvraag-wat">
            <strong>{a.behandeling_naam}</strong>
            <br />
            {formatDatumLang(datumVan(a.start))}, {tijdVan(a.start)}–{tijdVan(a.eind)}
          </p>
        </div>
        <Status a={a} />
      </div>
      <p class="klein">
        {a.telefoon ? <a href={`tel:${a.telefoon.replace(/[^\d+]/g, "")}`}>{a.telefoon}</a> : null}
        {a.telefoon && a.email ? " · " : null}
        {a.email ? <a href={`mailto:${a.email}`}>{a.email}</a> : null}
        {(config.formulier.extraVelden ?? [])
          .filter((v) => extra[v.id])
          .map((v) => (
            <>
              {" · "}
              {v.label}: {extra[v.id]}
            </>
          ))}
        {fotos ? ` · ${fotos} foto${fotos === 1 ? "" : "'s"}` : null}
      </p>
      {a.opmerking ? <p class="opmerking">“{a.opmerking}”</p> : null}
      <div class="knoppen">
        <form method="post" action={`/beheer/afspraak/${a.id}/accepteren`}>
          <button type="submit" class="knop">
            Accepteren
          </button>
        </form>
        <details class="weigeren">
          <summary class="knop-licht">Weigeren…</summary>
          <form method="post" action={`/beheer/afspraak/${a.id}/weigeren`} class="weiger-form">
            <label for={`reden-${a.id}`}>Toelichting voor de klant (optioneel)</label>
            <textarea id={`reden-${a.id}`} name="reden" rows={2} maxlength={500} placeholder="Bijv. die dag zijn we helaas volgeboekt."></textarea>
            <button type="submit" class="knop-gevaar">
              Aanvraag weigeren
            </button>
          </form>
        </details>
        <a class="knop-licht" href={`/beheer/afspraak/${a.id}#verzetten`}>
          Ander tijdstip
        </a>
      </div>
    </li>
  );
};

export const OverzichtPagina: FC<
  Basis & {
    aanvragen: Afspraak[];
    vandaag: Afspraak[];
    komend: Afspraak[];
    fotoAantallen: Map<number, number>;
    waarschuwingen: string[];
    datumVandaag: string;
  }
> = (p) => (
  <BeheerPagina titel="Overzicht" actief="/beheer" config={p.config} demo={p.demo} melding={p.melding}>
    <h1>Overzicht</h1>
    {p.waarschuwingen.length ? (
      <div class="melding melding-info">
        <strong>Aandachtspunten in de configuratie:</strong>
        <ul>
          {p.waarschuwingen.map((w) => (
            <li>{w}</li>
          ))}
        </ul>
      </div>
    ) : null}

    <section aria-labelledby="aanvragen-kop">
      <h2 id="aanvragen-kop">
        Nieuwe aanvragen <span class="teller">{p.aanvragen.length}</span>
      </h2>
      {p.aanvragen.length ? (
        <ul class="aanvragen" role="list">
          {p.aanvragen.map((a) => (
            <AanvraagKaart a={a} fotos={p.fotoAantallen.get(a.id) ?? 0} config={p.config} />
          ))}
        </ul>
      ) : (
        <p class="leeg">Geen openstaande aanvragen. 🎉</p>
      )}
    </section>

    <div class="twee-kolommen">
      <section class="kaart" aria-labelledby="vandaag-kop">
        <h2 id="vandaag-kop">Vandaag, {formatDatumLang(p.datumVandaag, false)}</h2>
        {p.vandaag.length ? (
          <ul class="lijst" role="list">
            {p.vandaag.map((a) => (
              <li>
                <a href={`/beheer/afspraak/${a.id}`} class="lijst-item">
                  <span class="lijst-tijd">
                    {tijdVan(a.start)}–{tijdVan(a.eind)}
                  </span>
                  <span>
                    <strong>{a.naam}</strong>
                    <br />
                    <span class="klein">{a.behandeling_naam}</span>
                  </span>
                  <Status a={a} />
                </a>
                {a.status === "bevestigd" && p.config.berichten.klaar.aan ? (
                  <form method="post" action={`/beheer/afspraak/${a.id}/klaar`} class="inline-form">
                    <button type="submit" class="knop-licht klein-knop">
                      {p.config.berichten.klaar.knopTekst}
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p class="leeg">Geen afspraken vandaag.</p>
        )}
      </section>
      <section class="kaart" aria-labelledby="komend-kop">
        <h2 id="komend-kop">Komende 7 dagen</h2>
        {p.komend.length ? (
          <ul class="lijst" role="list">
            {p.komend.map((a) => (
              <li>
                <a href={`/beheer/afspraak/${a.id}`} class="lijst-item">
                  <span class="lijst-tijd">{wanneer(a)}</span>
                  <span>
                    <strong>{a.naam}</strong>
                    <br />
                    <span class="klein">{a.behandeling_naam}</span>
                  </span>
                  <Status a={a} />
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p class="leeg">Nog geen afspraken de komende week.</p>
        )}
        <p>
          <a href="/beheer/agenda">Naar de agenda ›</a>
        </p>
      </section>
    </div>
  </BeheerPagina>
);

// ---------------------------------------------------------------------------
// Agenda
// ---------------------------------------------------------------------------

interface AgendaItem {
  soort: "afspraak" | "blokkade";
  start: string;
  eind: string;
  titel: string;
  sub: string;
  href?: string;
  status?: string;
}

function lanes(items: AgendaItem[]): { item: AgendaItem; lane: number; lanes: number }[] {
  const gesorteerd = [...items].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const uit: { item: AgendaItem; lane: number; lanes: number }[] = [];
  let groep: { item: AgendaItem; lane: number; lanes: number }[] = [];
  let groepEind = "";
  const sluit = () => {
    const n = Math.max(1, ...groep.map((g) => g.lane + 1));
    for (const g of groep) g.lanes = n;
    uit.push(...groep);
    groep = [];
  };
  for (const item of gesorteerd) {
    if (groep.length && item.start >= groepEind) sluit();
    const bezet = new Set(groep.filter((g) => g.item.eind > item.start).map((g) => g.lane));
    let lane = 0;
    while (bezet.has(lane)) lane++;
    groep.push({ item, lane, lanes: 1 });
    if (item.eind > groepEind) groepEind = item.eind;
  }
  if (groep.length) sluit();
  return uit;
}

export const AgendaPagina: FC<
  Basis & { weergave: "dag" | "week"; datum: string; vandaag: string; afspraken: Afspraak[]; blokkades: Blokkade[] }
> = (p) => {
  const dagen = p.weergave === "week" ? Array.from({ length: 7 }, (_, i) => plusDagen(maandagVan(p.datum), i)) : [p.datum];
  // Tijdbereik: van de vroegste opening tot de laatste sluiting (en altijd alle afspraken).
  let begin = 24 * 60;
  let eind = 0;
  for (const d of dagen) {
    for (const [v, t] of openingOp(p.config, d).vakken) {
      begin = Math.min(begin, v);
      eind = Math.max(eind, t);
    }
  }
  for (const a of p.afspraken) {
    if (dagen.includes(datumVan(a.start))) {
      begin = Math.min(begin, minutenVan(a.start));
      eind = Math.max(eind, datumVan(a.eind) === datumVan(a.start) ? minutenVan(a.eind) : 24 * 60);
    }
  }
  if (begin >= eind) {
    begin = 8 * 60;
    eind = 18 * 60;
  }
  begin = Math.floor(begin / 60) * 60;
  eind = Math.min(24 * 60, Math.ceil(eind / 60) * 60);
  const totaal = eind - begin;
  const pct = (min: number) => `${(((min - begin) / totaal) * 100).toFixed(3)}%`;

  const itemsVan = (d: string): AgendaItem[] => {
    const items: AgendaItem[] = [];
    for (const a of p.afspraken) {
      if (datumVan(a.start) !== d) continue;
      items.push({
        soort: "afspraak",
        start: tijdVan(a.start),
        eind: datumVan(a.eind) === d ? tijdVan(a.eind) : "24:00",
        titel: a.naam,
        sub: `${tijdVan(a.start)} ${a.behandeling_naam}`,
        href: `/beheer/afspraak/${a.id}`,
        status: a.status,
      });
    }
    for (const b of p.blokkades) {
      const s = b.start < `${d}T00:00` ? "00:00" : datumVan(b.start) === d ? tijdVan(b.start) : null;
      const e = b.eind > `${plusDagen(d, 1)}T00:00` || datumVan(b.eind) !== d ? "24:00" : tijdVan(b.eind);
      if (s === null || b.eind <= `${d}T00:00` || b.start >= `${plusDagen(d, 1)}T00:00`) continue;
      items.push({ soort: "blokkade", start: s, eind: e, titel: "Geblokkeerd", sub: b.reden || "" });
    }
    return items;
  };
  const minuut = (t: string) => (t === "24:00" ? 1440 : Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)));
  const vorige = plusDagen(p.datum, p.weergave === "week" ? -7 : -1);
  const volgende = plusDagen(p.datum, p.weergave === "week" ? 7 : 1);
  const titel =
    p.weergave === "week"
      ? `Week van ${formatDatumLang(dagen[0]!, false)} t/m ${formatDatumLang(dagen[6]!, false)} ${dagen[6]!.slice(0, 4)}`
      : formatDatumLang(p.datum);
  const uren: number[] = [];
  for (let u = begin; u < eind; u += 60) uren.push(u);

  return (
    <BeheerPagina titel="Agenda" actief="/beheer/agenda" config={p.config} demo={p.demo} melding={p.melding}>
      <div class="agenda-kop">
        <h1>{titel}</h1>
        <div class="agenda-bediening">
          <nav class="segment" aria-label="Weergave">
            <a href={`/beheer/agenda?weergave=dag&datum=${p.datum}`} aria-current={p.weergave === "dag" ? "page" : undefined}>
              Dag
            </a>
            <a href={`/beheer/agenda?weergave=week&datum=${p.datum}`} aria-current={p.weergave === "week" ? "page" : undefined}>
              Week
            </a>
          </nav>
          <a class="knop-licht klein-knop" href={`/beheer/agenda?weergave=${p.weergave}&datum=${vorige}`} aria-label={p.weergave === "week" ? "Vorige week" : "Vorige dag"}>
            ‹
          </a>
          <a class="knop-licht klein-knop" href={`/beheer/agenda?weergave=${p.weergave}&datum=${p.vandaag}`}>
            Vandaag
          </a>
          <a class="knop-licht klein-knop" href={`/beheer/agenda?weergave=${p.weergave}&datum=${volgende}`} aria-label={p.weergave === "week" ? "Volgende week" : "Volgende dag"}>
            ›
          </a>
          <form method="get" action="/beheer/agenda" class="inline-form datum-kiezer">
            <input type="hidden" name="weergave" value={p.weergave} />
            <label for="agenda-datum" class="sr-only">
              Ga naar datum
            </label>
            <input id="agenda-datum" type="date" name="datum" value={p.datum} />
            <button type="submit" class="knop-licht klein-knop">
              Ga
            </button>
          </form>
        </div>
      </div>
      <p class="legenda klein">
        <span class="legenda-item bevestigd">Bevestigd</span> <span class="legenda-item aangevraagd">Aanvraag</span> <span class="legenda-item afgerond">Afgerond</span>{" "}
        <span class="legenda-item blokkade">Geblokkeerd</span>
      </p>
      <div class="agenda-scroll">
        <div class={`agenda agenda-${p.weergave}`} style={`--kolommen:${dagen.length}`}>
          <div class="agenda-tijden" aria-hidden="true">
            <div class="agenda-dagkop"></div>
            <div class="agenda-kolom-inhoud">
              {uren.map((u) => (
                <span class="agenda-uur" style={`top:${pct(u)}`}>
                  {String(u / 60).padStart(2, "0")}:00
                </span>
              ))}
            </div>
          </div>
          {dagen.map((d, i) => {
            const items = itemsVan(d);
            const opening = openingOp(p.config, d);
            return (
              <section class={`agenda-dag ${d === p.vandaag ? "is-vandaag" : ""}`} aria-label={formatDatumLang(d)}>
                <h2 class="agenda-dagkop">
                  <a href={`/beheer/agenda?weergave=dag&datum=${d}`}>
                    {p.weergave === "week" ? DAGNAMEN[i]!.slice(0, 2) : DAGNAMEN[(new Date(`${d}T12:00Z`).getUTCDay() + 6) % 7]} {Number(d.slice(8, 10))}
                  </a>
                  {opening.geslotenReden && opening.geslotenReden !== "Gesloten" ? <span class="klein"> {opening.geslotenReden}</span> : null}
                </h2>
                <div class="agenda-kolom-inhoud">
                  {opening.vakken.map(([v, t]) => (
                    <div class="agenda-open" style={`top:${pct(Math.max(v, begin))};height:calc(${pct(Math.min(t, eind))} - ${pct(Math.max(v, begin))})`}></div>
                  ))}
                  {uren.map((u) => (
                    <div class="agenda-lijn" style={`top:${pct(u)}`}></div>
                  ))}
                  {items.length === 0 ? <span class="sr-only">Geen afspraken</span> : null}
                  {lanes(items).map(({ item, lane, lanes: n }) => {
                    const s = Math.max(begin, minuut(item.start));
                    const e = Math.min(eind, minuut(item.eind));
                    const stijl = `top:${pct(s)};height:calc(${pct(e)} - ${pct(s)});left:calc(${(lane / n) * 100}% + 2px);width:calc(${100 / n}% - 4px)`;
                    const inhoud = (
                      <>
                        <span class="agenda-item-titel">{item.titel}</span>
                        <span class="agenda-item-sub">
                          {item.sub}
                          {item.status === "aangevraagd" ? " · aanvraag" : ""}
                        </span>
                      </>
                    );
                    return item.href ? (
                      <a class={`agenda-item ${item.status}`} style={stijl} href={item.href}>
                        {inhoud}
                      </a>
                    ) : (
                      <div class="agenda-item blokkade" style={stijl}>
                        {inhoud}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
      {p.weergave === "dag" ? (
        <section class="kaart" aria-labelledby="dag-lijst">
          <h2 id="dag-lijst">Afspraken op deze dag</h2>
          {p.afspraken.filter((a) => datumVan(a.start) === p.datum).length ? (
            <ul class="lijst" role="list">
              {p.afspraken
                .filter((a) => datumVan(a.start) === p.datum)
                .map((a) => (
                  <li>
                    <a href={`/beheer/afspraak/${a.id}`} class="lijst-item">
                      <span class="lijst-tijd">
                        {tijdVan(a.start)}–{tijdVan(a.eind)}
                      </span>
                      <span>
                        <strong>{a.naam}</strong>
                        <br />
                        <span class="klein">
                          {a.behandeling_naam}
                          {a.telefoon ? ` · ${a.telefoon}` : ""}
                        </span>
                      </span>
                      <Status a={a} />
                    </a>
                  </li>
                ))}
            </ul>
          ) : (
            <p class="leeg">Geen afspraken.</p>
          )}
          <p>
            <a class="knop-licht" href={`/beheer/nieuw?datum=${p.datum}`}>
              Afspraak toevoegen op deze dag
            </a>{" "}
            <a class="knop-licht" href={`/beheer/blokkades?datum=${p.datum}`}>
              Tijd blokkeren
            </a>
          </p>
        </section>
      ) : null}
    </BeheerPagina>
  );
};

// ---------------------------------------------------------------------------
// Afspraakdetails
// ---------------------------------------------------------------------------

export const AfspraakDetailPagina: FC<
  Basis & {
    a: Afspraak;
    fotos: FotoInfo[];
    berichten: BerichtRij[];
    andere: Afspraak[];
    verzetDatum: string;
    verzetTijden: string[];
  }
> = (p) => {
  const a = p.a;
  const extra = extraVeldenVan(a);
  const actief = a.status === "aangevraagd" || a.status === "bevestigd";
  const ja = (v: number) => (v ? "Ja" : "Nee");
  return (
    <BeheerPagina titel={`Afspraak ${a.naam}`} actief="" config={p.config} demo={p.demo} melding={p.melding}>
      <p class="kruimel">
        <a href={`/beheer/agenda?weergave=dag&datum=${datumVan(a.start)}`}>‹ Naar {formatDatumLang(datumVan(a.start), false)} in de agenda</a>
      </p>
      <div class="detail-kop">
        <h1>{a.naam}</h1>
        <Status a={a} />
      </div>
      <div class="twee-kolommen">
        <section class="kaart">
          <h2>Afspraak</h2>
          <dl class="gegevens">
            <div>
              <dt>Behandeling</dt>
              <dd>{a.behandeling_naam}</dd>
            </div>
            <div>
              <dt>Wanneer</dt>
              <dd>
                {formatDatumLang(datumVan(a.start))}
                <br />
                {tijdVan(a.start)}–{tijdVan(a.eind)} ({formatDuur(minutenTussen(a.start, a.eind))})
              </dd>
            </div>
            <div>
              <dt>Bron</dt>
              <dd>{a.bron === "beheer" ? "Ingevoerd in het beheer" : a.bron === "demo" ? "Demodata" : "Online geboekt"}</dd>
            </div>
            {a.reden ? (
              <div>
                <dt>Toelichting</dt>
                <dd>{a.reden}</dd>
              </div>
            ) : null}
          </dl>
          <div class="knoppen">
            {a.status === "aangevraagd" ? (
              <>
                <form method="post" action={`/beheer/afspraak/${a.id}/accepteren`}>
                  <button type="submit" class="knop">
                    Accepteren
                  </button>
                </form>
                <details class="weigeren">
                  <summary class="knop-licht">Weigeren…</summary>
                  <form method="post" action={`/beheer/afspraak/${a.id}/weigeren`} class="weiger-form">
                    <label for="reden">Toelichting voor de klant (optioneel)</label>
                    <textarea id="reden" name="reden" rows={2} maxlength={500}></textarea>
                    <button type="submit" class="knop-gevaar">
                      Aanvraag weigeren
                    </button>
                  </form>
                </details>
              </>
            ) : null}
            {a.status === "bevestigd" ? (
              <>
                {p.config.berichten.klaar.aan ? (
                  <form method="post" action={`/beheer/afspraak/${a.id}/klaar`}>
                    <button type="submit" class="knop">
                      {p.config.berichten.klaar.knopTekst}
                    </button>
                  </form>
                ) : (
                  <form method="post" action={`/beheer/afspraak/${a.id}/klaar`}>
                    <button type="submit" class="knop">
                      Afronden
                    </button>
                  </form>
                )}
                <form method="post" action={`/beheer/afspraak/${a.id}/niet-verschenen`} data-bevestig="Markeren als niet verschenen?">
                  <button type="submit" class="knop-licht">
                    Niet verschenen
                  </button>
                </form>
              </>
            ) : null}
            {actief ? (
              <details class="weigeren">
                <summary class="knop-licht">Annuleren…</summary>
                <form method="post" action={`/beheer/afspraak/${a.id}/annuleren`} class="weiger-form" data-bevestig="Weet je zeker dat je deze afspraak wilt annuleren?">
                  <label for="annuleer-reden">Toelichting voor de klant (optioneel)</label>
                  <textarea id="annuleer-reden" name="reden" rows={2} maxlength={500}></textarea>
                  <button type="submit" class="knop-gevaar">
                    Afspraak annuleren
                  </button>
                </form>
              </details>
            ) : null}
          </div>
        </section>
        <section class="kaart">
          <h2>Klant</h2>
          <dl class="gegevens">
            <div>
              <dt>Naam</dt>
              <dd>{a.naam}</dd>
            </div>
            <div>
              <dt>E-mail</dt>
              <dd>{a.email ? <a href={`mailto:${a.email}`}>{a.email}</a> : "–"}</dd>
            </div>
            <div>
              <dt>Telefoon</dt>
              <dd>{a.telefoon ? <a href={`tel:${a.telefoon.replace(/[^\d+]/g, "")}`}>{a.telefoon}</a> : "–"}</dd>
            </div>
            {(p.config.formulier.extraVelden ?? []).map((v) =>
              extra[v.id] ? (
                <div>
                  <dt>{v.label}</dt>
                  <dd>{extra[v.id]}</dd>
                </div>
              ) : null,
            )}
            {a.opmerking ? (
              <div>
                <dt>Opmerking</dt>
                <dd class="opmerking">{a.opmerking}</dd>
              </div>
            ) : null}
            <div>
              <dt>Toestemmingen</dt>
              <dd>
                Herinnering: {ja(a.toestemming_herinnering)} · Review: {ja(a.toestemming_review)} · Onderhoud: {ja(a.toestemming_onderhoud)}
                {a.toestemming_op ? <span class="klein"><br />Gegeven op {a.toestemming_op.slice(0, 16).replace("T", " ")} (UTC)</span> : null}
              </dd>
            </div>
          </dl>
          {p.fotos.length ? (
            <>
              <h3>Foto's</h3>
              <ul class="fotos" role="list">
                {p.fotos.map((f, i) => (
                  <li>
                    <a href={`/beheer/foto/${f.id}`} target="_blank" rel="noopener">
                      <img src={`/beheer/foto/${f.id}`} alt={`Foto ${i + 1} van ${a.naam}`} loading="lazy" width="160" height="120" />
                    </a>
                  </li>
                ))}
              </ul>
              <p class="klein">Foto's worden {p.config.privacy.fotosBewarenDagen} dagen na de afspraak automatisch verwijderd.</p>
            </>
          ) : null}
        </section>
      </div>

      {actief ? (
        <section class="kaart" id="verzetten" aria-labelledby="verzetten-kop">
          <h2 id="verzetten-kop">Verzetten</h2>
          <form method="get" action={`/beheer/afspraak/${a.id}`} class="inline-form">
            <label for="verzet-datum">Kies een datum</label>
            <input id="verzet-datum" type="date" name="verzetDatum" value={p.verzetDatum} />
            <button type="submit" class="knop-licht klein-knop">
              Toon vrije tijden
            </button>
          </form>
          {p.verzetTijden.length ? (
            <>
              <p class="klein">Vrije tijden op {formatDatumLang(p.verzetDatum, false)} (binnen de openingstijden):</p>
              <ul class="tijden" role="list">
                {p.verzetTijden.map((t) => (
                  <li>
                    <form method="post" action={`/beheer/afspraak/${a.id}/verzetten`}>
                      <input type="hidden" name="datum" value={p.verzetDatum} />
                      <input type="hidden" name="tijd" value={t} />
                      <button type="submit" class="tijd">
                        {t}
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p class="leeg">Geen vrije tijden binnen de openingstijden op deze dag.</p>
          )}
          <form method="post" action={`/beheer/afspraak/${a.id}/verzetten`} class="inline-form">
            <input type="hidden" name="datum" value={p.verzetDatum} />
            <label for="verzet-tijd">Of kies zelf een tijd op deze dag</label>
            <input id="verzet-tijd" type="time" name="tijd" step={300} required />
            <button type="submit" class="knop-licht klein-knop">
              Verzetten
            </button>
          </form>
          <p class="klein">De klant krijgt automatisch een e-mail met het nieuwe tijdstip. Dubbele boekingen zijn niet mogelijk.</p>
        </section>
      ) : null}

      <div class="twee-kolommen">
        <section class="kaart">
          <h2>Interne notitie</h2>
          <form method="post" action={`/beheer/afspraak/${a.id}/notitie`}>
            <label for="notitie" class="sr-only">
              Interne notitie
            </label>
            <textarea id="notitie" name="notitie" rows={3} maxlength={2000} placeholder="Alleen zichtbaar voor jou">
              {a.interne_notitie}
            </textarea>
            <button type="submit" class="knop-licht klein-knop">
              Notitie opslaan
            </button>
          </form>
        </section>
        <section class="kaart">
          <h2>Berichten</h2>
          {p.berichten.length ? (
            <ul class="lijst compact" role="list">
              {p.berichten.map((b) => (
                <li>
                  <span class={`bericht-status ${b.status}`}>{b.status}</span> {b.onderwerp}
                  <span class="klein"> · {b.aangemaakt_op.replace("T", " ")}</span>
                  {b.inhoud_html ? (
                    <>
                      {" "}
                      · <a href={`/beheer/berichten/${b.id}`}>bekijk</a>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p class="leeg">Nog geen berichten verstuurd.</p>
          )}
        </section>
      </div>

      {p.andere.length ? (
        <section class="kaart">
          <h2>Andere afspraken van deze klant</h2>
          <ul class="lijst compact" role="list">
            {p.andere.map((x) => (
              <li>
                <a href={`/beheer/afspraak/${x.id}`}>
                  {wanneer(x)} – {x.behandeling_naam}
                </a>{" "}
                <Status a={x} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!a.geanonimiseerd ? (
        <section class="kaart gevaarzone">
          <h2>Privacy (AVG)</h2>
          <p>
            Vraagt de klant om verwijdering van zijn of haar gegevens? Dan wis je hier naam, contactgegevens, opmerkingen en foto's van alle afspraken met dit e-mailadres.
            Toekomstige afspraken worden geannuleerd (zonder e-mail).
          </p>
          <form method="post" action={`/beheer/afspraak/${a.id}/wissen`} data-bevestig="Alle gegevens van deze klant definitief wissen? Dit kan niet ongedaan worden gemaakt.">
            <button type="submit" class="knop-gevaar">
              Klantgegevens wissen
            </button>
          </form>
        </section>
      ) : null}
    </BeheerPagina>
  );
};

// ---------------------------------------------------------------------------
// Nieuwe afspraak (handmatig)
// ---------------------------------------------------------------------------

export const NieuweAfspraakPagina: FC<
  Basis & { datum: string; tijden: string[]; behandelingId: string; fout?: string; waarden: Record<string, string> }
> = (p) => {
  const w = p.waarden;
  return (
    <BeheerPagina titel="Nieuwe afspraak" actief="/beheer/nieuw" config={p.config} demo={p.demo} melding={p.melding}>
      <h1>Nieuwe afspraak invoeren</h1>
      <p>Voor afspraken die telefonisch of aan de balie zijn gemaakt. De afspraak is direct bevestigd en blokkeert het tijdslot.</p>
      <form method="get" action="/beheer/nieuw" class="kaart inline-form">
        <div class="veld">
          <label for="kies-behandeling">Behandeling</label>
          <select id="kies-behandeling" name="behandeling">
            {p.config.behandelingen.map((b) => (
              <option value={b.id} selected={b.id === p.behandelingId}>
                {b.naam} ({formatDuur(b.duurMinuten)})
              </option>
            ))}
          </select>
        </div>
        <div class="veld">
          <label for="kies-datum">Datum</label>
          <input id="kies-datum" type="date" name="datum" value={p.datum} />
        </div>
        <button type="submit" class="knop-licht">
          Toon vrije tijden
        </button>
      </form>
      <form method="post" action="/beheer/nieuw" class="kaart formulier">
        {p.fout ? (
          <div class="melding melding-fout" role="alert">
            {p.fout}
          </div>
        ) : null}
        <input type="hidden" name="behandeling" value={p.behandelingId} />
        <input type="hidden" name="datum" value={p.datum} />
        <p>
          <strong>{p.config.behandelingen.find((b) => b.id === p.behandelingId)?.naam}</strong> op {formatDatumLang(p.datum)}
        </p>
        <div class="veld">
          <label for="nieuw-tijd">Tijd</label>
          {p.tijden.length ? <p class="hulp" id="hulp-tijd">Vrij binnen de openingstijden: {p.tijden.join(", ")}</p> : <p class="hulp" id="hulp-tijd">Binnen de openingstijden is deze dag vol of gesloten; je kunt toch een tijd invullen als die vrij is.</p>}
          <input id="nieuw-tijd" type="time" name="tijd" required step={300} value={w.tijd ?? p.tijden[0] ?? ""} aria-describedby="hulp-tijd" />
        </div>
        <div class="veld">
          <label for="nieuw-naam">Naam klant</label>
          <input id="nieuw-naam" name="naam" type="text" required maxlength={100} value={w.naam ?? ""} />
        </div>
        <div class="veld">
          <label for="nieuw-email">
            E-mailadres <span class="optioneel">(optioneel)</span>
          </label>
          <input id="nieuw-email" name="email" type="email" maxlength={254} value={w.email ?? ""} />
        </div>
        <div class="veld">
          <label for="nieuw-telefoon">
            Telefoon <span class="optioneel">(optioneel)</span>
          </label>
          <input id="nieuw-telefoon" name="telefoon" type="tel" maxlength={20} value={w.telefoon ?? ""} />
        </div>
        <div class="veld">
          <label for="nieuw-notitie">
            Interne notitie <span class="optioneel">(optioneel)</span>
          </label>
          <textarea id="nieuw-notitie" name="notitie" rows={2} maxlength={2000}>
            {w.notitie ?? ""}
          </textarea>
        </div>
        <label class="vinkje">
          <input type="checkbox" name="bevestiging" value="ja" checked={w.bevestiging !== "nee"} />
          <span>Stuur de klant een bevestiging per e-mail (als er een e-mailadres is ingevuld)</span>
        </label>
        <button type="submit" class="knop">
          Afspraak inplannen
        </button>
      </form>
    </BeheerPagina>
  );
};

// ---------------------------------------------------------------------------
// Blokkades
// ---------------------------------------------------------------------------

export const BlokkadesPagina: FC<Basis & { blokkades: Blokkade[]; datum: string; fout?: string }> = (p) => (
  <BeheerPagina titel="Blokkades" actief="/beheer/blokkades" config={p.config} demo={p.demo} melding={p.melding}>
    <h1>Tijden blokkeren</h1>
    <p>Blokkeer tijden waarop klanten niet kunnen boeken, zoals vakantie, een tandartsafspraak of onderhoud van apparatuur.</p>
    <form method="post" action="/beheer/blokkades" class="kaart formulier">
      <h2>Nieuwe blokkade</h2>
      {p.fout ? (
        <div class="melding melding-fout" role="alert">
          {p.fout}
        </div>
      ) : null}
      <div class="rij">
        <div class="veld">
          <label for="blok-van-datum">Vanaf datum</label>
          <input id="blok-van-datum" type="date" name="van_datum" required value={p.datum} />
        </div>
        <div class="veld">
          <label for="blok-van-tijd">
            Vanaf tijd <span class="optioneel">(leeg = hele dag)</span>
          </label>
          <input id="blok-van-tijd" type="time" name="van_tijd" step={300} />
        </div>
      </div>
      <div class="rij">
        <div class="veld">
          <label for="blok-tot-datum">Tot en met datum</label>
          <input id="blok-tot-datum" type="date" name="tot_datum" required value={p.datum} />
        </div>
        <div class="veld">
          <label for="blok-tot-tijd">
            Tot tijd <span class="optioneel">(leeg = einde van de dag)</span>
          </label>
          <input id="blok-tot-tijd" type="time" name="tot_tijd" step={300} />
        </div>
      </div>
      <div class="veld">
        <label for="blok-reden">
          Reden <span class="optioneel">(alleen voor jou zichtbaar)</span>
        </label>
        <input id="blok-reden" type="text" name="reden" maxlength={200} placeholder="Bijv. vakantie" />
      </div>
      <button type="submit" class="knop">
        Blokkeren
      </button>
    </form>
    <section class="kaart">
      <h2>Geplande blokkades</h2>
      {p.blokkades.length ? (
        <ul class="lijst" role="list">
          {p.blokkades.map((b) => (
            <li class="lijst-item">
              <span>
                <strong>
                  {formatDatumKort(datumVan(b.start))} {tijdVan(b.start)} – {datumVan(b.eind) === datumVan(b.start) ? "" : `${formatDatumKort(datumVan(b.eind))} `}
                  {tijdVan(b.eind)}
                </strong>
                {b.reden ? (
                  <>
                    <br />
                    <span class="klein">{b.reden}</span>
                  </>
                ) : null}
              </span>
              <form method="post" action={`/beheer/blokkades/${b.id}/verwijderen`} data-bevestig="Deze blokkade verwijderen?">
                <button type="submit" class="knop-licht klein-knop">
                  Verwijderen
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p class="leeg">Geen geplande blokkades.</p>
      )}
    </section>
  </BeheerPagina>
);

// ---------------------------------------------------------------------------
// Berichten
// ---------------------------------------------------------------------------

const SOORT_LABELS: Record<string, string> = {
  aanvraag_ontvangen: "Aanvraag ontvangen",
  bevestiging: "Bevestiging",
  afwijzing: "Afwijzing",
  verzet: "Verzet",
  geannuleerd: "Geannuleerd",
  verlopen: "Verlopen",
  herinnering: "Herinnering",
  klaar: "Klaar",
  review: "Reviewverzoek",
  review_herinnering: "Reviewherinnering",
  onderhoud: "Onderhoud",
  seizoen: "Seizoen",
  nieuwe_aanvraag: "Melding nieuwe aanvraag",
  klant_annulering: "Melding annulering",
  test: "Testmail",
};

export const BerichtenPagina: FC<Basis & { berichten: BerichtRij[]; smtp: boolean }> = (p) => (
  <BeheerPagina titel="Berichten" actief="/beheer/berichten" config={p.config} demo={p.demo} melding={p.melding}>
    <h1>Verstuurde berichten</h1>
    {!p.smtp ? (
      <p class="melding melding-info">
        {p.demo
          ? "Demo-modus: e-mails worden niet echt verstuurd, maar je kunt hieronder precies zien wat de klant zou ontvangen."
          : "Er is geen SMTP-server ingesteld: e-mails worden alleen gelogd (status 'gelogd'), niet verstuurd."}
      </p>
    ) : null}
    {p.berichten.length ? (
      <div class="tabel-scroll">
        <table class="tabel">
          <caption class="sr-only">Laatste 200 berichten</caption>
          <thead>
            <tr>
              <th scope="col">Moment</th>
              <th scope="col">Soort</th>
              <th scope="col">Aan</th>
              <th scope="col">Onderwerp</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {p.berichten.map((b) => (
              <tr>
                <td>{b.aangemaakt_op.replace("T", " ")}</td>
                <td>{SOORT_LABELS[b.soort] ?? b.soort}</td>
                <td>{b.ontvanger || "–"}</td>
                <td>
                  {b.inhoud_html ? <a href={`/beheer/berichten/${b.id}`}>{b.onderwerp}</a> : b.onderwerp}
                  {b.afspraak_id ? (
                    <>
                      {" "}
                      <a class="klein" href={`/beheer/afspraak/${b.afspraak_id}`}>
                        (afspraak)
                      </a>
                    </>
                  ) : null}
                </td>
                <td>
                  <span class={`bericht-status ${b.status}`}>{b.status}</span>
                  {b.fout ? <span class="klein"> {b.fout}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <p class="leeg">Nog geen berichten.</p>
    )}
  </BeheerPagina>
);

export const BerichtPagina: FC<Basis & { b: BerichtRij }> = (p) => (
  <BeheerPagina titel={p.b.onderwerp} actief="/beheer/berichten" config={p.config} demo={p.demo} melding={p.melding}>
    <p class="kruimel">
      <a href="/beheer/berichten">‹ Alle berichten</a>
    </p>
    <h1>{p.b.onderwerp}</h1>
    <p class="klein">
      Aan {p.b.ontvanger || "–"} · {p.b.aangemaakt_op.replace("T", " ")} · <span class={`bericht-status ${p.b.status}`}>{p.b.status}</span>
    </p>
    <iframe class="mail-voorbeeld" src={`/beheer/berichten/${p.b.id}/voorbeeld`} title={`Voorbeeld van e-mail: ${p.b.onderwerp}`} sandbox=""></iframe>
    {p.b.inhoud_tekst ? (
      <details>
        <summary>Tekstversie</summary>
        <pre class="mail-tekst">{p.b.inhoud_tekst}</pre>
      </details>
    ) : null}
  </BeheerPagina>
);

// ---------------------------------------------------------------------------
// Instellingen
// ---------------------------------------------------------------------------

export const InstellingenPagina: FC<Basis & { icalUrl: string; fouten: string[]; waarschuwingen: string[]; smtpTekst: string }> = (p) => {
  const c = p.config;
  return (
    <BeheerPagina titel="Instellingen" actief="/beheer/instellingen" config={c} demo={p.demo} melding={p.melding}>
      <h1>Instellingen</h1>
      <section class="kaart" aria-labelledby="ical-kop">
        <h2 id="ical-kop">Agenda koppelen (Google, Apple, Outlook)</h2>
        <p>Met deze geheime link verschijnen alle afspraken automatisch in je eigen agenda. Deel hem met niemand.</p>
        <div class="kopieer">
          <label for="ical-url" class="sr-only">
            Agenda-link
          </label>
          <input id="ical-url" type="text" readonly value={p.icalUrl} />
          <button type="button" class="knop-licht klein-knop" data-kopieer="#ical-url">
            Kopieer
          </button>
        </div>
        <details>
          <summary>Zo voeg je de agenda toe</summary>
          <ul>
            <li>
              <strong>Google Agenda</strong> (op een computer): Andere agenda's → “+” → Via URL → plak de link → Agenda toevoegen. Google ververst ongeveer elke paar uur.
            </li>
            <li>
              <strong>iPhone/iPad</strong>: Instellingen → Agenda → Accounts → Account toevoegen → Andere → Voeg agenda-abonnement toe → plak de link.
            </li>
            <li>
              <strong>Mac</strong>: Agenda → Archief → Nieuw agenda-abonnement → plak de link → kies “Elke 15 minuten” verversen.
            </li>
            <li>
              <strong>Outlook</strong>: Agenda → Agenda toevoegen → Abonneren via internet → plak de link.
            </li>
          </ul>
        </details>
      </section>

      <section class="kaart" aria-labelledby="mail-kop">
        <h2 id="mail-kop">E-mail</h2>
        <p>{p.smtpTekst}</p>
        <form method="post" action="/beheer/testmail">
          <button type="submit" class="knop-licht">
            Stuur een testmail naar {c.email.beheerderAdres}
          </button>
        </form>
      </section>

      {p.fouten.length || p.waarschuwingen.length ? (
        <section class="kaart" aria-labelledby="controle-kop">
          <h2 id="controle-kop">Controle van de configuratie</h2>
          {p.fouten.length ? (
            <div class="melding melding-fout">
              <ul>
                {p.fouten.map((f) => (
                  <li>{f}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {p.waarschuwingen.length ? (
            <ul>
              {p.waarschuwingen.map((w) => (
                <li>{w}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <section class="kaart" aria-labelledby="config-kop">
        <h2 id="config-kop">Huidige configuratie</h2>
        <p class="klein">Wijzigen doe je in het bestand klant.config.ts, waarna je opnieuw publiceert (zie README).</p>
        <dl class="gegevens">
          <div>
            <dt>Planning</dt>
            <dd>
              Starttijden om de {c.planning.tijdslotMinuten} min · {c.planning.bufferMinuten} min buffer · {c.planning.capaciteit} tegelijk · minimaal {c.planning.minimaalUrenVooraf} uur
              vooraf · tot {c.planning.maximaalDagenVooruit} dagen vooruit · {c.planning.automatischBevestigen ? "automatisch bevestigen" : "handmatig accepteren"}
            </dd>
          </div>
          <div>
            <dt>Berichten</dt>
            <dd>
              Herinnering {c.berichten.herinnering.aan ? `${c.berichten.herinnering.urenVooraf} uur vooraf` : "uit"} · Klaar-bericht {c.berichten.klaar.aan ? "aan" : "uit"} · Review{" "}
              {c.berichten.review.aan ? `${c.berichten.review.urenNaAfloop} uur na afloop, herinnering na ${c.berichten.review.herinneringNaDagen} dagen` : "uit"} · Onderhoud{" "}
              {c.berichten.onderhoud.aan ? "aan" : "uit"} · {c.berichten.seizoen.length} seizoensbericht(en)
            </dd>
          </div>
          <div>
            <dt>Privacy</dt>
            <dd>
              Foto's {c.privacy.fotosBewarenDagen} dagen bewaren · gegevens na {c.privacy.gegevensBewarenMaanden} maanden anonimiseren
            </dd>
          </div>
        </dl>
        <h3>Behandelingen</h3>
        <ul class="lijst compact" role="list">
          {c.behandelingen.map((b) => (
            <li>
              {b.naam} – {formatDuur(b.duurMinuten)}
              {b.vanafPrijs !== undefined ? ` – vanaf € ${b.vanafPrijs}` : ""}
              {b.onderhoudNaWeken ? ` – onderhoud na ${b.onderhoudNaWeken} weken` : ""}
              {b.actief === false ? " (niet online boekbaar)" : ""}
            </li>
          ))}
        </ul>
      </section>

      {p.demo ? (
        <section class="kaart" aria-labelledby="demo-kop">
          <h2 id="demo-kop">Demo</h2>
          <p>De demodata wordt elke nacht automatisch vernieuwd. Je kunt hem ook nu opnieuw laden.</p>
          <form method="post" action="/beheer/demo/opnieuw" data-bevestig="Alle demodata opnieuw laden?">
            <button type="submit" class="knop-licht">
              Demodata opnieuw laden
            </button>
          </form>
        </section>
      ) : null}

      <form method="post" action="/beheer/uitloggen">
        <button type="submit" class="knop-licht">
          Uitloggen
        </button>
      </form>
    </BeheerPagina>
  );
};
