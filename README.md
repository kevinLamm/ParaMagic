# ParaMagic

ParaMagic is a browser-based parametric drawing application. Its reusable editor,
document, geometry, image, export, and solver engine lives in the separate public
[`paramagic-core`](https://github.com/kevinLamm/paramagic-core) repository.

Clone the application with its pinned core version:

```sh
git clone --recurse-submodules https://github.com/kevinLamm/ParaMagic.git
cd ParaMagic
npm install
npm run dev
```

The local editor runs at `http://localhost:5173/`. Keep that command running
while editing either the frontend or `packages/paramagic-core`; the workspace
links `@paramagic/core` directly to that local package and Vite reloads local
changes. Do not open `index.html` directly or serve it with a raw static-file
server, because browser-native modules cannot resolve the `@paramagic/core`
package name without Vite.

The older `npm run dev:legacy` command is retained for existing shortcuts, but
it now starts the same Vite development server.

For an existing clone, initialize or refresh the core package with:

```sh
git submodule update --init --recursive
```

Other applications can install the tagged core package directly:

```sh
npm install github:kevinLamm/paramagic-core#v0.1.0
```
