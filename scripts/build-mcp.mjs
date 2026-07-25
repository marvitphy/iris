import { build } from 'esbuild'

await build({
  entryPoints: ['src/mcp/server.ts'],
  outfile: 'dist-mcp/iris-mcp.mjs',
  platform: 'node',
  format: 'esm',
  target: 'node20',
  bundle: true,
  banner: { js: '#!/usr/bin/env node' },
})

console.log('built dist-mcp/iris-mcp.mjs')
