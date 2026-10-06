// Source register for every engineering constant/method in the engine.
export interface SourceEntry { id: string; what: string; basis: string; status: 'DEFINITION' | 'DERIVED' | 'PUBLIC-FORMULA' | 'USER-SUPPLIED' | 'UNSOURCED'; verification: string }
export const SOURCES: Record<string, SourceEntry> = {
  CONDUCTION: { id: 'CONDUCTION', what: 'Q = U * A * dT (steady-state conduction)', basis: 'Basic heat transfer; identical in any heat-transfer text.', status: 'PUBLIC-FORMULA', verification: 'Analytic fixtures only. ACCA example comparison pending (source site blocked in build session).' },
  AIR_SENSIBLE: { id: 'AIR_SENSIBLE', what: '1.08 = 60 min/h * 0.075 lb/ft3 * 0.24 Btu/(lb*F)', basis: 'Standard-air density and specific heat (textbook psychrometrics). Computed in code from the three factors.', status: 'DERIVED', verification: 'Arithmetic verified in unit test; standard-air property values should be re-checked against ASHRAE Fundamentals by the owner/engineer.' },
  AIR_LATENT: { id: 'AIR_LATENT', what: 'Latent = 60 * 0.075 * hfg(1076 Btu/lb) * CFM * dW(lb/lb)', basis: 'Textbook psychrometrics, standard air; hfg approximate for water near room temperature.', status: 'DERIVED', verification: 'hfg=1076 is a rounded textbook value; confirm against ASHRAE Fundamentals. Not yet compared to ACCA example.' },
  INFILTRATION_ACH: { id: 'INFILTRATION_ACH', what: 'CFM = ACH * volume / 60', basis: 'Definition of air changes per hour. ACH values are USER-SUPPLIED; no defaults shipped.', status: 'USER-SUPPLIED', verification: 'n/a' },
  U_VALUES: { id: 'U_VALUES', what: 'Assembly U-factors', basis: 'No assembly table is shipped. Every U/R is entered by the user and tagged KNOWN/SELECTED/ESTIMATED.', status: 'UNSOURCED', verification: 'Owner to supply sourced starter library (see docs/OWNER_QUESTIONS.md).' },
  DESIGN_TEMPS: { id: 'DESIGN_TEMPS', what: 'Design temperatures / humidity ratios', basis: 'Entered per project with a free-text source. No national defaults shipped.', status: 'USER-SUPPLIED', verification: 'n/a' },
  SOLAR: { id: 'SOLAR', what: 'Window solar gain = area * SHGC * user factor', basis: 'Factors are user-supplied per orientation; none shipped (Manual J solar tables are copyrighted).', status: 'USER-SUPPLIED', verification: 'n/a' },
  COOLING_CLTD: { id: 'COOLING_CLTD', what: 'Opaque-surface solar/thermal-mass cooling effects (CLTD-type)', basis: 'NOT IMPLEMENTED: requires sourced tables. Cooling opaque loads use plain dT only.', status: 'UNSOURCED', verification: 'Cooling totals are labelled INCOMPLETE.' },
};
export const ENGINE_VERSION = '0.1.0-partial';
export const AIR_DENSITY_LB_FT3 = 0.075;
export const AIR_CP_BTU_LB_F = 0.24;
export const WATER_HFG_BTU_LB = 1076;
export const MIN_PER_HR = 60;
export const AIR_SENSIBLE_FACTOR = MIN_PER_HR * AIR_DENSITY_LB_FT3 * AIR_CP_BTU_LB_F; // 1.08
export const AIR_LATENT_FACTOR_PER_LB_LB = MIN_PER_HR * AIR_DENSITY_LB_FT3 * WATER_HFG_BTU_LB; // ~4842
