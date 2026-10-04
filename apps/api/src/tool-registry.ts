const toolModules = await Promise.all([
  import('@internal-tools/refunds'),
  // <DEVIN-API-TOOL-REGISTRY>
]);

export const toolRegistry = toolModules.map((module) => module.tool);
export const toolRegistrations = toolModules.map(
  (module) => module.registration,
);
