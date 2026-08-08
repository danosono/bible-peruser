// js/bp-theme.js - Bible Peruser
// Picks a seasonal/holiday accent theme and applies it via a `data-theme`
// attribute on <html>, consumed by the :root[data-theme="..."] blocks in
// css/style.css. Runs as a plain synchronous script (not a module, no
// defer/async) so the attribute is set before the browser even requests
// style.css — same before-first-paint guarantee js/app.js relies on for the
// bp-mobile class, just placed in <head> instead since this has no <body>
// dependency.
//
// `?theme=<name>` pins a specific theme and persists it to localStorage so
// it survives across sessions (not just the current tab) — `?theme=off` (or
// `blue`/`default`) is the actual "turn off seasonal changes" switch,
// sticking with the default blue theme until `?theme=auto` clears the pin
// and resumes date-based selection.
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
  if (pinned) {
    if (pinned !== "off" && VALID_THEMES.indexOf(pinned) !== -1) {
      document.documentElement.dataset.theme = pinned;
    }
    // "off" (or a stale/unrecognized value): leave data-theme unset so the
    // base blue :root applies. Seasonal/holiday logic below never runs.
    return;
  }

  var today = new Date();
  var year = today.getFullYear();

  function sameDay(a, b) {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  // Anonymous Gregorian / Meeus-Jones-Butcher Easter algorithm.
  function easterSunday(y) {
    var a = y % 19;
    var b = Math.floor(y / 100);
    var c = y % 100;
    var d = Math.floor(b / 4);
    var e = b % 4;
    var f = Math.floor((b + 8) / 25);
    var g = Math.floor((b - f + 1) / 3);
    var h = (19 * a + b - d - g + 15) % 30;
    var i = Math.floor(c / 4);
    var k = c % 4;
    var l = (32 + 2 * e + 2 * i - h - k) % 7;
    var m = Math.floor((a + 11 * h + 22 * l) / 451);
    var month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
    var day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, month - 1, day);
  }

  function lastMondayOfMay(y) {
    var d = new Date(y, 4, 31);
    var diff = (d.getDay() + 6) % 7; // days back to the most recent Monday
    d.setDate(d.getDate() - diff);
    return d;
  }

  var easter = easterSunday(year);
  var goodFriday = new Date(easter);
  goodFriday.setDate(goodFriday.getDate() - 2);
  var memorialDay = lastMondayOfMay(year);
  var independenceDay = new Date(year, 6, 4);
  var isChristmasWindow =
    today.getMonth() === 11 && today.getDate() >= 24 && today.getDate() <= 26;

  var theme;
  if (sameDay(today, goodFriday)) {
    theme = "good-friday";
  } else if (sameDay(today, easter)) {
    theme = "easter";
  } else if (isChristmasWindow) {
    theme = "christmas";
  } else if (sameDay(today, independenceDay) || sameDay(today, memorialDay)) {
    theme = "patriotic";
  } else {
    var month = today.getMonth(); // 0 = Jan
    if (month === 11 || month === 0 || month === 1) theme = "winter";
    else if (month >= 2 && month <= 4) theme = "spring";
    else if (month >= 5 && month <= 7) theme = "summer";
    else theme = "autumn";
  }

  document.documentElement.dataset.theme = theme;
})();
