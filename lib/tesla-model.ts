/** Shared Tesla model normalization for Fleet imports and media selection. */
export function canonicalTeslaModel(raw: string): string {
  const model = raw.trim().toLowerCase().replace(/[_-]+/g, " ");
  const compact = model.replace(/[^a-z0-9]/g, "");
  if (/^(cybertruck|cybertruck\d+)$/.test(compact)) return "Cybertruck";
  if (/^model3\d*$/.test(compact)) return "Model 3";
  if (/^modely\d*$/.test(compact)) return "Model Y";
  // Fleet API has historically returned generation-suffixed car_type values
  // such as models2 and modelx2.
  if (/^models\d*$/.test(compact)) return "Model S";
  if (/^modelx\d*$/.test(compact)) return "Model X";
  if (compact.includes("roadster")) return "Roadster";
  if (compact.includes("semi")) return "Semi";
  return raw.trim() || "Tesla";
}
