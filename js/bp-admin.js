// Owner review page for reader-submitted suggestions (admin.html).
import { bookOrder, bookNames } from "./bible-utils.js";
import {
  getSession,
  signOut,
  isAdmin,
  getClient,
  mapSupabaseError,
} from "./bp-supabase.js";
import { renderSignInGate as renderAuthGate } from "./bp-auth-ui.js";
import { findEntryIndex, snapshotIsFresh, resolveArray } from "./bp-match.mjs";

const STATUSES = ["pending", "approved", "unmatched", "applied", "rejected"];
let currentStatus = "pending";
const fileCache = new Map(); // filename -> parsed JSON

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function getTopicFilename(bookId) {
  const idx = bookOrder.indexOf(bookId);
  if (idx === -1) return null;
  const num = (idx + 1).toString().padStart(3, "0");
  return `data/topics/${num}_${bookId}_BSB.json`;
}

function getBookWideFilename(bookId) {
  const idx = bookOrder.indexOf(bookId);
  if (idx === -1) return null;
  const num = (idx + 1).toString().padStart(3, "0");
  return `data/bookwide/${num}_${bookId}_BSB.json`;
}

async function loadFile(filename) {
  if (!filename) return null;
  if (fileCache.has(filename)) return fileCache.get(filename);
  try {
    const res = await fetch(filename);
    const doc = res.ok ? await res.json() : null;
    fileCache.set(filename, doc);
    return doc;
  } catch {
    fileCache.set(filename, null);
    return null;
  }
}

function fileForRow(row) {
  return row.scope === "bookwide"
    ? getBookWideFilename(row.book_id)
    : getTopicFilename(row.book_id);
}

async function main() {
  const root = document.getElementById("bp-admin-root");
  root.innerHTML = "";
  root.appendChild(el("div", "bp-admin-msg", "Loading…"));

  let session;
  try {
    session = await getSession();
  } catch (err) {
    root.innerHTML = "";
    root.appendChild(el("div", "bp-admin-msg bp-admin-msg--error", mapSupabaseError(err)));
    return;
  }

  if (!session) {
    renderSignIn(root);
    return;
  }

  const admin = await isAdmin();
  if (!admin) {
    root.innerHTML = "";
    root.appendChild(
      el(
        "p",
        "bp-admin-msg",
        `This page is for the site owner. You're signed in as ${session.user.email}.`,
      ),
    );
    const out = el("button", "bp-suggest-link-btn", "Sign out");
    out.type = "button";
    out.addEventListener("click", async () => {
      await signOut();
      main();
    });
    root.appendChild(out);
    return;
  }

  renderAdmin(root, session);
}

function renderSignIn(root) {
  root.innerHTML = "";
  const gateRoot = el("div");
  root.appendChild(gateRoot);
  renderAuthGate(gateRoot, {
    helpText: "Sign in to review suggestions.",
    onSignedIn: () => main(),
  });
}

async function renderAdmin(root, session) {
  root.innerHTML = "";
  const client = await getClient();

  const header = el("div", "bp-admin-header");
  header.appendChild(el("h1", "bp-admin-title", "Suggestions"));
  const accountLine = el("div", "bp-suggest-account-line", `${session.user.email} · `);
  const signOutBtn = el("button", "bp-suggest-link-btn", "Sign out");
  signOutBtn.type = "button";
  signOutBtn.addEventListener("click", async () => {
    await signOut();
    main();
  });
  accountLine.appendChild(signOutBtn);
  header.appendChild(accountLine);

  const killSwitchBtn = el("button", "bp-admin-kill-switch", "…");
  killSwitchBtn.type = "button";
  header.appendChild(killSwitchBtn);
  root.appendChild(header);

  const banner = el("div", "bp-admin-banner");
  banner.style.display = "none";
  root.appendChild(banner);

  async function refreshKillSwitch() {
    const { data } = await client.rpc("bp_suggestions_enabled");
    const enabled = data !== false;
    killSwitchBtn.textContent = enabled ? "⏸ Pause suggestions" : "▶ Resume suggestions";
    killSwitchBtn.classList.toggle("bp-admin-kill-switch--paused", !enabled);
    killSwitchBtn.onclick = async () => {
      killSwitchBtn.disabled = true;
      try {
        await client.rpc("bp_set_suggestions_enabled", { enabled: !enabled });
        await refreshKillSwitch();
      } finally {
        killSwitchBtn.disabled = false;
      }
    };
  }
  await refreshKillSwitch();

  async function refreshBanner() {
    const { count } = await client
      .from("bp_suggestions")
      .select("*", { count: "exact", head: true })
      .eq("status", "approved");
    if (count) {
      banner.style.display = "";
      banner.textContent = `${count} approved suggestion${count === 1 ? "" : "s"} waiting to be written to the JSON files. Run: node scripts/apply-approved-suggestions.js`;
    } else {
      banner.style.display = "none";
    }
  }
  await refreshBanner();

  const tabs = el("div", "bp-admin-tabs");
  const tabButtons = {};
  async function refreshCounts() {
    await Promise.all(
      STATUSES.map(async (s) => {
        const { count } = await client
          .from("bp_suggestions")
          .select("*", { count: "exact", head: true })
          .eq("status", s);
        tabButtons[s].textContent = `${s} (${count || 0})`;
      }),
    );
  }
  STATUSES.forEach((s) => {
    const btn = el("button", "bp-admin-tab", `${s} (…)`);
    btn.type = "button";
    if (s === currentStatus) btn.classList.add("active");
    btn.addEventListener("click", () => {
      currentStatus = s;
      Object.values(tabButtons).forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      loadList(list, client, refreshAll);
    });
    tabButtons[s] = btn;
    tabs.appendChild(btn);
  });
  root.appendChild(tabs);
  await refreshCounts();

  async function refreshAll() {
    await Promise.all([refreshBanner(), refreshCounts()]);
  }

  const list = el("div", "bp-admin-list");
  root.appendChild(list);
  loadList(list, client, refreshAll);
}

