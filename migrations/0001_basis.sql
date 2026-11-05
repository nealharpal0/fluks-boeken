-- Fluks Boeken – basisschema
-- Alle tijden van afspraken/blokkades zijn lokale tijd van het bedrijf: 'JJJJ-MM-DDTUU:MM'.

CREATE TABLE afspraken (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,                 -- geheim, voor links naar de klant
  behandeling_id TEXT NOT NULL,
  behandeling_naam TEXT NOT NULL,             -- momentopname, config kan later wijzigen
  start TEXT NOT NULL,
  eind TEXT NOT NULL,
  bezet_tot TEXT NOT NULL,                    -- eind + buffer
  status TEXT NOT NULL CHECK (status IN (
    'aangevraagd', 'bevestigd', 'afgerond', 'geweigerd', 'geannuleerd', 'verlopen', 'niet_verschenen'
  )),
  naam TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  telefoon TEXT NOT NULL DEFAULT '',
  opmerking TEXT NOT NULL DEFAULT '',
  extra_velden TEXT NOT NULL DEFAULT '{}',    -- JSON
  toestemming_herinnering INTEGER NOT NULL DEFAULT 0,
  toestemming_review INTEGER NOT NULL DEFAULT 0,
  toestemming_onderhoud INTEGER NOT NULL DEFAULT 0,
  toestemming_op TEXT,                        -- UTC, bewijs van toestemming
  interne_notitie TEXT NOT NULL DEFAULT '',
  reden TEXT NOT NULL DEFAULT '',             -- reden weigering/annulering (zichtbaar voor klant)
  bron TEXT NOT NULL DEFAULT 'online',        -- online | beheer | demo
  bevestigd_op TEXT,
  klaar_op TEXT,
  review_geklikt_op TEXT,
  geanonimiseerd INTEGER NOT NULL DEFAULT 0,
  aangemaakt_op TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  gewijzigd_op TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_afspraken_status_start ON afspraken (status, start);
CREATE INDEX idx_afspraken_start ON afspraken (start);
CREATE INDEX idx_afspraken_email ON afspraken (email);
CREATE INDEX idx_afspraken_anoniem_start ON afspraken (geanonimiseerd, start);

CREATE TABLE blokkades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start TEXT NOT NULL,
  eind TEXT NOT NULL,
  reden TEXT NOT NULL DEFAULT '',
  aangemaakt_op TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (eind > start)
);
CREATE INDEX idx_blokkades_start ON blokkades (start, eind);

CREATE TABLE fotos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  afspraak_id INTEGER NOT NULL REFERENCES afspraken (id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  grootte INTEGER NOT NULL,
  data BLOB NOT NULL,
  aangemaakt_op TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_fotos_afspraak ON fotos (afspraak_id);

-- Wachtrij én logboek van e-mails. `sleutel` is uniek en voorkomt dat
-- hetzelfde bericht twee keer verstuurd wordt (bijv. bij overlappende cron-runs).
CREATE TABLE berichten (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sleutel TEXT NOT NULL UNIQUE,
  soort TEXT NOT NULL,
  afspraak_id INTEGER REFERENCES afspraken (id) ON DELETE SET NULL,
  ontvanger TEXT NOT NULL,
  onderwerp TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('bezig', 'verzonden', 'mislukt', 'gelogd')),
  pogingen INTEGER NOT NULL DEFAULT 0,
  fout TEXT NOT NULL DEFAULT '',
  inhoud_html TEXT,                           -- alleen bewaard zolang nodig (of in demo-modus)
  inhoud_tekst TEXT,
  aangemaakt_op TEXT NOT NULL,                -- lokale tijd
  verzonden_op TEXT                           -- lokale tijd
);
CREATE INDEX idx_berichten_afspraak ON berichten (afspraak_id);
CREATE INDEX idx_berichten_soort_ontvanger ON berichten (soort, ontvanger);
CREATE INDEX idx_berichten_status ON berichten (status);
CREATE INDEX idx_berichten_soort_verzonden ON berichten (soort, verzonden_op);

-- Klanten die zich hebben afgemeld voor herinneringen, reviewverzoeken en onderhoudsberichten.
CREATE TABLE afmeldingen (
  email TEXT PRIMARY KEY,
  afgemeld_op TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Eenvoudige rate limiting (inlogpogingen, aanvragen per IP).
CREATE TABLE limieten (
  soort TEXT NOT NULL,
  sleutel TEXT NOT NULL,
  tijd INTEGER NOT NULL                       -- epoch-milliseconden
);
CREATE INDEX idx_limieten ON limieten (soort, sleutel, tijd);

-- Losse instellingen/status (bijv. wanneer de demo voor het laatst ververst is).
CREATE TABLE instellingen (
  sleutel TEXT PRIMARY KEY,
  waarde TEXT NOT NULL
);
