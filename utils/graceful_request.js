"use strict";

/** 
* This pattern allow to gracefully process a lot
* of concurrent request toward a remote host
* using async.queue dispatcher
*/

var async        = require('async');
var detach       = require('nyks/function/detach');
var request      = require('nyks/http/request');

var request_json_cache = { "_delayed" : {} };


var request_json = function(remote_url, chain) {
  chain = detach(chain);

  if(request_json_cache[remote_url] === request_json_cache["_delayed"]) 
    return setTimeout(request_json, 200, remote_url, chain); //DELAYED

  if(request_json_cache[remote_url])
    return chain(null, request_json_cache[remote_url]);


  request_json_cache[remote_url] = request_json_cache["_delayed"];
  console.log("Reaching %s", remote_url);

  request(remote_url, function(err, body){
    delete request_json_cache[remote_url];
    if(err)
      return chain(err);

    request_json_cache[remote_url] = body;
    chain(null, body);
  });

};



module.exports = request_json
