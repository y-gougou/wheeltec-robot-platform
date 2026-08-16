(function () {
  'use strict';

  var root = window.WheelTecModules = window.WheelTecModules || {};

  function apiPost(apiUrl, path, payload, callback) {
    var url = apiUrl(path);
    if (!url) { callback('Not connected', null); return; }
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
      signal: AbortSignal.timeout(10000),
    })
      .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
      .then(function (res) {
        if (!res.ok || (res.data && res.data.error)) throw new Error((res.data && res.data.error) || 'HTTP error');
        callback(null, res.data);
      })
      .catch(function (err) { callback(err.message, null); });
  }

  root.Collection = {
    apiPost: apiPost,
  };
})();
