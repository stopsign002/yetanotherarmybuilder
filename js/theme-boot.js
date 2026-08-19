// js/theme-boot.js — pre-paint theme loader. THE ONLY SYNCHRONOUS SCRIPT.
//
// Every other script on this page is `defer`, which is right for all of them
// and wrong for this one: a theme applied at DOMContentLoaded is a theme the
// user watches get applied. This file is a parser-blocking <script> placed in
// <head> AFTER the last stylesheet link, so the theme stylesheet it appends
// lands last in the cascade and is render-blocking like the rest — the page
// paints once, already themed.
//
// ZERO-IMPACT CONTRACT. The default theme ('grimdark') has no stylesheet and
// no root attribute. On a default install this file reads one localStorage key
// and returns, having touched nothing — no extra CSS bytes, no attribute, no
// change to any existing rule. Every non-default theme is purely additive
// overrides loaded on top. That is deliberate: the default look is the product,
// and a theme must not be able to regress it.
//
// The registry lives here (rather than in js/app/themes.js) because this is the
// file that runs first; themes.js reads window.YAAB_THEMES so there is one list.
(function () {
  'use strict';

  // id            — the localStorage value + the [data-yaab-theme] attribute.
  // css           — stylesheet to load, or null for the untouched default.
  // themeColor    — <meta name="theme-color">, i.e. the mobile browser chrome.
  // accentMode    — how js/app/themes.js retints the faction color for this
  //                 theme's ground (see remapAccent there). null = leave the
  //                 App.FACTION_COLORS palette exactly as it is.
  var THEMES = [
    {
      id: 'grimdark',
      name: 'Grimdark',
      blurb: 'The original. Dark panels, pale faction accents, soft shadows.',
      css: null,
      themeColor: '#0d0d0d',
      accentMode: null,
      swatch: ['#18181b', '#22222a', '#a8bde6'],
    },
    {
      id: 'brutalist',
      name: 'Neo-Brutalist',
      blurb: 'Stark white, 2px black ink, hard offset shadows in your faction colour.',
      css: 'css/themes/brutalist.css',
      themeColor: '#ffffff',
      accentMode: 'light',
      swatch: ['#ffffff', '#0a0a0a', '#5977c9'],
    },
    {
      id: 'brutalist-dark',
      name: 'Neo-Brutalist Dark',
      blurb: 'Inverted brutalism — near-black ground, white ink and white shadows.',
      css: 'css/themes/brutalist.css',
      themeColor: '#131217',
      accentMode: 'dark',
      swatch: ['#131217', '#f2f0ea', '#9db6ee'],
    },
  ];

  var DEFAULT_ID = 'grimdark';
  var STORAGE_KEY = 'yaab_theme';
  var LINK_ID = 'yaab-theme-css';

  function byId(id) {
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return THEMES[i];
    return null;
  }

  // The ?v= cache-buster. scripts/stamp-assets.mjs only rewrites URLs that are
  // literally in index.html, and the theme stylesheet never is — so borrow the
  // stamp off css/style.css, which is always present and always stamped. That
  // keeps the theme file on the same cache generation as everything else
  // without the stamper needing to learn about runtime-injected links.
  function stamp() {
    try {
      var links = document.getElementsByTagName('link');
      for (var i = 0; i < links.length; i++) {
        var href = links[i].getAttribute('href') || '';
        if (href.indexOf('css/style.css') !== 0) continue;
        var q = href.indexOf('?');
        return q > -1 ? href.slice(q) : '';
      }
    } catch (_) {}
    return '';
  }

  // Apply a theme to the document. Called once from here at parse time and
  // again from js/app/themes.js on every later switch, so there is exactly one
  // implementation of "what applying a theme means".
  //
  // Swapping is genuinely reversible: non-default themes are override-only
  // stylesheets, so removing the <link> restores the default look completely
  // and no reload is ever needed.
  function apply(id) {
    var theme = byId(id) || byId(DEFAULT_ID);
    var root = document.documentElement;

    if (theme.id === DEFAULT_ID) root.removeAttribute('data-yaab-theme');
    else root.setAttribute('data-yaab-theme', theme.id);

    var link = document.getElementById(LINK_ID);
    if (!theme.css) {
      if (link && link.parentNode) link.parentNode.removeChild(link);
    } else {
      var href = theme.css + stamp();
      if (!link) {
        link = document.createElement('link');
        link.id = LINK_ID;
        link.rel = 'stylesheet';
        link.href = href;
        (document.head || root).appendChild(link);
      } else if (link.getAttribute('href') !== href) {
        link.setAttribute('href', href);
      }
    }

    try {
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta && theme.themeColor) meta.setAttribute('content', theme.themeColor);
    } catch (_) {}

    return theme;
  }

  function stored() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      return (v && byId(v)) ? v : DEFAULT_ID;
    } catch (_) { return DEFAULT_ID; }
  }

  window.YAAB_THEMES = {
    list: THEMES,
    byId: byId,
    apply: apply,
    stored: stored,
    DEFAULT_ID: DEFAULT_ID,
    STORAGE_KEY: STORAGE_KEY,
  };

  var id = stored();
  // The default path stops here: no attribute set, no link appended, nothing
  // in the cascade changed. Keep it that way.
  if (id !== DEFAULT_ID) apply(id);
})();
