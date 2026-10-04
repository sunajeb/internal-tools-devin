const webToolModules = await Promise.all([
  import('@internal-tools/refunds/web'),
  import('@internal-tools/feature-flags/web'),
  // <DEVIN-WEB-TOOL-REGISTRY>
]);

export const webToolRegistry = webToolModules.map((module) => module.tool);
