module.exports = {
  forbidden: [
    {
      name: 'no-cross-tool-imports',
      severity: 'error',
      comment:
        'A tool must not import another tool. Shared code goes in packages/.',
      from: { path: '^tools/([^/]+)/' },
      to: { path: '^tools/([^/]+)/', pathNot: '^tools/$1/' },
    },
    {
      name: 'tools-use-public-packages-only',
      severity: 'error',
      comment: 'Tools import the public package entry points only.',
      from: { path: '^tools/' },
      to: { path: '^packages/(foundation|ui-kit)/src/(?!index\\.tsx?$).+' },
    },
  ],
  options: {
    exclude: { path: '(^|/)dist/' },
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: { exportsFields: ['exports'] },
  },
};
