// Reader-facing "suggest a label/highlight" modal + sidebar entry points.
// Imported by js/bible-loader.js. Built with the same hand-rolled DOM /
// overlay recipe as openInfoListModal/openCompareModal there (see that
// file) so it matches the rest of the app's popups.
import {
  getSession,
  signOut,
  isBanned,
  suggestionsEnabled,
  mapSupabaseError,
  getClient,
} from "./bp-supabase.js";
import { renderSignInGate as renderAuthGate } from "./bp-auth-ui.js";

const DRAFT_KEY = "bpSuggestDraft";
const COOLDOWN_MS = 15000;
let lastSubmitAt = 0;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function parseLines(text) {
  return String(text || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseVerses(text) {
  return String(text || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function arraysEqual(a, b) {
  const x = Array.isArray(a) ? a : [];
  const y = Array.isArray(b) ? b : [];
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

function noteToField(note) {
  if (Array.isArray(note)) return note.join("\n\n");
  return typeof note === "string" ? note : "";
}

function fieldToNote(text) {
  const parts = String(text || "")
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return undefined;
  return parts.length === 1 ? parts[0] : parts;
}

// -------------------- sidebar "+ Suggest new ..." links --------------------

export function buildSuggestNewLink(entryKind, ctx) {
  const link = el(
    "button",
    "bp-suggest-new-link",
    entryKind === "label" ? "+ Suggest a new label" : "+ Suggest a new highlight",
  );
  link.type = "button";
  link.addEventListener("click", () => {
    openSuggestModal({ action: "add", entryKind, ...ctx });
  });
  return link;
}

// -------------------- the modal --------------------

export function openSuggestModal(ctx) {
  document.querySelectorAll(".bp-suggest-overlay").forEach((n) => n.remove());

  const overlay = el("div", "bp-suggest-overlay");
  const modal = el("div", "bp-suggest-modal");
  overlay.appendChild(modal);

  const header = el("div", "bp-suggest-modal__header");
  const title = el("h2", "bp-suggest-modal__title", suggestTitle(ctx));
  const closeBtn = el("button", "bp-suggest-modal__close");
  closeBtn.type = "button";
  closeBtn.innerHTML = "&#x2715;";
  closeBtn.setAttribute("aria-label", "Close");
  header.appendChild(title);
  header.appendChild(closeBtn);
  modal.appendChild(header);

  const body = el("div", "bp-suggest-modal__body");
  modal.appendChild(body);

  function closeModal() {
    document.removeEventListener("keydown", onKeydown);
    overlay.remove();
  }
  function onKeydown(e) {
    if (e.key === "Escape") closeModal();
  }
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) closeModal();
  });
  closeBtn.addEventListener("click", closeModal);
  document.addEventListener("keydown", onKeydown);

  document.body.appendChild(overlay);
  renderBody(body, ctx, closeModal);
  return { close: closeModal };
}

function suggestTitle(ctx) {
  const breadcrumb =
    ctx.scope === "bookwide"
      ? window.bookNameFor
        ? window.bookNameFor(ctx.bookId)
        : ctx.bookId
      : `${ctx.bookId} ${ctx.chapterNum}`;
  const kind = ctx.entryKind === "highlight" ? "Highlight" : "Label";
  if (ctx.action === "add") return `${breadcrumb} · New ${kind.toLowerCase()} suggestion`;
  const name = ctx.entry?.[ctx.entryKind] || "";
  return `${breadcrumb} · ${kind} · “${name}”`;
}

async function renderBody(body, ctx, closeModal) {
  body.innerHTML = "";
  body.appendChild(el("div", "bp-suggest-msg", "Loading…"));

  let session;
  try {
    session = await getSession();
  } catch (err) {
    body.innerHTML = "";
    body.appendChild(
      el("div", "bp-suggest-msg bp-suggest-msg--error", mapSupabaseError(err)),
    );
    return;
  }

  if (!session) {
    renderSignInGate(body, ctx, closeModal);
    return;
  }

  const [banned, enabled] = await Promise.all([
    isBanned(),
    suggestionsEnabled(),
  ]);
  // Courtesy-only UI hiding for the rest of this session, now that we
  // actually know — real enforcement is the insert trigger, not this.
  document.documentElement.classList.toggle(
    "bp-suggestions-hidden",
    banned || !enabled,
  );
  if (!enabled) {
    body.innerHTML = "";
    body.appendChild(
      el(
        "div",
        "bp-suggest-msg",
        "Suggestions are temporarily turned off. Please check back later.",
      ),
    );
    return;
  }
  if (banned) {
    body.innerHTML = "";
    body.appendChild(
      el("div", "bp-suggest-msg", "Your account is no longer able to submit suggestions."),
    );
    return;
  }

  renderForm(body, ctx, session, closeModal);
}

function renderSignInGate(body, ctx, closeModal) {
  body.innerHTML = "";
  body.appendChild(
    el("p", "bp-suggest-help", "Sign in to send a suggestion."),
  );
  body.appendChild(
    el(
      "p",
      "bp-suggest-help",
      "One shared Gospel Go account across gospelgo.org. We'll email you a sign-in code — no password.",
    ),
  );

  const gateRoot = el("div");
  body.appendChild(gateRoot);
  renderAuthGate(gateRoot, {
    onBeforeSend: () => {
      sessionStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ ctx: serializableCtx(ctx), fields: {} }),
      );
    },
    onSignedIn: () => renderBody(body, ctx, closeModal),
  });
}

