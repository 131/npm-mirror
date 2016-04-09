# Motivation

npm-registry-mirror is a utility for mirroring a subset of npm packages from another npm registry. It syncs all of the dependencies for a particular node module and writes them to the local filesystem so that a simple webserver can behave like a read-only compliant package registry.

This module was designed a a drop-in replacement for the no longer maintened "npm-mirror" module.


# Usage
```
npm install -g npm-mirror

# Put some packages.json (e.g. rename & timestamp them) in /some/path/to/manifests/

npm-mirror \
--registry_url=http://myserver.com/npm/       \
--manifest_directory=/some/path/to/manifests/ \
--package_directory=/path/to/local/cache/     \

```

# Notable Caveats
* Your webserver must be configured to map directory request to /index.json files

# Tests & dependencies
npm-mirror relies on a very few but powerfull modules, with 100% coverage & test.
All good friend of mine.


# Credits
* [131](https://github.com/131)
* [mozilla-b2g/npm-mirror](https://github.com/mozilla-b2g/npm-mirror)


# Keywords / shout box
npm, npm-mirror, registry-mirror, registry, async, "Let's have a beer and talk in Paris"




