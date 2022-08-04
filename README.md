[![Build Status](https://github.com/131/npm-mirror/actions/workflows/test.yml/badge.svg?branch=master)](https://github.com/131/npm-mirror/actions/workflows/test.yml)
[![Coverage Status](https://coveralls.io/repos/github/131/npm-mirror/badge.svg?branch=master)](https://coveralls.io/github/131/npm-mirror?branch=master)
[![Version](https://img.shields.io/npm/v/npm-registry-mirror.svg)](https://www.npmjs.com/package/npm-registry-mirror)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](http://opensource.org/licenses/MIT)
[![Code style](https://img.shields.io/badge/code%2fstyle-ivs-green.svg)](https://www.npmjs.com/package/eslint-plugin-ivs)




# Motivation

npm-registry-mirror is a utility for mirroring a subset of npm packages from another npm registry. It syncs recursively all the required dependencies and writes them to the local filesystem so that a simple webserver can behave like a read-only registry.

This module was designed a a drop-in replacement for the no longer maintened "npm-mirror" module.




# Usage
```
npm install -g npm-registry-mirror

# Put some packages.json (e.g. rename & timestamp them) in /some/path/to/manifests/

npm-mirror \
--registry_url=http://myserver.com/npm/       \
--manifest_directory=/some/path/to/manifests/ \
--package_directory=/path/to/local/cache/     \

```

## Http server

```
export DEBUG=*,-send,-express:*
cnyks . [config_path] --ir://start

# force curl no buffer
curl -X POST http://127.0.0.1:8080/process
cat /mnt/r/package.json | curl -X PUT --data-binary @- http://127.0.0.1:8080/feed



```

# Tests & dependencies
npm-mirror relies on a very few but powerfull modules, with 100% coverage & test.
All good friend of mine.


# Credits
* [131](https://github.com/131)
* [mozilla-b2g/npm-mirror](https://github.com/mozilla-b2g/npm-mirror)


# Keywords / shout box
npm, npm-mirror, registry-mirror, registry, async, "Let's have a beer and talk in Paris"




