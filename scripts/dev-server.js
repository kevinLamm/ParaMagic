import { createServer } from 'vite';

const configuredPort = Number(process.env.PORT);
const port = Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : 5173;
const server = await createServer({
  server: {
    host: '0.0.0.0',
    port,
    strictPort: true,
  },
});

await server.listen();
server.printUrls();
