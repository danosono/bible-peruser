// Reader profile page (profile.html): a public "top contributors"
// leaderboard (no sign-in required) plus a signed-in user's own suggestion
// stats by status.
import { getSession, getClient, signOut, mapSupabaseError } from "./bp-supabase.js";
import { renderSignInGate } from "./bp-auth-ui.js";

const STATUSES = ["pending", "approved", "applied", "rejected", "unmatched"];
const STATUS_LABELS = {
  pending: "Pending",
  approved: "Approved",
  applied: "Applied",
  rejected: "Rejected",
  unmatched: "Unmatched",
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function main() {
  const root = document.getElementById("bp-profile-root");
  root.innerHTML = "";
  root.appendChild(el("h1", "bp-profile-title", "Profile"));

  const leaderboardSection = el("section", "bp-profile-section");
  root.appendChild(leaderboardSection);
  renderLeaderboard(leaderboardSection);

  const statsSection = el("section", "bp-profile-section");
  root.appendChild(statsSection);
  renderMyStats(statsSection);
}

async function renderLeaderboard(section) {
  section.innerHTML = "";
  section.appendChild(el("h2", "bp-profile-section__title", "Top Contributors"));
  section.appendChild(el("div", "bp-profile-msg", "Loading…"));
  try {
    const client = await getClient();
    const { data, error } = await client.rpc("bp_top_contributors", { limit_n: 20 });
    if (error) throw error;
    section.innerHTML = "";
    section.appendChild(el("h2", "bp-profile-section__title", "Top Contributors"));
    if (!data.length) {
      section.appendChild(
        el("p", "bp-suggest-help", "No approved suggestions yet — be the first!"),
      );
      return;
    }
    const list = el("div", "bp-profile-leaderboard");
    data.forEach((row, i) => {
      const rowEl = el("div", "bp-profile-leaderboard-row");
      rowEl.appendChild(el("span", "bp-profile-leaderboard-row__rank", `${i + 1}.`));
      rowEl.appendChild(el("span", "bp-profile-leaderboard-row__name", row.display_name));
      rowEl.appendChild(
        el("span", "bp-profile-leaderboard-row__count", String(row.approved_count)),
      );
      list.appendChild(rowEl);
    });
    section.appendChild(list);
  } catch (err) {
    section.innerHTML = "";
    section.appendChild(el("h2", "bp-profile-section__title", "Top Contributors"));
    section.appendChild(
      el("div", "bp-profile-msg bp-profile-msg--error", mapSupabaseError(err)),
    );
  }
}

async function renderMyStats(section) {
  section.innerHTML = "";
  section.appendChild(el("h2", "bp-profile-section__title", "My Suggestions"));

  let session;
  try {
    session = await getSession();
  } catch (err) {
    section.appendChild(
      el("div", "bp-profile-msg bp-profile-msg--error", mapSupabaseError(err)),
    );
    return;
  }

  if (!session) {
    const gateRoot = el("div");
    section.appendChild(gateRoot);
    renderSignInGate(gateRoot, {
      helpText: "Sign in to see your suggestion stats.",
      onSignedIn: () => renderMyStats(section),
    });
    return;
  }

  section.appendChild(el("div", "bp-profile-msg", "Loading…"));
  try {
    const client = await getClient();
    const { data, error } = await client
      .from("bp_suggestions")
      .select("status")
      .eq("user_id", session.user.id);
    if (error) throw error;

    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    data.forEach((row) => {
      if (counts[row.status] !== undefined) counts[row.status]++;
    });

    section.innerHTML = "";
    section.appendChild(el("h2", "bp-profile-section__title", "My Suggestions"));

    const accountLine = el(
      "div",
      "bp-suggest-account-line",
      `Signed in as ${session.user.email}`,
    );
    const signOutBtn = el("button", "bp-suggest-link-btn", "Sign out");
    signOutBtn.type = "button";
    signOutBtn.addEventListener("click", async () => {
      await signOut();
      renderMyStats(section);
    });
    accountLine.appendChild(document.createTextNode(" · "));
    accountLine.appendChild(signOutBtn);
    section.appendChild(accountLine);

    const grid = el("div", "bp-profile-stats-grid");
    STATUSES.forEach((s) => {
      const tile = el("div", "bp-profile-stat-tile");
      tile.appendChild(el("div", "bp-profile-stat-tile__count", String(counts[s])));
      tile.appendChild(el("div", "bp-profile-stat-tile__label", STATUS_LABELS[s]));
      grid.appendChild(tile);
    });
    section.appendChild(grid);
  } catch (err) {
    section.innerHTML = "";
    section.appendChild(el("h2", "bp-profile-section__title", "My Suggestions"));
    section.appendChild(
      el("div", "bp-profile-msg bp-profile-msg--error", mapSupabaseError(err)),
    );
  }
}

main();
