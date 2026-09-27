import { createServer } from 'vite';
import path from 'node:path';
const server = await createServer({
  configFile: false, root: process.cwd(), publicDir: 'src/assets',
  resolve: { alias: [{ find: /^@paramagic\/core\/(.+)$/, replacement: path.resolve('packages/paramagic-core/src').replaceAll('\\', '/') + '/$1.js' }] },
  server: { host: '127.0.0.1', port: 5174, strictPort: true, watch: null, fs: { allow: ['../../..'] } },
});
await server.listen();
server.printUrls();
