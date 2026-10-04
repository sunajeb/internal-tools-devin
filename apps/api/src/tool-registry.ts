const toolModules = await Promise.all([
  import('@internal-tools/refunds'),
  import('@internal-tools/feature-flags'),
  // <DEVIN-API-TOOL-REGISTRY>
]);

export const toolRegistry = toolModules.map((module) => module.tool);
export const toolRegistrations = toolModules.map(
  (module) => module.registration,
);
