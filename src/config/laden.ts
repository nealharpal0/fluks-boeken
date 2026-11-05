import klantConfig from "../../klant.config";
import type { Bindings } from "../types";
import demoConfig from "./demo.config";
import type { KlantConfig } from "./schema";
import { type ConfigControle, valideerConfig } from "./valideer";

export function isDemo(env: Pick<Bindings, "MODUS">): boolean {
  return env.MODUS === "demo";
}

/** De configuratie voor deze omgeving (demo of klant), met standaardwaarden ingevuld. */
export function laadConfig(env: Pick<Bindings, "MODUS" | "BASIS_URL">): KlantConfig {
  const basis = isDemo(env) ? demoConfig : klantConfig;
  return {
    ...basis,
    tijdzone: basis.tijdzone ?? "Europe/Amsterdam",
    basisUrl: (env.BASIS_URL || basis.basisUrl).replace(/\/+$/, ""),
  };
}

const controleCache = new WeakMap<KlantConfig, ConfigControle>();
export function controleerConfig(config: KlantConfig): ConfigControle {
  let c = controleCache.get(config);
  if (!c) {
    c = valideerConfig(config);
    controleCache.set(config, c);
  }
  return c;
}
