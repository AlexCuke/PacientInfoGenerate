(function (root) {
  'use strict';

  const origins = Object.freeze({
    'M99 DEV': 'https://reg.dev.m99.dzm',
    'M99 TEST': 'http://reg.test.m99.dzm'
  });

  function originFor(environment = 'M99 DEV') {
    if (!Object.hasOwn(origins, environment)) throw new Error('Неизвестный контур регистрации.');
    return origins[environment];
  }

  function isSamotek(url, origin) {
    const page = new URL(url || 'about:blank');
    return page.origin === origin && /^\/samotek(?:\/|$)/.test(page.pathname);
  }

  const api = {origins, originFor, isSamotek};
  if (typeof module !== 'undefined') module.exports = api;
  root.BrowserEnvironments = api;
})(globalThis);
