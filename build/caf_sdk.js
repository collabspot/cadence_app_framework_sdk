(function(){function require(e,t,n){t||(t=0);var r=require.resolve(e,t),i=require.m[t][r];if(!i)throw new Error('failed to require "'+e+'" from '+n);if(i.c){t=i.c,r=i.m,i=require.m[t][i.m];if(!i)throw new Error('failed to require "'+r+'" from '+t)}return i.exports||(i.exports={},i.call(i.exports,i,i.exports,require.relative(r,t))),i.exports}require.resolve=function(e,t){var n=e,r=e+".js",i=e+"/index.js";return require.m[t][r]&&r?r:require.m[t][i]&&i?i:n},require.relative=function(e,t){return function(n){if("."!=n.charAt(0))return require(n,t,e);var r=e.split("/"),i=n.split("/");r.pop();for(var s=0;s<i.length;s++){var o=i[s];".."==o?r.pop():"."!=o&&r.push(o)}return require(r.join("/"),t,e)}};
require.m = [];
require.m[0] = {
"version": { exports: "2.0.0" },
"index.js": function(module, exports, require){
var Client    = require('client'),
    Utils     = require('utils'),
    CAFClient = {};

/// ### CAFClient API
///
/// When you include the CAF SDK on your website, you get access to the `CAFClient` object.
///
/// #### CAFClient.init([callback(context)])
///
/// Returns a [`client`](#client-object) object.
///
/// ##### Arguments
///
///   * `callback(context)` (optional) a function called as soon as communication with
///     the container app is established. The callback receives a context object with
///     data related to the container app, including `currentAccount`, `currentUser`, and `location`
///
/// Example:
///
/// ```javascript
/// var client = CAFClient.init(function(context) {
///   var currentUser = context.currentUser;
///   console.log('Hi ' + currentUser.name);
/// });
/// ```
CAFClient.init = function(callback) {
  var params = Utils.queryParameters(),
      client;

  if (!params.origin || !params.app_guid) { return false; }

  client = new Client(params.origin, params.app_guid);

  if (typeof callback === 'function') {
    client.on('app.registered', callback.bind(client));
  }

  return client;
};

module.exports = CAFClient;
},
"utils.js": function(module, exports, require){
var Promise = window.Promise || require('../vendor/native-promise-only');

function decode(s) {
  return decodeURIComponent((s || '').replace( /\+/g, " " ));
}

function queryParameters(queryString) {
  var result = {},
      keyValuePairs,
      keyAndValue,
      key,
      value;

  queryString = queryString ||
    ( document.location.search || '' ).slice(1);

  if (queryString.length === 0) { return result; }

  keyValuePairs = queryString.split('&');

  for (var i = 0; i < keyValuePairs.length; i++) {
    keyAndValue = keyValuePairs[i].split('=');
    key   = decode(keyAndValue[0]);
    value = decode(keyAndValue[1]) || '';
    result[key] = value;
  }

  return result;
}

function isPromise(obj) {
  return obj instanceof Promise ||
    !!obj && obj.then && typeof obj.then === 'function';
}

function isFalsy(val) {
  return !val ||
    val instanceof Error ||
    typeof val === 'string';
}

// When receives a list of things to wrap as Promises.
// it will then wait for:
//  a) all to settle
//  b) first to reject
//  c) first to settle with a falsy value
// c) is sub-optimal, since it has a specific narrow use-case
// for save hooks
function when(items) {
  items = items || [];
  var resolveAll, rejectAll,
      allResolvedPromise = new Promise(function(resolve, reject) {
        resolveAll = resolve;
        rejectAll = reject;
      });

  var remaining = 0,
      settledWith = [],
      itemsCopy = Array.isArray(items) ?
        items.slice() :
        [items];

  var resolveWith = function(data, index) {
    settledWith[index] = data;

    if (--remaining <= 0) {
      resolveAll(settledWith);
    }
  };

  remaining = itemsCopy.length;

  if (remaining <= 0) {
    resolveAll();
    return allResolvedPromise;
  }

  itemsCopy.forEach(function(item, index) {
    var promise;
    if (isPromise(item)) {
      promise = item;
    } else if (typeof item === 'function') {
      var res;
      try {
        res = item();
        if (isPromise(res)) {
          promise = res;
        } else {
          promise = new Promise(function(resolve) {
            resolve(res);
          });
        }
      } catch(err) {
        promise = new Promise(function(resolve, reject) {
          reject(err);
        });
      }
    } else {
      promise = new Promise(function(resolve, reject) {
        isFalsy(item) ?
          reject(item) :
          resolve(item);
      });
    }
    promise.then(
      function(data) {
        resolveWith(data, index);
      }
    ).catch(rejectAll.bind(rejectAll));
  });

  return allResolvedPromise;
}

module.exports = {
  queryParameters: queryParameters,
  when: when
};
},
"client.js": function(module, exports, require){
var PROMISE_TIMEOUT = 5000, // 5 seconds
    CAF_EVENT       = /^caf\./,
    version         = require('version'),
    Promise         = window.Promise || require('../vendor/native-promise-only'),
    when            = require('utils').when,
    pendingPromises = {},
    ids             = {};

function nextIdFor(name) {
  if (isNaN(ids[name])) {
    ids[name] = 0;
  }
  return ++ids[name];
}

function rawPostMessage(client, msg, forceReady) {
  if (client.ready || forceReady) {
    client._source.postMessage(msg, client._origin);
  } else {
    client.on('app.registered', rawPostMessage.bind(null, client, msg));
  }
}

// params is an array for get, and an object for set/invoke
function wrappedPostMessage(name, params) {
  var id = nextIdFor('promise'),
      timeoutId;

  var promise = new Promise(function(resolve, reject) {
    // Time out the promise to ensure it will be garbage collected if nobody responds
    timeoutId = setTimeout(function() {
      reject(new Error('Invocation request timeout'));
    }, PROMISE_TIMEOUT);

    pendingPromises[id] = {resolve: resolve, reject: reject};

    var msg = JSON.stringify({ id: id, request: name, params: params, appGuid: this._appGuid });
    rawPostMessage(this, msg);
  }.bind(this));

  // ensure promise is cleaned up when resolved
  return promise.then(removePromise.bind(null, id, timeoutId), removePromise.bind(null, id, timeoutId));
}

function removePromise(id, timeoutId, args) {
  clearTimeout(timeoutId);
  delete pendingPromises[id];
  if (args instanceof Error) throw args;
  return args;
}

function isValidEvent(client, event) {
  return client && client._origin === event.origin && client._source === event.source;
}

function messageHandler(client, event) {
  if (!isValidEvent(client, event)) { return; }

  var data = event.data;

  if (!data) { return; }

  if (typeof data === 'string') {
    try {
      data = JSON.parse(event.data);
    } catch (e) {
      return e;
    }
  }

  var pendingPromise, key, msg;
  if (data.id && (pendingPromise = pendingPromises[data.id])) {
    if (data.error) {
      var err = data.error;
      if (err.code) {
        err = new Error(data.error.msg);
        err.name = data.error.code;
        err.stack = data.error.stack;
      }
      pendingPromise.reject(err);
    } else {
      pendingPromise.resolve(data.result);
    }
  } else if (CAF_EVENT.test(data.key)) {
    key = data.key.replace(CAF_EVENT, '');
    msg = { appGuid: client._appGuid };

    if (data.needsReply) {
      if (client._repliesPending[key]) { return; }
      msg.key = 'iframe.reply:' + key;
      client._repliesPending[key] = true;
      when(client._messageHandlers[key]).then(
        rawPostMessage.bind(null, client, msg)
      ).catch(function(reason) {
        msg.error = {
          msg: reason
        };
        rawPostMessage(client, msg);
      }).then(function() {
        delete client._repliesPending[key];
      });
    } else {
      client.trigger(key, data.message);
    }

    // if the container is invoking a function
  } else if (data.key && data.key.indexOf("invoke:") === 0) {
    key = data.key.split(".")[1];

    if(client._invokableFunctions[key]) {
      client._invokableFunctions[key].apply(undefined, data.params).then(function(res) {
        msg = JSON.stringify({key: data.key + ".done", result: res, appGuid: client._appGuid});
        rawPostMessage(client, msg);
      });
    }
  }
}

function ping() {
  return new Promise(function (resolve) {
    // This is only an example to create asynchronism
    window.setTimeout(function () {
      // We fulfill the promise !
      resolve("pong");
    }, 1000);
  });
}

var Client = function(origin, appGuid) {
  this._origin = origin;
  this._source = window.parent;
  this._appGuid = appGuid;
  this._messageHandlers = {};
  this._invokableFunctions = {};
  this._repliesPending = {};
  this._metadata = null;
  this._context = null;
  this.ready = false;

  this.on('app.registered', function(data) {
    this.ready = true;
    this._metadata = data.metadata;
    this._context = data.context;
  }, this);

  this.on('context.updated', function(context) {
    this._context = context;
  }, this);

  this.postMessage('iframe.handshake', { version: version });

  window.addEventListener('message', messageHandler.bind(null, this));

  this.registerFunction("ping", ping);
};

Client.prototype = {

  /// ### Client Object
  ///
  /// #### client.postMessage(name, [data])
  ///
  /// Allows you to send message events to the container app.
  ///
  /// ##### Arguments
  ///
  ///   * `name` the name of the message event. This determines the name of the iframe
  ///     event your app will receive. For example, if you set this to 'hello', your app will receive
  ///     the event 'iframe.hello'
  ///   * `data` (optional) a JSON object with any data that you want to pass along with the
  ///     event
  ///
  /// ```javascript
  /// var client = CAFClient.init();
  /// client.postMessage('hello', { awesome: true });
  /// ```
  postMessage: function(name, data) {
    var msg = JSON.stringify({ key: name, message: data, appGuid: this._appGuid });
    rawPostMessage(this, msg, name === 'iframe.handshake');
  },

  /// #### client.on(name, handler, [context])
  ///
  /// Allows you to add handlers to a framework event. You can add as many handler as you wish.
  /// They will be executed in the order they were added.
  ///
  /// ##### Arguments
  ///
  ///   * `name` the name of the framework event you want to listen to. This can be
  ///     [framework](./events.html#framework-events), [request](./events.html#request-events), or
  ///     [custom](./events.html#custom-events) events. Your iframe can listen to any events your app
  ///     receives, apart from DOM events. You don't need to register these events in the app first
  ///   * `handler` a function to be called when this event fires. You can expect to receive the same
  ///     event object your app would receive, parsed as JSON
  ///   * `context` (optional) the value of `this` within your handler
  ///
  /// ```javascript
  /// var client = CAFClient.init();
  /// client.on('app.registered', function(e) {
  ///   // go nuts
  /// });
  /// ```
  ///
  /// Note: As soon as communication with the container app is established, the SDK triggers an
  /// `app.registered` event. You can add as many handlers to `app.registered` as you like. They're
  /// called immediately after the `init` callback.
  on: function(name, handler, context) {
    if (typeof handler == 'function') {
      handler = context ?
        handler.bind(context) :
        handler;

      this._messageHandlers[name] = this._messageHandlers[name] || [];
      this._messageHandlers[name].push(handler);

      if (name !== 'app.registered') {
        this.postMessage('iframe.on:' + name);
      }
    }
  },

  /// #### client.off(name, handler)
  ///
  /// Allows you to remove a handler for a framework event.
  ///
  /// ##### Arguments
  ///
  ///   * `name` the name of the event
  ///   * `handler` the function you attached earlier with `on`
  ///
  /// ```javascript
  /// var client = CAFClient.init();
  ///
  /// client.on('app.registered', function appRegistered(e) {
  ///   // do stuff then remove the handler
  ///   client.off('app.registered', appRegistered);
  /// });
  /// ```
  off: function(name, handler) {
    if (!this._messageHandlers[name]) { return false; }
    var index = this._messageHandlers[name].indexOf(handler);
    this.postMessage('iframe.off:' + name);
    return this._messageHandlers[name].splice(index, 1)[0];
  },

  /// #### client.has(name, handler)
  ///
  /// Returns whether or not an event has the specified handler attached to it.
  ///
  /// ##### Arguments
  ///
  ///   * `name` the name of the event
  ///   * `handler` the handler you want to test
  ///
  /// ```javascript
  /// var client = CAFClient.init();
  ///
  /// client.on('app.registered', function appRegistered(e) {
  ///   // do stuff
  /// });
  ///
  /// client.has('app.registered', appRegistered); // true
  /// client.has('app.activated', appRegistered); // false
  /// ```
  has: function(name, handler) {
    if (!this._messageHandlers[name]) { return false; }
    return this._messageHandlers[name].indexOf(handler) !== -1;
  },

  /// #### client.trigger(name, [data])
  ///
  /// Triggers the specified event on the client.
  ///
  /// ##### Arguments
  ///
  ///   * `name` the name of the event you want to trigger
  ///   * `data` (optional) data you want to pass to the handler
  ///
  /// ```javascript
  /// var client = CAFClient.init();
  ///
  /// client.on('activation', function {
  ///   console.log('activating!')
  /// });
  ///
  /// client.trigger('activation') // activating!
  /// ```
  trigger: function(name, data) {
    if (!this._messageHandlers[name]) { return false; }
    return this._messageHandlers[name].map(function(handler) {
      handler(data);
    });
  },

  /// #### client.request(options)
  ///
  /// Dispatch [requests](./requests) via the container app.
  ///
  /// ##### Arguments
  ///
  ///   * `options` the url of the request or an options object containing a url key/value
  ///
  /// ##### Returns
  ///
  /// A [Promises/A+](https://promisesaplus.com) conformant `promise` object.
  ///
  /// ```javascript
  /// var client = CAFClient.init();
  ///
  /// client.request('/api/v2/tickets.json').then(
  ///   function(tickets) {
  ///     console.log(tickets);
  ///   },
  ///   function(response) {
  ///     console.error(response.responseText);
  ///   }
  /// );
  /// ```
  request: function(options) {
    var requestKey = 'request:' + nextIdFor('request');

    return new Promise(function(resolve, reject) {
      if (typeof options === 'string') {
        options = { url: options };
      }

      this.on(requestKey + '.done', function(evt) {
        resolve.apply(this, evt.responseArgs);
      });

      this.on(requestKey + '.fail', function(evt) {
        reject.apply(this, evt.responseArgs);
      });

      this.postMessage(requestKey, options);
    }.bind(this));
  },

  registerFunction: function(name, func) {
    this._invokableFunctions[name] = func;
  },

  metadata: function() {
    return new Promise(function(resolve) {
      if (this._metadata) {
        resolve(this._metadata);
      } else {
        this.on('app.registered', function() {
          resolve(this._metadata);
        }.bind(this));
      }
    }.bind(this));
  },

  context: function() {
    return new Promise(function(resolve) {
      if (this._context) {
        resolve(this._context);
      } else {
        this.on('app.registered', function() {
          resolve(this._context);
        }.bind(this));
      }
    }.bind(this));
  },

  // Accepts string or array of strings.
  get: function(path) {
    var paths = Array.isArray(path) ? path : [path];

    if (paths.some(function(s) {return typeof s !== 'string'; })) {
      throw new Error('The get method accepts a string or array of strings.');
    }

    return wrappedPostMessage.call(this, 'get', paths);
  },

  set: function(key, val) {
    var obj = key;

    if (typeof key === 'string') {
      if (arguments.length === 1) {
        throw new Error('The setter requires a value');
      }
      obj = {};
      obj[key] = val;
    }

    if (typeof obj !== 'object' || Array.isArray(obj)) {
      throw new Error('The set method accepts 2 string, or an object.');
    }

    return wrappedPostMessage.call(this, 'set', obj);
  },

  invoke: function(key) {
    var obj = key;

    if (typeof key === 'string') {
      obj = {};
      obj[key] = Array.prototype.slice.call(arguments, 1);
    } else {
      throw new Error('Invoke with an object isn\'t supported.');
    }

    return wrappedPostMessage.call(this, 'invoke', obj);
  }
};

module.exports = Client;
},
"vendor/native-promise-only.js": function(module, exports, require){
/*! Native Promise Only
    v0.8.0-a (c) Kyle Simpson
    MIT License: http://getify.mit-license.org
*/

(function UMD(name,context,definition){
	// special form of UMD for polyfilling across evironments
	context[name] = context[name] || definition();
	if (typeof module != "undefined" && module.exports) { module.exports = context[name]; }
	else if (typeof define == "function" && define.amd) { define(function $AMD$(){ return context[name]; }); }
})("Promise",typeof global != "undefined" ? global : this,function DEF(){
	/*jshint validthis:true */
	"use strict";

	var builtInProp, cycle, scheduling_queue,
		ToString = Object.prototype.toString,
		timer = (typeof setImmediate != "undefined") ?
			function timer(fn) { return setImmediate(fn); } :
			setTimeout
	;

	// dammit, IE8.
	try {
		Object.defineProperty({},"x",{});
		builtInProp = function builtInProp(obj,name,val,config) {
			return Object.defineProperty(obj,name,{
				value: val,
				writable: true,
				configurable: config !== false
			});
		};
	}
	catch (err) {
		builtInProp = function builtInProp(obj,name,val) {
			obj[name] = val;
			return obj;
		};
	}

	// Note: using a queue instead of array for efficiency
	scheduling_queue = (function Queue() {
		var first, last, item;

		function Item(fn,self) {
			this.fn = fn;
			this.self = self;
			this.next = void 0;
		}

		return {
			add: function add(fn,self) {
				item = new Item(fn,self);
				if (last) {
					last.next = item;
				}
				else {
					first = item;
				}
				last = item;
				item = void 0;
			},
			drain: function drain() {
				var f = first;
				first = last = cycle = void 0;

				while (f) {
					f.fn.call(f.self);
					f = f.next;
				}
			}
		};
	})();

	function schedule(fn,self) {
		scheduling_queue.add(fn,self);
		if (!cycle) {
			cycle = timer(scheduling_queue.drain);
		}
	}

	// promise duck typing
	function isThenable(o) {
		var _then, o_type = typeof o;

		if (o != null &&
			(
				o_type == "object" || o_type == "function"
			)
		) {
			_then = o.then;
		}
		return typeof _then == "function" ? _then : false;
	}

	function notify() {
		for (var i=0; i<this.chain.length; i++) {
			notifyIsolated(
				this,
				(this.state === 1) ? this.chain[i].success : this.chain[i].failure,
				this.chain[i]
			);
		}
		this.chain.length = 0;
	}

	// NOTE: This is a separate function to isolate
	// the `try..catch` so that other code can be
	// optimized better
	function notifyIsolated(self,cb,chain) {
		var ret, _then;
		try {
			if (cb === false) {
				chain.reject(self.msg);
			}
			else {
				if (cb === true) {
					ret = self.msg;
				}
				else {
					ret = cb.call(void 0,self.msg);
				}

				if (ret === chain.promise) {
					chain.reject(TypeError("Promise-chain cycle"));
				}
				else if (_then = isThenable(ret)) {
					_then.call(ret,chain.resolve,chain.reject);
				}
				else {
					chain.resolve(ret);
				}
			}
		}
		catch (err) {
			chain.reject(err);
		}
	}

	function resolve(msg) {
		var _then, self = this;

		// already triggered?
		if (self.triggered) { return; }

		self.triggered = true;

		// unwrap
		if (self.def) {
			self = self.def;
		}

		try {
			if (_then = isThenable(msg)) {
				schedule(function(){
					var def_wrapper = new MakeDefWrapper(self);
					try {
						_then.call(msg,
							function $resolve$(){ resolve.apply(def_wrapper,arguments); },
							function $reject$(){ reject.apply(def_wrapper,arguments); }
						);
					}
					catch (err) {
						reject.call(def_wrapper,err);
					}
				})
			}
			else {
				self.msg = msg;
				self.state = 1;
				if (self.chain.length > 0) {
					schedule(notify,self);
				}
			}
		}
		catch (err) {
			reject.call(new MakeDefWrapper(self),err);
		}
	}

	function reject(msg) {
		var self = this;

		// already triggered?
		if (self.triggered) { return; }

		self.triggered = true;

		// unwrap
		if (self.def) {
			self = self.def;
		}

		self.msg = msg;
		self.state = 2;
		if (self.chain.length > 0) {
			schedule(notify,self);
		}
	}

	function iteratePromises(Constructor,arr,resolver,rejecter) {
		for (var idx=0; idx<arr.length; idx++) {
			(function IIFE(idx){
				Constructor.resolve(arr[idx])
				.then(
					function $resolver$(msg){
						resolver(idx,msg);
					},
					rejecter
				);
			})(idx);
		}
	}

	function MakeDefWrapper(self) {
		this.def = self;
		this.triggered = false;
	}

	function MakeDef(self) {
		this.promise = self;
		this.state = 0;
		this.triggered = false;
		this.chain = [];
		this.msg = void 0;
	}

	function Promise(executor) {
		if (typeof executor != "function") {
			throw TypeError("Not a function");
		}

		if (this.__NPO__ !== 0) {
			throw TypeError("Not a promise");
		}

		// instance shadowing the inherited "brand"
		// to signal an already "initialized" promise
		this.__NPO__ = 1;

		var def = new MakeDef(this);

		this["then"] = function then(success,failure) {
			var o = {
				success: typeof success == "function" ? success : true,
				failure: typeof failure == "function" ? failure : false
			};
			// Note: `then(..)` itself can be borrowed to be used against
			// a different promise constructor for making the chained promise,
			// by substituting a different `this` binding.
			o.promise = new this.constructor(function extractChain(resolve,reject) {
				if (typeof resolve != "function" || typeof reject != "function") {
					throw TypeError("Not a function");
				}

				o.resolve = resolve;
				o.reject = reject;
			});
			def.chain.push(o);

			if (def.state !== 0) {
				schedule(notify,def);
			}

			return o.promise;
		};
		this["catch"] = function $catch$(failure) {
			return this.then(void 0,failure);
		};

		try {
			executor.call(
				void 0,
				function publicResolve(msg){
					resolve.call(def,msg);
				},
				function publicReject(msg) {
					reject.call(def,msg);
				}
			);
		}
		catch (err) {
			reject.call(def,err);
		}
	}

	var PromisePrototype = builtInProp({},"constructor",Promise,
		/*configurable=*/false
	);

	// Note: Android 4 cannot use `Object.defineProperty(..)` here
	Promise.prototype = PromisePrototype;

	// built-in "brand" to signal an "uninitialized" promise
	builtInProp(PromisePrototype,"__NPO__",0,
		/*configurable=*/false
	);

	builtInProp(Promise,"resolve",function Promise$resolve(msg) {
		var Constructor = this;

		// spec mandated checks
		// note: best "isPromise" check that's practical for now
		if (msg && typeof msg == "object" && msg.__NPO__ === 1) {
			return msg;
		}

		return new Constructor(function executor(resolve,reject){
			if (typeof resolve != "function" || typeof reject != "function") {
				throw TypeError("Not a function");
			}

			resolve(msg);
		});
	});

	builtInProp(Promise,"reject",function Promise$reject(msg) {
		return new this(function executor(resolve,reject){
			if (typeof resolve != "function" || typeof reject != "function") {
				throw TypeError("Not a function");
			}

			reject(msg);
		});
	});

	builtInProp(Promise,"all",function Promise$all(arr) {
		var Constructor = this;

		// spec mandated checks
		if (ToString.call(arr) != "[object Array]") {
			return Constructor.reject(TypeError("Not an array"));
		}
		if (arr.length === 0) {
			return Constructor.resolve([]);
		}

		return new Constructor(function executor(resolve,reject){
			if (typeof resolve != "function" || typeof reject != "function") {
				throw TypeError("Not a function");
			}

			var len = arr.length, msgs = Array(len), count = 0;

			iteratePromises(Constructor,arr,function resolver(idx,msg) {
				msgs[idx] = msg;
				if (++count === len) {
					resolve(msgs);
				}
			},reject);
		});
	});

	builtInProp(Promise,"race",function Promise$race(arr) {
		var Constructor = this;

		// spec mandated checks
		if (ToString.call(arr) != "[object Array]") {
			return Constructor.reject(TypeError("Not an array"));
		}

		return new Constructor(function executor(resolve,reject){
			if (typeof resolve != "function" || typeof reject != "function") {
				throw TypeError("Not a function");
			}

			iteratePromises(Constructor,arr,function resolver(idx,msg){
				resolve(msg);
			},reject);
		});
	});

	return Promise;
});
}
};
CAFClient = require('index.js');
}());