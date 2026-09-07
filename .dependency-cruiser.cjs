/**
 * Layering rules.
 *
 * Design rule #2 says adding a source must not require touching the core. That
 * is a claim about the dependency graph, so it is checked by the build rather
 * than trusted to reviewers.
 */
module.exports = {
  forbidden: [
    {
      name: 'core-is-source-agnostic',
      comment:
        'src/core must not import any enricher, resolver, pipeline or CLI code. ' +
        'A derivation that needs a source vocabulary belongs beside that source ' +
        'and is contributed back through derivationsFor().',
      severity: 'error',
      from: { path: '^src/core' },
      to: { path: '^src/(enrichers|resolver|pipeline|cache|cli|llm)' },
    },
    {
      name: 'sources-do-not-know-each-other',
      comment: 'One enricher must never import another. Enrichers are independent by design.',
      severity: 'error',
      from: { path: '^src/enrichers/([^/]+)/' },
      to: {
        path: '^src/enrichers/([^/]+)/',
        pathNot: [ '^src/enrichers/$1/' ],
      },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      from: { orphan: true, pathNot: ['\\.d\\.ts$'] },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
  },
};
