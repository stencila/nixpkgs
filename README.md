## 📦 Nixster
### A package manager and distribution based on Nix

[![Build status](https://travis-ci.org/stencila/nixster.svg?branch=master)](https://travis-ci.org/stencila/nixster)
[![Code coverage](https://codecov.io/gh/stencila/nixster/branch/master/graph/badge.svg)](https://codecov.io/gh/stencila/nixster)
[![Greenkeeper badge](https://badges.greenkeeper.io/stencila/nixster.svg)](https://greenkeeper.io/)
[![NPM](http://img.shields.io/npm/v/@stencila/nixster.svg?style=flat)](https://www.npmjs.com/package/@stencila/nixster)
[![Docs](https://img.shields.io/badge/docs-latest-blue.svg)](https://stencila.github.io/nixster/)
[![Chat](https://badges.gitter.im/stencila/stencila.svg)](https://gitter.im/stencila/stencila)

[Nix](https://nixos.org/nix/) is a superbly well designed and powerful cross-platform package manager. But it's also got a very steep learning curve. Even for experienced programmers it can be daunting to use. Nixster is a thin, sugary wrapper around Nix to make it sweeter to use 🍭!

> :warning:
> In early development! Contributions welcome!
> :heart:

<!-- Automatically generated TOC. Don't edit, `make docs` instead>

<!-- toc -->

- [Install](#install)
  * [Node package](#node-package)
  * [Docker image](#docker-image)
- [Demo](#demo)

<!-- tocstop -->

## Install

### Node package

Currently you will need to install via this repo (not yet published to NPM and no binary yet available):

```bash
git clone git@github.com:stencila/nixster.git
cd nixster
npm install
```

You will also need to have [Nix installed](https://nixos.org/nix/download.html):

```bash
curl https://nixos.org/nix/install | sh
```

To test the CLI more conveniently you can add an alias to your shell e.g.

```bash
alias nixster='npx ts-node src/cli.ts'
```

Or, if you want to use the CLI outside of this directory:

```bash
alias nixster='/path/to/nixster/node_modules/.bin/ts-node --project /path/to/nixster/tsconfig.json /path/to/nixster/src/cli.ts'
```


### Docker image

Instead of installing Nix and Nixster you can use the `stencila/nixster` Docker image:

```bash
make docker docker-interact
```

## Demo

<a href="https://asciinema.org/a/KD0z367VL5mBNknueUpqzVGMP?size=medium&cols=120&autoplay=1" target="_blank"><img src="https://asciinema.org/a/KD0z367VL5mBNknueUpqzVGMP.svg" /></a>
