module.exports = {
  forbidden: [
    { name: 'no-packages-to-apps', from: { path: '^packages' }, to: { path: '^(apps|services)' } },
    { name: 'no-services-to-apps', from: { path: '^services' }, to: { path: '^apps' } },
    { name: 'no-circular', from: {}, to: { circular: true } },
    {
      name: 'modules-only-via-types',
      from: { path: '^packages/api/modules/([^/]+)/', pathNot: '^packages/api/modules/$1/' },
      to: { path: '^packages/api/modules/([^/]+)/(service|repository)\\.ts$' },
      comment: 'Cross-module imports must go through types.ts, never service/repository directly.'
    }
  ],
  options: { doNotFollow: { path: 'node_modules' }, tsConfig: { fileName: 'tsconfig.base.json' } }
};
