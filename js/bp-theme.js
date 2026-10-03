// js/bp-theme.js - Bible Peruser
// Applies a manually-picked accent theme via a `data-theme` attribute on
// <html>, consumed by the :root[data-theme="..."] blocks in css/style.css.
// Runs as a plain synchronous script (not a module, no defer/async) so the
// attribute is set before the browser even requests style.css — same
// before-first-paint guarantee js/app.js relies on for the bp-mobile class,
// just placed in <head> instead since this has no <body> dependency.
//
// `?theme=<name>` pins a specific theme and persists it to localStorage so
// it survives across sessions (not just the current tab) — `?theme=off` (or
// `blue`/`default`) clears the pin, which is also what a visitor gets with
// no pin at all: this app no longer auto-selects a theme by date (that
// date-conditional behavior was removed — it kept shipping an off-brand
// accent color, e.g. orange every autumn, to visitors who'd never touched
// the theme picker). `?theme=auto` is accepted as an alias for `off` so old
// links/bookmarks still land on the default blue instead of erroring.
(function () {
  var THEME_KEY = "bpTheme";
  var VALID_THEMES = [
    "teal",
    "spring",
    "summer",
    "autumn",
    "winter",
    "patriotic",
    "christmas",
    "good-friday",
    "easter",
  ];
  var OFF_VALUES = ["off", "blue", "default"];

  // Exposed so js/bp-theme-picker.js (loaded later, after <body>) can build
  // its swatch list from the same source of truth instead of duplicating it.
  window.BP_VALID_THEMES = VALID_THEMES;
  window.BP_THEME_KEY = THEME_KEY;

  var match = /[?&]theme=([a-z0-9-]+)/i.exec(location.search);
  if (match) {
    var requested = match[1].toLowerCase();
    if (requested === "auto") {
      localStorage.removeItem(THEME_KEY);
    } else if (OFF_VALUES.indexOf(requested) !== -1) {
      localStorage.setItem(THEME_KEY, "off");
    } else if (VALID_THEMES.indexOf(requested) !== -1) {
      localStorage.setItem(THEME_KEY, requested);
    }
  }

  var pinned = localStorage.getItem(THEME_KEY);
  if (pinned && pinned !== "off" && VALID_THEMES.indexOf(pinned) !== -1) {
    document.documentElement.dataset.theme = pinned;
  }
  // No pin, "off", or a stale/unrecognized value: leave data-theme unset so
  // the base blue :root applies. There is no date-based fallback.
})();
