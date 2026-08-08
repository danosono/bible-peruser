// Persistent floating account-status icon (bottom-right of the main
// reading page). Shows signed-in/out state at a glance and is the only
// account entry point on mobile, where the header's Profile link is
// hidden. Built purely in JS and appended to document.body, matching the
// hand-rolled convention used by every other overlay/toast in this app
// (see js/app.js's bpMaybeShowDesktopTip for the same pattern).
import { getSession, getClient, signOut, isAdmin } from "./bp-supabase.js";
import { renderSignInGate } from "./bp-auth-ui.js";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

let initialized = false;

export function initAccountWidget() {
  if (initialized) return;
  initialized = true;

  const root = el("div", "bp-account-widget");

  const btn = el("button", "bp-account-widget__btn");
  btn.type = "button";
  btn.setAttribute("aria-label", "Account");
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">' +
    '<circle cx="12" cy="8" r="4"></circle>' +
    '<path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7"></path>' +
    "</svg>" +
    '<span class="bp-account-widget__badge"></span>';
  root.appendChild(btn);

  const popover = el("div", "bp-account-widget__popover");
  root.appendChild(popover);

  document.body.appendChild(root);

  let session = null;
  let open = false;
  let renderToken = 0;

  function closePopover() {
    open = false;
    popover.classList.remove("bp-account-widget__popover--open");
  }

  function renderPopoverContent() {
    const token = ++renderToken;
    popover.innerHTML = "";
    if (!session) {
      const gateRoot = el("div");
      popover.appendChild(gateRoot);
      renderSignInGate(gateRoot, {
        onSignedIn: () => closePopover(),
      });
      return;
    }
    popover.appendChild(el("div", "bp-account-widget__email", session.user.email));
    const profileLink = document.createElement("a");
    profileLink.href = "profile.html";
    profileLink.target = "_blank";
    profileLink.rel = "noopener";
    profileLink.className = "bp-account-widget__link";
    profileLink.textContent = "My profile";
    popover.appendChild(profileLink);

    isAdmin()
      .then((admin) => {
        // Popover may have closed or re-rendered by the time this RPC
        // resolves — only insert if it's still the render we started from.
        if (!admin || !open || token !== renderToken) return;
        const adminLink = document.createElement("a");
        adminLink.href = "admin.html";
        adminLink.target = "_blank";
        adminLink.rel = "noopener";
        adminLink.className = "bp-account-widget__link";
        adminLink.textContent = "Admin page";
        popover.insertBefore(adminLink, popover.lastElementChild);
      })
      .catch(() => {});

    const signOutBtn = el("button", "bp-account-widget__link", "Sign out");
    signOutBtn.type = "button";
    signOutBtn.addEventListener("click", async () => {
      await signOut();
      closePopover();
    });
    popover.appendChild(signOutBtn);
  }

  function openPopover() {
    open = true;
    popover.classList.add("bp-account-widget__popover--open");
    renderPopoverContent();
  }

  function render() {
    btn.classList.toggle("bp-account-widget__btn--signed-in", !!session);
    if (open) renderPopoverContent();
  }

  btn.addEventListener("click", () => {
    if (open) closePopover();
    else openPopover();
  });
  document.addEventListener("mousedown", (e) => {
    if (open && !root.contains(e.target)) closePopover();
  });
  document.addEventListener("keydown", (e) => {
    if (open && e.key === "Escape") closePopover();
  });

  getSession()
    .then((s) => {
      session = s;
      render();
    })
    .catch(() => {});

  getClient().then((client) => {
    client.auth.onAuthStateChange((_event, s) => {
      session = s;
      render();
    });
  });
}