function serializableCtx(ctx) {
  // Strip the live `entry` object down to plain data (no DOM/closure refs)
  // so it survives a JSON round-trip through sessionStorage.
  const { entry, ...rest } = ctx;
  return { ...rest, entry: entry ? JSON.parse(JSON.stringify(entry)) : undefined };
}

function renderForm(body, ctx, session, closeModal) {
  body.innerHTML = "";

  const draft = readAndClearMatchingDraft(ctx);

  const form = el("div", "bp-suggest-form");
  body.appendChild(form);

  const fields = {};
  if (ctx.entryKind === "highlight") {
    fields.name = addTextField(form, "Highlight name", ctx.entry?.highlight, draft?.name);
    fields.phrases = addTextArea(
      form,
      "Phrases (one per line)",
      Array.isArray(ctx.entry?.text) ? ctx.entry.text.join("\n") : "",
      draft?.phrases,
    );
    if (ctx.scope === "chapter") {
      fields.phrasesWarning = el("div", "bp-suggest-help bp-suggest-msg--error");
      fields.phrasesWarning.style.display = "none";
      form.appendChild(fields.phrasesWarning);
    }
  } else {
    fields.name = addTextField(form, "Label", ctx.entry?.label, draft?.name);
    fields.verses = addTextField(
      form,
      "Verses (comma-separated, e.g. 7-12, 14)",
      Array.isArray(ctx.entry?.verses) ? ctx.entry.verses.join(", ") : "",
      draft?.verses,
    );
    fields.note = addTextArea(
      form,
      "Note",
      noteToField(ctx.entry?.note),
      draft?.note,
      "Add a note…",
    );
    fields.references = addTextArea(
      form,
      "References (one per line)",
      Array.isArray(ctx.entry?.references) ? ctx.entry.references.join("\n") : "",
      draft?.references,
    );
  }
  fields.rationale = addTextArea(
    form,
    "Why this change? (optional)",
    "",
    draft?.rationale,
  );

  // Honeypot: real users never see or fill this in.
  const honey = document.createElement("input");
  honey.type = "text";
  honey.name = "website";
  honey.tabIndex = -1;
  honey.autocomplete = "off";
  honey.className = "bp-suggest-honeypot";
  form.appendChild(honey);

  const msg = el("div", "bp-suggest-msg");
  body.appendChild(msg);

  const footer = el("div", "bp-suggest-modal__footer");
  const accountLine = el(
    "div",
    "bp-suggest-account-line",
    `Signed in as ${session.user.email}`,
  );
  const signOutLink = el("button", "bp-suggest-link-btn", "Sign out");
  signOutLink.type = "button";
  signOutLink.addEventListener("click", async () => {
    await signOut();
    renderBody(body, ctx, closeModal);
  });
  accountLine.appendChild(document.createTextNode(" · "));
  accountLine.appendChild(signOutLink);
  const myLink = el("button", "bp-suggest-link-btn", "View my suggestions");
  myLink.type = "button";
  myLink.addEventListener("click", () => renderMySuggestions(body, ctx, closeModal));
  accountLine.appendChild(document.createTextNode(" · "));
  accountLine.appendChild(myLink);
  const profileLink = document.createElement("a");
  profileLink.href = "profile.html";
  profileLink.target = "_blank";
  profileLink.rel = "noopener";
  profileLink.className = "bp-suggest-link-btn";
  profileLink.textContent = "My profile";
  accountLine.appendChild(document.createTextNode(" · "));
  accountLine.appendChild(profileLink);
  footer.appendChild(accountLine);

  const submitBtn = el("button", "bp-suggest-submit", "Send suggestion");
  submitBtn.type = "button";
  footer.appendChild(submitBtn);
  body.appendChild(footer);

  if (ctx.scope === "chapter" && ctx.entryKind === "highlight") {
    fields.phrases.addEventListener("input", () =>
      checkPhraseCoverage(fields.phrases, fields.phrasesWarning),
    );
  }

  submitBtn.addEventListener("click", async () => {
    if (honey.value) {
      msg.className = "bp-suggest-msg bp-suggest-msg--ok";
      msg.textContent = "Sent for review — thank you!";
      setTimeout(closeModal, 1500);
      return;
    }
    const now = Date.now();
    if (now - lastSubmitAt < COOLDOWN_MS) {
      msg.className = "bp-suggest-msg bp-suggest-msg--error";
      msg.textContent = "Please wait a moment before sending another suggestion.";
      return;
    }

    const { row, error } = buildRow(ctx, fields);
    if (error) {
      msg.className = "bp-suggest-msg bp-suggest-msg--error";
      msg.textContent = error;
      return;
    }
    if (!row) {
      msg.className = "bp-suggest-msg bp-suggest-msg--error";
      msg.textContent =
        "That doesn't look different from the current content — nothing to send.";
      return;
    }

    submitBtn.disabled = true;
    try {
      const client = await getClient();
      const { error: insertError } = await client
        .from("bp_suggestions")
        .insert(row);
      if (insertError) throw insertError;
      lastSubmitAt = now;
      sessionStorage.removeItem(DRAFT_KEY);
      msg.className = "bp-suggest-msg bp-suggest-msg--ok";
      msg.textContent = "Sent for review — thank you!";
      submitBtn.textContent = "Sent";
      setTimeout(closeModal, 1500);
    } catch (err) {
      msg.className = "bp-suggest-msg bp-suggest-msg--error";
      msg.textContent = mapSupabaseError(err);
      submitBtn.disabled = false;
    }
  });
}