async function loadList(list, client, refreshAll) {
  list.innerHTML = "";
  list.appendChild(el("div", "bp-admin-msg", "Loading…"));
  const { data, error } = await client
    .from("bp_suggestions")
    .select("*")
    .eq("status", currentStatus)
    .order("created_at", { ascending: currentStatus === "pending" })
    .limit(200);
  list.innerHTML = "";
  if (error) {
    list.appendChild(el("div", "bp-admin-msg bp-admin-msg--error", mapSupabaseError(error)));
    return;
  }
  if (!data.length) {
    list.appendChild(el("div", "bp-admin-msg", "Nothing here."));
    return;
  }
  for (const row of data) {
    list.appendChild(await buildRowCard(row, client, list, refreshAll));
  }
}

async function buildRowCard(row, client, list, refreshAll) {
  const card = el("div", "bp-admin-card");

  const where =
    row.scope === "bookwide"
      ? `${bookNames[row.book_id] || row.book_id} · book-wide`
      : `${bookNames[row.book_id] || row.book_id} ${row.chapter}`;
  const topLine = el("div", "bp-admin-card__top");
  topLine.appendChild(el("span", "bp-admin-badge", row.action === "add" ? "New" : "Correction"));
  topLine.appendChild(el("span", "bp-admin-badge", row.entry_kind));
  topLine.appendChild(el("span", null, ` ${where}`));
  card.appendChild(topLine);

  card.appendChild(
    el("div", "bp-suggest-help", `${row.user_email || "unknown"} · ${new Date(row.created_at).toLocaleString()}`),
  );

  const diffTable = el("table", "bp-admin-diff");
  const doc = await loadFile(fileForRow(row));
  const liveArray = doc ? resolveArray(doc, row) : undefined;
  let match = { index: null, reason: "not-found" };
  let liveEntry = null;
  if (row.action === "correct" && Array.isArray(liveArray)) {
    match = findEntryIndex(liveArray, row.target);
    liveEntry = match.index !== null ? liveArray[match.index] : null;
  }

  if (row.action === "correct" && !liveEntry) {
    card.appendChild(
      el(
        "div",
        "bp-admin-warning",
        match.reason === "ambiguous"
          ? "Ambiguous — more than one entry shares this name."
          : "Entry not found on disk (may have been renamed or removed).",
      ),
    );
  } else if (row.action === "correct") {
    const staleKeys = Object.keys(row.proposed).filter(
      (k) => !snapshotIsFresh(liveEntry, row.target.snapshot, [k]),
    );
    if (staleKeys.length) {
      card.appendChild(
        el(
          "div",
          "bp-admin-warning",
          `Stale — these fields changed on disk since this was submitted: ${staleKeys.join(", ")}.`,
        ),
      );
    }
  }

  const proposedEdits = {};
  const headRow = document.createElement("tr");
  ["Field", "Current", "Proposed (editable)"].forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    headRow.appendChild(th);
  });
  diffTable.appendChild(headRow);

  Object.entries(row.proposed).forEach(([key, value]) => {
    const tr = document.createElement("tr");
    const keyCell = document.createElement("td");
    keyCell.textContent = key;
    const currentCell = document.createElement("td");
    const currentVal = liveEntry ? liveEntry[key] : row.action === "add" ? undefined : undefined;
    currentCell.textContent = formatCellValue(currentVal);
    const proposedCell = document.createElement("td");
    const textarea = document.createElement("textarea");
    textarea.className = "bp-admin-edit-field";
    textarea.value = formatCellValue(value, true);
    proposedEdits[key] = textarea;
    proposedCell.appendChild(textarea);
    tr.appendChild(keyCell);
    tr.appendChild(currentCell);
    tr.appendChild(proposedCell);
    diffTable.appendChild(tr);
  });
  card.appendChild(diffTable);

  if (row.rationale) {
    card.appendChild(el("div", "bp-suggest-help", `Why: ${row.rationale}`));
  }

  const actions = el("div", "bp-admin-actions");
  card.appendChild(actions);
  const msg = el("div", "bp-admin-msg");
  card.appendChild(msg);

  if (row.status === "pending") {
    const approveBtn = el("button", "bp-suggest-submit", "Approve");
    approveBtn.type = "button";
    approveBtn.addEventListener("click", async () => {
      const edited = {};
      let parseError = null;
      Object.entries(proposedEdits).forEach(([key, textarea]) => {
        try {
          edited[key] = parseCellValue(textarea.value);
        } catch {
          parseError = key;
        }
      });
      if (parseError) {
        msg.className = "bp-admin-msg bp-admin-msg--error";
        msg.textContent = `Couldn't parse the "${parseError}" field — leave it as plain text or a comma-separated list.`;
        return;
      }
      approveBtn.disabled = true;
      const { error } = await client
        .from("bp_suggestions")
        .update({
          proposed: edited,
          status: "approved",
          reviewed_at: new Date().toISOString(),
          reviewed_by: (await getSession()).user.id,
        })
        .eq("id", row.id);
      if (error) {
        msg.className = "bp-admin-msg bp-admin-msg--error";
        msg.textContent = mapSupabaseError(error);
        approveBtn.disabled = false;
        return;
      }
      card.remove();
      refreshAll();
    });
    actions.appendChild(approveBtn);

    const rejectBtn = el("button", "bp-admin-btn", "Reject");
    rejectBtn.type = "button";
    rejectBtn.addEventListener("click", async () => {
      const reason = window.prompt("Reason for rejecting (shown to the submitter):");
      if (!reason) return;
      const { error } = await client
        .from("bp_suggestions")
        .update({
          status: "rejected",
          review_note: reason,
          reviewed_at: new Date().toISOString(),
          reviewed_by: (await getSession()).user.id,
        })
        .eq("id", row.id);
      if (error) {
        msg.className = "bp-admin-msg bp-admin-msg--error";
        msg.textContent = mapSupabaseError(error);
        return;
      }
      card.remove();
      refreshAll();
    });
    actions.appendChild(rejectBtn);

    const banBtn = el("button", "bp-admin-btn bp-admin-btn--danger", "Ban submitter");
    banBtn.type = "button";
    banBtn.addEventListener("click", async () => {
      const reason = window.prompt(`Ban ${row.user_email || row.user_id}? Reason (optional):`);
      if (reason === null) return;
      const { error } = await client.rpc("bp_ban_user", {
        target_user_id: row.user_id,
        ban_reason: reason || null,
      });
      msg.className = error ? "bp-admin-msg bp-admin-msg--error" : "bp-admin-msg bp-suggest-msg--ok";
      msg.textContent = error ? mapSupabaseError(error) : "User banned.";
    });
    actions.appendChild(banBtn);
  } else if (row.status === "applied" || row.status === "unmatched") {
    const requeueBtn = el("button", "bp-admin-btn", "Re-queue");
    requeueBtn.type = "button";
    requeueBtn.addEventListener("click", async () => {
      const { error } = await client
        .from("bp_suggestions")
        .update({ status: "approved", applied_at: null })
        .eq("id", row.id);
      if (error) {
        msg.className = "bp-admin-msg bp-admin-msg--error";
        msg.textContent = mapSupabaseError(error);
        return;
      }
      card.remove();
      refreshAll();
    });
    actions.appendChild(requeueBtn);
  }

  return card;
}

function formatCellValue(value, forEdit = false) {
  if (value === undefined) return forEdit ? "" : "— (no value)";
  if (Array.isArray(value)) return value.join(forEdit ? "\n" : "\n");
  if (value === null) return "(cleared)";
  return String(value);
}

function parseCellValue(text) {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (lines.length > 1) return lines.map((l) => l.trim());
  return text.trim();
}

main();
