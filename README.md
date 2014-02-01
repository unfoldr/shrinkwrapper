# shrinkwrapper

> A utility for saving shrinkwrapped npm packages away and installing them
> later.

Shrinkwrapper calls `npm shrinkwrap` then downloads the required package
tarballs for safe keeping.  At deployment time shrinkwrapper calls `npm
install` to install your dependencies using local package tarballs rather than
the npm registry.

It makes deployments fast (no need to download tarballs) and reliable (deploy
even if npm is down), without changing the way you use `npm` at other times or
requiring the use of a private npm registry/proxy.

Shrinkwrapper operates by temporarily adjusting the 'resolved' references in
your `npm-shrinkwrap.json` file to refer to local package tarballs (which are
automatically served from a local HTTP server) at deployment time.

## Installation

```
$ npm install -g shrinkwrapper
```

## Usage

To lock down your dependencies (i.e. `npm shrinkwrap`) and download the
packages to a local package store, run:

```
$ shrinkwrapper
```

To install your dependencies from the local package store at deployment time,
run:

```
$ shrinkwrapper install
```

### Store Location

Packages are saved to (and installed from) a `packages` directory in the root of
your project by default.  This can be changed using the `--store` flag, or by
adding a __shrinkwrapper__ object to your `package.json` as follows:

```json
{
    "name": "...",
    "shrinkwrapper": {
        "store": "../my-packages"
    }
}
```

## Author

[Andrew Appleyard](https://github.com/unfoldr)

## Licence

MIT