function checkPhraseCoverage(textarea, warningEl) {
  const phrases = parseLines(textarea.value);
  const cache = window._chapterVerseTextCache;
  if (!phrases.length || !cache) {
    warningEl.style.display = "none";
    return;
  }
  const chapterText = Array.from(cache.values ? cache.values() : [])
    .join(" ")
    .toLowerCase();
  const missing = phrases.filter((p) => !chapterText.includes(p.toLowerCase()));
  if (missing.length) {
    warningEl.style.display = "";
    warningEl.textContent = `These phrases don't appear in the rendered text: ${missing.join(", ")}. Highlights only work on exact wording.`;
  } else {
    warningEl.style.display = "none";
  }
}

function addTextField(form, labelText, prefillValue, draftValue) {
  const field = el("div", "bp-suggest-field");
  field.appendChild(el("label", null, labelText));
  const input = document.createElement("input");
  input.type = "text";
  input.value = draftValue !== undefined ? draftValue : prefillValue || "";
  field.appendChild(input);
  form.appendChild(field);
  return input;
}

function addTextArea(form, labelText, prefillValue, draftValue, placeholder) {
  const field = el("div", "bp-suggest-field");
  field.appendChild(el("label", null, labelText));
  const textarea = document.createElement("textarea");
  textarea.value = draftValue !== undefined ? draftValue : prefillValue || "";
  if (placeholder) textarea.placeholder = placeholder;
  field.appendChild(textarea);
  form.appendChild(field);
  return textarea;
}

