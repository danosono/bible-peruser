// js/bp-theme-picker.js - Bible Peruser
// Small manual UI on top of js/bp-theme.js's existing seasonal accent-theme
// system: lets the user pin one of the named themes (or the default blue)
// via a swatch popover anchored to the header trigger button, writing the
// same `bpTheme` localStorage key and `data-theme` attribute bp-theme.js
// already reads/sets. No reload needed since themes are pure CSS variables.
(function () {
  var THEMES = [
    { key: "off", label: "Blue (Default)", color: "#5b7fd6" },
    { key: "teal", label: "Teal", color: "#2a6e5c" },
    { key: "spring", label: "Spring", color: "#4f9e6e" },
    { key: "summer", label: "Summer", color: "#e0a344" },
    { key: "autumn", label: "Autumn", color: "#c1652f" },
    { key: "winter", label: "Winter", color: "#6fb8d9" },
    { key: "patriotic", label: "Patriotic", color: "#3b5fc4" },
    { key: "christmas", label: "Christmas", color: "#2f7d4f" },
    { key: "good-friday", label: "Good Friday", color: "#7a1f1f" },
    { key: "easter", label: "Easter", color: "#d4af37" },
  ];
  var THEME_KEY = window.BP_THEME_KEY || "bpTheme";

  function init() {
    var trigger = document.getElementById("bp-theme-picker-btn");
    if (!trigger) return;
    var popover = null;

    function currentTheme() {
      return document.documentElement.dataset.theme || "off";
    }

    function applyTheme(key) {
      if (key === "off") {
        delete document.documentElement.dataset.theme;
      } else {
        document.documentElement.dataset.theme = key;
      }
      try {
        localStorage.setItem(THEME_KEY, key);
      } catch (e) {}
      updateActiveSwatch();
    }

    function updateActiveSwatch() {
      if (!popover) return;
      var active = currentTheme();
      popover
        .querySelectorAll(".bp-theme-picker-swatch")
        .forEach(function (sw) {
          sw.classList.toggle("active", sw.dataset.themeKey === active);
        });
    }

    function onOutsideClick(e) {
      if (popover && !popover.contains(e.target) && e.target !== trigger) {
        closePopover();
      }
    }
    function onKeydown(e) {
      if (e.key === "Escape") closePopover();
    }

    function closePopover() {
      if (!popover) return;
      document.removeEventListener("mousedown", onOutsideClick);
      document.removeEventListener("keydown", onKeydown);
      popover.remove();
      popover = null;
      trigger.setAttribute("aria-expanded", "false");
    }

    function positionPopover() {
      var rect = trigger.getBoundingClientRect();
      var pRect = popover.getBoundingClientRect();
      var left = rect.left;
      var top = rect.bottom + 6;
      var maxLeft = window.innerWidth - pRect.width - 8;
      if (left > maxLeft) left = Math.max(8, maxLeft);
      if (top + pRect.height > window.innerHeight - 8) {
        top = rect.top - pRect.height - 6;
      }
      popover.style.left = left + "px";
      popover.style.top = Math.max(8, top) + "px";
    }

    function openPopover() {
      if (popover) {
        closePopover();
        return;
      }
      popover = document.createElement("div");
      popover.className = "bp-theme-picker-popover";

      var title = document.createElement("div");
      title.className = "bp-theme-picker-popover__title";
      title.textContent = "Color theme";
      popover.appendChild(title);

      var grid = document.createElement("div");
      grid.className = "bp-theme-picker-popover__grid";
      THEMES.forEach(function (t) {
        var sw = document.createElement("button");
        sw.type = "button";
        sw.className = "bp-theme-picker-swatch";
        sw.style.background = t.color;
        sw.dataset.themeKey = t.key;
        sw.setAttribute("aria-label", t.label);
        sw.title = t.label;
        sw.addEventListener("click", function () {
          applyTheme(t.key);
        });
        grid.appendChild(sw);
      });
      popover.appendChild(grid);

      document.body.appendChild(popover);
      positionPopover();
      updateActiveSwatch();
      trigger.setAttribute("aria-expanded", "true");

      document.addEventListener("mousedown", onOutsideClick);
      document.addEventListener("keydown", onKeydown);
    }

    trigger.addEventListener("click", function (e) {
      e.stopPropagation();
      openPopover();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
