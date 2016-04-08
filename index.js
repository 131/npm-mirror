"use strict";

var glob    = require('glob');
var util    = require('util');
var fs      = require('fs');
var path    = require('path');
var semver  = require('semver');
var async   = require('async');
var sprintf = util.format;


var unique       = require('mout/array/unique');
var map          = require('mout/object/map');
var trim         = require('mout/string/trim');
var filter       = require('mout/array/filter');
var partial      = require('mout/function/partial');
var forIn        = require('mout/object/forIn');

var mkdirpSync   = require('nyks/fs/mkdirpSync');
var sort         = require('nyks/object/sort');

var grequest     = require('./utils/graceful_request');
var download     = require('./utils/shasum_download');
var unary         = require('nyks/function/unary');




var options = require('nyks/process/parseArgs')().dict;


var registry_url = options.registry_url,
    remote_registry_url = trim(options.remote_registry_url || "https://registry.npmjs.org/", "/"),
    manifest_directory  = options.manifest_directory,
    package_directory  = options.package_directory;

if(!registry_url)
  throw ("Missing registry url")
if(!manifest_directory)
  throw ("Missing manifest_directory");
if(!package_directory)
  throw ("Missing package_directory");

package_directory = path.resolve(package_directory);



var dependencies;


var fetch_package_json = function(package_name, chain){
  var remote_url = sprintf("%s/%s", remote_registry_url, package_name);
  grequest(remote_url, chain);
}; //limit remote registry to a sane number of parallel queries, aka 'concurrentify'
fetch_package_json = async.queue(fetch_package_json, 5).push;



function stack_dependency(package_name, requested_version, chain) {

  if(!dependencies[package_name])
      dependencies[package_name] = []

  fetch_package_json(package_name, function(err, body){
    if(false && err)
      return chain(null, false);

    var full_versions_list = Object.keys(body.versions || {});

    var target_version = semver.maxSatisfying(full_versions_list, requested_version);
    if(target_version && dependencies[package_name].indexOf(target_version) == -1) {
      dependencies[package_name].push(target_version);
      return chain(null, true); //new dependecy to scan
    }

    chain(null, false);
  });
}


function stack_dependencies(newlist, chain){
  var new_packages = [];
  async.each(newlist, function(entry, chain){
    stack_dependency(entry.package_name, entry.version, function(err, changed){
      if(changed)
        new_packages.push(entry.package_name);
      chain();
    });
  }, function(err){
    chain(null, unique(new_packages));
  });
}


function inline_dependencies(){
  var out = [];
  [].slice.apply(arguments).forEach(function(d){
    if(!d) return;
    for(var package_name in d)
      out.push({package_name:package_name, version:d[package_name]});
  });
  return out;
}




var dead_ends = {};



/**
* download a list of packages & create manifest file
* Packages list is as simple as { package_name : [version1, version2] }
*/

var downloadPackages = function(chain) {
  var downloads = [];

  async.eachOfLimit(dependencies, 5, function(versions, package_name, chain) {

    var package_dir = sprintf("%s/%s", package_directory, package_name);

    mkdirpSync(package_dir);

    fetch_package_json(package_name, function(err, _package) {
      if(err)
        return chain(err);

      versions.forEach(function(version_key) {
        var version = _package.versions[version_key];

        var archive_dir = sprintf("%s/%s", package_dir, version_key);

        mkdirpSync(archive_dir);
        var file_name =   sprintf("%s-%s.tgz", package_name, version_key);

        var file_url = sprintf("%s/%s/%s/%s", registry_url, package_name, version_key, file_name);

        var file_path = sprintf("%s/%s", archive_dir, file_name);
        var json_path = sprintf("%s/%s", archive_dir, "index.json");

        var remote_url = version.dist.tarball;

        version.dist.tarball = file_url;

        fs.writeFileSync(json_path, JSON.stringify(version));
        downloads.push({url : remote_url, file_path : file_path, sha1:version.dist.shasum});
      });

      var json_path = sprintf("%s/%s", package_dir, "index.json");
      _package.versions = sort(_package.versions, versions);
      fs.writeFileSync(json_path, JSON.stringify(_package));

      chain();
    });

  }, function(){
    //all manifest are on disk, all folders are ready, just need to dl/check all of that now
    console.log("Now downloading %d file(s)", downloads.length);
    async.eachLimit(downloads, 5, download, chain);


  });

}


var q = async.queue(function(package_name, chain){

  fetch_package_json(package_name, function(err, body){

    var full_list = [];

    async.each(dependencies[package_name], function(version_key, chain){
      if(dead_ends[package_name + version_key])
        return chain();

      var version = body.versions[version_key];
      var foo = inline_dependencies(version.dependencies,  version.peerDependencies);
        
      stack_dependencies(foo, function(err, new_packages){
        if(!new_packages.length)
          dead_ends[package_name + version_key] = true;

          //dive into all new packages
        new_packages.forEach(function(package_name){ q.push(package_name); });
        chain();
      });
    }, chain);

  });

}, 5);




dependencies = {}
var full_list = [];

var manifests_list = glob.sync(sprintf("%s/*.json", manifest_directory));

manifests_list = manifests_list.map(function(v){ return path.resolve(v) });
manifests_list = manifests_list.map(require); //lol

manifests_list.map(function(v){
  var foo = inline_dependencies(v.dependencies, v.devDependencies, v.peerDependencies);
  full_list = full_list.concat(foo);
});



stack_dependencies(full_list, function(){
    //dependencies are now filled with initial (top level) nodes, use q to guide diving into async recursivity
  Object.keys(dependencies).forEach(unary(q.push));

  q.drain = partial(downloadPackages, function(){ 
      console.log("All done");
  });
    
});