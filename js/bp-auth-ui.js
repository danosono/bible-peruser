// Shared email -> 6-digit-code sign-in widget. One implementation reused by
// js/bp-suggest.js (modal gate), js/bp-admin.js (admin page root), and
// js/bp-profile.js (profile page "My suggestions" gate) so the OTP UX — and
// its CSS/copy — exists in exactly one place. Renders destructively into a
// caller-supplied container. Does NOT handle the magic-link-click redirect
// path itself — each host page already re-checks getSession() on load for
// that (see bp-suggest.js's maybeResumeSuggestDraft).
import { signInWithEmail, verifyOtp, mapSupabaseError } from "./bp-supabase.js";

const RESEND_COOLDOWN_MS = 30000;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// opts: { helpText?: string, onSignedIn: () => void, onBeforeSend?: (email: string) => void }
export function renderSignInGate(container, opts) {
  const { helpText, onSignedIn, onBeforeSend } = opts;
  let email = "";
  let lastSendAt = 0;

  function renderEmailStep() {
    container.innerHTML = "";
    if (helpText) container.appendChild(el("p", "bp-suggest-help", helpText));
    container.appendChild(
      el(
        "p",
        "bp-suggest-help",
        "You'll stay signed in on this device — no need to check your email again for future suggestions.",
      ),
    );

    const field = el("div", "bp-suggest-field");
    field.appendChild(el("label", null, "Email"));
    const input = document.createElement("input");
    input.type = "email";
    input.required = true;
    input.autocomplete = "email";
    input.value = email;
    field.appendChild(input);
    container.appendChild(field);

    const msg = el("div", "bp-suggest-msg");
    container.appendChild(msg);

    const sendBtn = el("button", "bp-suggest-submit", "Send code");
    sendBtn.type = "button";
    sendBtn.addEventListener("click", () => send(input.value.trim(), msg, sendBtn));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        send(input.value.trim(), msg, sendBtn);
      }
    });
    container.appendChild(sendBtn);
  }

  async function send(value, msg, sendBtn) {
    if (!value) return;
    sendBtn.disabled = true;
    try {
      onBeforeSend?.(value);
      await signInWithEmail(value);
      email = value;
      lastSendAt = Date.now();
      renderCodeStep();
    } catch (err) {
      msg.className = "bp-suggest-msg bp-suggest-msg--error";
      msg.textContent = mapSupabaseError(err);
      sendBtn.disabled = false;
    }
  }

  function renderCodeStep() {
    container.innerHTML = "";
    container.appendChild(
      el("p", "bp-suggest-help", `Enter the 6-digit code we emailed to ${email}.`),
    );
    container.appendChild(
      el(
        "p",
        "bp-suggest-help",
        "You can also just click the link in that email — it'll bring you right back here.",
      ),
    );

    const field = el("div", "bp-suggest-field bp-auth-code-field");
    field.appendChild(el("label", null, "Code"));
    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = "numeric";
    input.pattern = "[0-9]*";
    input.maxLength = 6;
    input.autocomplete = "one-time-code";
    field.appendChild(input);
    container.appendChild(field);

    const msg = el("div", "bp-suggest-msg");
    container.appendChild(msg);

    const verifyBtn = el("button", "bp-suggest-submit", "Verify");
    verifyBtn.type = "button";
    verifyBtn.addEventListener("click", () => verify(input.value.trim(), msg, verifyBtn));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        verify(input.value.trim(), msg, verifyBtn);
      }
    });
    container.appendChild(verifyBtn);

    const resendRow = el("div", "bp-auth-resend-row");
    const resendBtn = el("button", "bp-suggest-link-btn", "Resend code");
    resendBtn.type = "button";
    const backBtn = el("button", "bp-suggest-link-btn", "Use a different email");
    backBtn.type = "button";
    backBtn.addEventListener("click", renderEmailStep);
    resendRow.appendChild(resendBtn);
    resendRow.appendChild(document.createTextNode(" · "));
    resendRow.appendChild(backBtn);
    container.appendChild(resendRow);

    function updateResendState() {
      const remaining = RESEND_COOLDOWN_MS - (Date.now() - lastSendAt);
      if (remaining > 0) {
        resendBtn.disabled = true;
        resendBtn.textContent = `Resend code (${Math.ceil(remaining / 1000)}s)`;
      } else {
        resendBtn.disabled = false;
        resendBtn.textContent = "Resend code";
      }
    }
    updateResendState();
    const timer = setInterval(() => {
      if (!container.contains(resendBtn)) {
        clearInterval(timer);
        return;
      }
      updateResendState();
    }, 1000);

    resendBtn.addEventListener("click", async () => {
      if (resendBtn.disabled) return;
      resendBtn.disabled = true;
      try {
        onBeforeSend?.(email);
        await signInWithEmail(email);
        lastSendAt = Date.now();
        msg.className = "bp-suggest-msg bp-suggest-msg--ok";
        msg.textContent = "Sent a new code.";
      } catch (err) {
        msg.className = "bp-suggest-msg bp-suggest-msg--error";
        msg.textContent = mapSupabaseError(err);
      }
      updateResendState();
    });
  }

  async function verify(token, msg, verifyBtn) {
    if (!token) return;
    verifyBtn.disabled = true;
    try {
      await verifyOtp(email, token);
      onSignedIn();
    } catch (err) {
      msg.className = "bp-suggest-msg bp-suggest-msg--error";
      msg.textContent = mapSupabaseError(err);
      verifyBtn.disabled = false;
    }
  }

  renderEmailStep();
}
