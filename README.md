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

For an existing clone, initialize or refresh the core package with:

```sh
git submodule update --init --recursive
```

Other applications can install the tagged core package directly:

```sh
npm install github:kevinLamm/paramagic-core#v0.1.0
```
