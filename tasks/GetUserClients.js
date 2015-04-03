return function(context, cb) {
  const samlAddons = ['samlp', 'salesforce_api', 'salesforce_sandbox_api', 'salesforce', 'box', 'concur']
  const wsFedAddons = ['wsfed', 'sharepoint'];

  var getAuthProtocol = (app) => {
    if (app.addons) {
      for (var addon in app.addons) {
        if (samlAddons.indexOf(addon) > -1) {
          return 'samlp';
        } else if (wsFedAddons.indexOf(addon) > -1) {
          return 'ws-fed';
        }
      }
    }

    return 'openid-connect';
  };

  var cleanApp = (app) => {
    var authProtocol = getAuthProtocol(app);
    switch (authProtocol) {
      case 'samlp':
        app.login_url = util.format(
          'https://%s/samlp/%s?connection=%s',
          process.env.AUTH0_DOMAIN,
          app.client_id,
          process.env.AUTH0_CONNECTION);
        break;
      case 'ws-fed':
        var callback = '';
        if (app.callbacks && app.callbacks.length > 1) {
          callback = app.callbacks[1];
        }
        app.login_url = util.format(
          'https://%s/wsfed/%s?whr=%s&wreply=%s',
          process.env.AUTH0_DOMAIN,
          app.client_id,
          process.env.AUTH0_CONNECTION,
          callback);
        break;
      case 'openid-connect':
        var callback = '';
        if (app.callbacks && app.callbacks.length > 0) {
          callback = app.callbacks[0];
        }
        app.login_url = util.format(
          'https://%s/authorize?response_type=code&scope=openid&client_id=%s&redirect_uri=%s&connection=%s',
          process.env.AUTH0_DOMAIN,
          app.client_id,
          callback, // Select the first callback url, this isn't really ideal though
          process.env.AUTH0_CONNECTION)
        break;
      default:
        throw 'unknown auth protocol';
    }
    delete app.addons;
    delete app.callbacks

    app.logo_url = '/img/logos/auth0.png';
    return settingsService.getClients()
    .then(clients => {
      var clientData = _.find(clients, { 'client_id': app.client_id });
      if (clientData) {
        if (clientData.logo_url) {
          app.logo_url = clientData.logo_url;
        }
      }
      return app;
    });
  }


  var getUserRoles = (user_id) => {
    console.log(user_id)
    return new Promise((resolve, reject) => {
      request({
        url: 'https://' + process.env.AUTH0_DOMAIN + '/api/v2/users/' + user_id, // + '?fields=groups,app_metadata',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + process.env.AUTH0_API_TOKEN
        }
      }, function(error, response, body) {
        if (error || response.statusCode !== 200) {
          console.error('HTTP Status: ' + response.statusCode);
          if (error) {
            console.error(error);
            reject(error);
          }
          reject('Invalid HTTP request. Status code: ' + response.statusCode);
        }
        settingsService.getRoles().then(roles => {
          var user = JSON.parse(body);
          var user_roles = [];
          if (user.groups && user.groups.length > 0) {
            user.groups.map(function(group) {
              var role = _.find(roles, function(role) {
                return role.name.toLowerCase() === group.toLowerCase();
              });
              if (role) {
                user_roles.push(role.id);
              }
            });
          } else if (user.app_metadata && user.app_metadata.roles && user.app_metadata.roles.length > 0) {
            user.app_metadata.roles.map(function(role_id) {
              user_roles.push(role_id)
            });
          }
          resolve(user_roles);
        });
      });

    });
  };

  var requestApps = () => {
    return new Promise((resolve, reject) => {
      request({
        url: 'https://' + process.env.AUTH0_DOMAIN + '/api/v2/clients?fields=name,client_id,addons,global,callbacks',
        headers: {
          'Authorization': 'Bearer ' + process.env.AUTH0_API_TOKEN
        }
      }, function(error, response, body) {
        if (error || response.statusCode !== 200) {
          if (error) {
            console.error(error);
            reject(error);
          }
          reject('Invalid HTTP request. Status code: ' + response.statusCode);
        }
        var apps = JSON.parse(body);
        resolve(apps);
      });
    });
  }

  var getApps = (securityTrim) => {
    securityTrim = securityTrim || function(apps) { return Promise.resolve(apps); }

    return this._requestApps()
    .then(apps => {
      var p = [];
      for (var i = 0; i < apps.length; i++) {
        var app = apps[i];
        // Filter out this app and the global 'all applications' app
        if (process.env.AUTH0_CLIENT_ID !== app.client_id && app.global === false) {
          // App is allowed, now check permissions
          p.push(this._cleanApp(app));
        }
      }
      return Promise.all(p);
    })
    .then(securityTrim)
    .then(apps => {
      return apps;
    });
  };

  Promise.resolve(user_id)
  .then(this.getUserRoles)
  .then(user_role_ids => {
    return settingsService.getRoles()
    .then(roles => {
      var perms = {
        all_allowed: false,
        apps: []
      };
      user_role_ids.map(function(id) {
        var role = _.find(roles, { id: id });
        if (role) {
          perms.all_apps = perms.all_apps || role.all_apps;
          perms.apps = _.union(perms.apps, role.apps);
        }
      });
      return perms;
    }).then(perms => {
      var securityTrim = function(apps) {
        if (perms.all_apps) {
          return Promise.resolve(apps);
        } else {
          var allowed_apps = [];
          apps.map(function(app) {
            if (perms.apps.indexOf(app.client_id) > -1) {
              allowed_apps.push(app);
            }
          })
          return Promise.resolve(allowed_apps);
        }
      }
      return this._getApps(securityTrim);
    });
  });

}