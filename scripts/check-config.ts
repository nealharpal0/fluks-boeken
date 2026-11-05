/**
 * Controleert klant.config.ts (en de demo-configuratie) op fouten.
 * Gebruik: npm run check-config
 */
import klantConfig from "../klant.config";
import demoConfig from "../src/config/demo.config";
import { valideerConfig } from "../src/config/valideer";

let fout = false;
for (const [naam, config] of [
  ["klant.config.ts", klantConfig],
  ["demo (Glans & Co)", demoConfig],
] as const) {
  const { fouten, waarschuwingen } = valideerConfig(config);
  console.log(`\n${naam} – ${config.bedrijf.naam}`);
  if (!fouten.length && !waarschuwingen.length) console.log("  ✔ Alles in orde.");
  for (const f of fouten) console.log(`  ✖ ${f}`);
  for (const w of waarschuwingen) console.log(`  ⚠ ${w}`);
  if (fouten.length) fout = true;
}
console.log(fout ? "\nLos de fouten (✖) op en probeer het opnieuw.\n" : "\nDe configuratie is geldig.\n");
process.exit(fout ? 1 : 0);