// Builds the bp_suggestions row to insert, or { error } / { row: null } if
// there's nothing to submit. Only fields the user actually changed end up
// in `proposed` for a correction — this is what guarantees a correction
// touches exactly the fields it claims to and nothing else.
function buildRow(ctx, fields) {
  const base = {
    scope: ctx.scope,
    book_id: ctx.bookId,
    chapter: ctx.scope === "bookwide" ? null : ctx.chapterNum,
    entry_kind: ctx.entryKind,
    action: ctx.action,
    rationale: fields.rationale.value.trim() || null,
  };

  if (ctx.entryKind === "highlight") {
    const name = fields.name.value.trim();
    const phrases = parseLines(fields.phrases.value);
    if (!name || !phrases.length) {
      return { error: "A highlight name and at least one phrase are required." };
    }
    if (ctx.action === "add") {
      return { row: { ...base, target: null, proposed: { highlight: name, text: phrases } } };
    }
    const proposed = {};
    if (name !== ctx.entry.highlight) proposed.highlight = name;
    if (!arraysEqual(phrases, ctx.entry.text)) proposed.text = phrases;
    if (!Object.keys(proposed).length) return { row: null };
    return {
      row: {
        ...base,
        target: buildTarget(ctx),
        proposed,
      },
    };
  }

  const name = fields.name.value.trim();
  const verses = parseVerses(fields.verses.value);
  const note = fieldToNote(fields.note.value);
  const references = parseLines(fields.references.value);
  if (!name) return { error: "A label name is required." };

  if (ctx.action === "add") {
    const proposed = { label: name };
    if (verses.length) proposed.verses = verses;
    if (references.length) proposed.references = references;
    if (note !== undefined) proposed.note = note;
    return { row: { ...base, target: null, proposed } };
  }

  const proposed = {};
  if (name !== ctx.entry.label) proposed.label = name;
  if (!arraysEqual(verses, ctx.entry.verses)) proposed.verses = verses;
  if (!arraysEqual(references, ctx.entry.references)) proposed.references = references;
  const currentNoteField = noteToField(ctx.entry.note);
  if (fields.note.value.trim() !== currentNoteField.trim()) proposed.note = note ?? null;
  if (!Object.keys(proposed).length) return { row: null };
  return { row: { ...base, target: buildTarget(ctx), proposed } };
}

function buildTarget(ctx) {
  return {
    entry_kind: ctx.entryKind,
    entry_name: ctx.entry[ctx.entryKind],
    entry_verses_or_text: ctx.entryKind === "highlight" ? ctx.entry.text : ctx.entry.verses,
    entry_index: ctx.entryIndex,
    snapshot: JSON.parse(JSON.stringify(ctx.entry)),
  };
}

function readAndClearMatchingDraft(ctx) {
  const raw = sessionStorage.getItem(DRAFT_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(DRAFT_KEY);
  try {
    const draft = JSON.parse(raw);
    if (
      draft?.ctx?.bookId === ctx.bookId &&
      draft.ctx.chapterNum === ctx.chapterNum &&
      draft.ctx.entryKind === ctx.entryKind &&
      draft.ctx.action === ctx.action
    ) {
      return draft.fields;
    }
  } catch {
    // ignore malformed draft
  }
  return null;
}

// -------------------- "my suggestions" --------------------

async function renderMySuggestions(body, ctx, closeModal) {
  body.innerHTML = "";
  body.appendChild(el("div", "bp-suggest-msg", "Loading…"));
  try {
    const client = await getClient();
    const { data, error } = await client
      .from("bp_suggestions")
      .select(
        "id, created_at, scope, book_id, chapter, entry_kind, action, status, review_note",
      )
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;

    body.innerHTML = "";
    const backBtn = el("button", "bp-suggest-link-btn", "‹ Back");
    backBtn.type = "button";
    backBtn.addEventListener("click", () =>
      renderBody(body, ctx, closeModal),
    );
    body.appendChild(backBtn);

    if (!data.length) {
      body.appendChild(el("p", "bp-suggest-help", "You haven't sent any suggestions yet."));
      return;
    }
    const list = el("div", "bp-suggest-my-list");
    data.forEach((row) => {
      const item = el("div", "bp-suggest-my-item");
      const where =
        row.scope === "bookwide"
          ? `${row.book_id} · book-wide`
          : `${row.book_id} ${row.chapter}`;
      item.appendChild(
        el(
          "div",
          "bp-suggest-my-item__title",
          `${where} · ${row.entry_kind} · ${row.action === "add" ? "new" : "correction"}`,
        ),
      );
      item.appendChild(el("div", `bp-suggest-status bp-suggest-status--${row.status}`, row.status));
      if (row.status === "rejected" && row.review_note) {
        item.appendChild(el("div", "bp-suggest-help", row.review_note));
      }
      list.appendChild(item);
    });
    body.appendChild(list);
  } catch (err) {
    body.innerHTML = "";
    body.appendChild(
      el("div", "bp-suggest-msg bp-suggest-msg--error", mapSupabaseError(err)),
    );
  }
}

// -------------------- draft-resume after magic-link redirect --------------------

export function maybeResumeSuggestDraft() {
  const raw = sessionStorage.getItem(DRAFT_KEY);
  if (!raw) return; // cheap no-op for every normal page load
  getSession()
    .then((session) => {
      if (!session) return;
      const draft = JSON.parse(raw);
      openSuggestModal(draft.ctx);
    })
    .catch(() => {});
}
