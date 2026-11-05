/**
 * iCalendar (RFC 5545) voor de agenda-feed van het bedrijf en de
 * "Zet in je agenda"-knop voor klanten. Tijden worden in UTC geschreven,
 * zodat Google, Apple en Outlook ze altijd goed tonen.
 */
import { type Moment, lokaalNaarUtc } from "./tijd";

export interface IcalEvent {
  uid: string;
  start: Moment;
  eind: Moment;
  titel: string;
  beschrijving?: string;
  locatie?: string;
  status?: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  url?: string;
  gewijzigd?: string;
}

/** Tekstwaarden ontsnappen volgens RFC 5545. */
export function icalTekst(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Regels langer dan 75 bytes vouwen (vervolgregels beginnen met een spatie). */
export function vouw(regel: string): string {
  const bytes = new TextEncoder().encode(regel);
  if (bytes.length <= 75) return regel;
  const delen: string[] = [];
  let huidig = "";
  let lengte = 0;
  for (const teken of regel) {
    const n = new TextEncoder().encode(teken).length;
    const max = delen.length === 0 ? 75 : 74;
    if (lengte + n > max) {
      delen.push(huidig);
      huidig = "";
      lengte = 0;
    }
    huidig += teken;
    lengte += n;
  }
  delen.push(huidig);
  return delen.join("\r\n ");
}

export function utcStempel(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function maakIcal(opties: { naam: string; tijdzone: string; events: IcalEvent[]; feed?: boolean }): string {
  const nu = utcStempel(new Date());
  const r: string[] = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Fluks Boeken//NL", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  if (opties.feed) {
    r.push(`X-WR-CALNAME:${icalTekst(opties.naam)}`, `X-WR-TIMEZONE:${opties.tijdzone}`, "REFRESH-INTERVAL;VALUE=DURATION:PT15M", "X-PUBLISHED-TTL:PT15M");
  }
  for (const e of opties.events) {
    r.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${nu}`,
      `DTSTART:${utcStempel(lokaalNaarUtc(e.start, opties.tijdzone))}`,
      `DTEND:${utcStempel(lokaalNaarUtc(e.eind, opties.tijdzone))}`,
      `SUMMARY:${icalTekst(e.titel)}`,
    );
    if (e.beschrijving) r.push(`DESCRIPTION:${icalTekst(e.beschrijving)}`);
    if (e.locatie) r.push(`LOCATION:${icalTekst(e.locatie)}`);
    if (e.url) r.push(`URL:${e.url}`);
    if (e.status) r.push(`STATUS:${e.status}`);
    if (e.gewijzigd) {
      const d = new Date(e.gewijzigd);
      if (!Number.isNaN(d.getTime())) r.push(`LAST-MODIFIED:${utcStempel(d)}`);
    }
    r.push("END:VEVENT");
  }
  r.push("END:VCALENDAR");
  return r.map(vouw).join("\r\n") + "\r\n";
}

/** Link om een afspraak direct in Google Agenda te zetten. */
export function googleAgendaLink(e: { titel: string; start: Moment; eind: Moment; tijdzone: string; locatie: string; beschrijving: string }): string {
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: e.titel,
    dates: `${utcStempel(lokaalNaarUtc(e.start, e.tijdzone))}/${utcStempel(lokaalNaarUtc(e.eind, e.tijdzone))}`,
    location: e.locatie,
    details: e.beschrijving,
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}
