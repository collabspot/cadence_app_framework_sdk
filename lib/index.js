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
