// The share bar: a row of plain links (no third-party scripts), sharing this page with its link-preview title and text.
// shareBar(el) fills el; on load, every [data-share] on the page is filled. On phones, the system's own Share… comes first.
const css = document.createElement("style");
css.textContent = `
  .share { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 0.4rem; font: 0.85rem/1.2 system-ui, sans-serif; }
  .share-h { flex-basis: 100%; text-align: center; margin: 0 0 0.15rem; font-size: 0.75rem; font-weight: 700; letter-spacing: 0.06em;
             text-transform: uppercase; color: #1fa463; }   /* green: an invitation */
  .share a, .share button { padding: 0.3rem 0.7rem; border: 1.5px solid #d6d1c3; border-radius: 999px; background: #fff; color: #1c2430;
                            font: inherit; text-decoration: none; cursor: pointer; white-space: nowrap; }
  .share a:hover, .share button:hover { border-color: #1fa463; background: #eef8f2; }
  /* Share, as text in a line (the footer): its colour, no border; the bar opens in a card above it */
  .share-btn { display: inline-flex; align-items: center; gap: 0.35em; padding: 0; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; }
  .share-btn:hover { background: none; opacity: 0.75; }
  .share-btn svg { width: 1.05em; height: 1.05em; fill: currentColor; }
  .share-pop { position: fixed; z-index: 40; left: 50%; transform: translateX(-50%); width: max-content; max-width: calc(100vw - 32px);
               box-sizing: border-box; padding: 0.7rem 0.9rem 0.8rem; background: #fff; border: 2px solid #1fa463; border-radius: 12px;
               box-shadow: 0 8px 28px rgba(0, 0, 0, 0.25); animation: share-in 0.2s ease-out; }
  @keyframes share-in { from { opacity: 0; transform: translate(-50%, 6px); } }`;
document.head.append(css);

const meta = (p) => document.querySelector(`meta[property="og:${p}"]`)?.content;
// The page's own address (in a copy without one, where it runs), its title and its text.
const url = () => document.querySelector("link[rel=canonical]")?.href || location.href.split("#")[0];
const title = () => meta("title") || document.title;
const text = () => meta("description") || "";

const e = encodeURIComponent;
const SITES = [
  ["LinkedIn", (u) => `https://www.linkedin.com/sharing/share-offsite/?url=${e(u)}`],
  ["WhatsApp", (u, t) => `https://wa.me/?text=${e(`${t} ${u}`)}`],
  ["Facebook", (u) => `https://www.facebook.com/sharer/sharer.php?u=${e(u)}`],
  ["X", (u, t) => `https://x.com/intent/post?text=${e(t)}&url=${e(u)}`],
  ["Telegram", (u, t) => `https://t.me/share/url?url=${e(u)}&text=${e(t)}`],
  ["Reddit", (u, t) => `https://www.reddit.com/submit?url=${e(u)}&title=${e(t)}`],
  ["Email", (u, t, d) => `mailto:?subject=${e(t)}&body=${e(`${d}\n\n${u}`)}`],
];

export function shareBar(el) {
  const u = url(), t = title(), d = text();
  el.classList.add("share");
  el.innerHTML = `<p class="share-h">Share this demo</p>` +
    (navigator.share && matchMedia("(pointer: coarse)").matches ? `<button type="button" class="share-native">Share…</button>` : "") +
    SITES.map(([name, link]) => `<a href="${link(u, t, d)}"${name === "Email" ? "" : ` target="_blank" rel="noopener"`}>${name}</a>`).join("") +
    `<button type="button" class="share-copy">Copy link</button>`;
  el.querySelector(".share-native")?.addEventListener("click", () => navigator.share({ title: t, text: d, url: u }).catch(() => {}));
  const copy = el.querySelector(".share-copy");
  copy.onclick = () => navigator.clipboard.writeText(u).then(() => {
    copy.textContent = "Copied ✓"; setTimeout(() => { copy.textContent = "Copy link"; }, 1500);
  }, () => {});
}

// A Share button: on phones, the system's share sheet; elsewhere, the bar in a card just above the button's line
// (a click beside it, or Esc, closes it).
const touch = () => navigator.share && matchMedia("(pointer: coarse)").matches;
export function shareButton(btn) {
  btn.innerHTML = `Share <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M10.5 3.5 17 9l-6.5 5.5V11c-4.3 0-7 1.2-9 4.2.6-4.6 3.3-8 9-8.6z"/></svg>`;
  let pop = null;
  const close = () => { pop?.remove(); pop = null; };
  btn.onclick = (ev) => {
    ev.stopPropagation();
    if (touch()) return void navigator.share({ title: title(), text: text(), url: url() }).catch(() => {});
    if (pop) return close();
    pop = document.createElement("div"); pop.className = "share-pop";
    shareBar(pop); document.body.append(pop);
    pop.style.bottom = innerHeight - btn.closest("footer, div").getBoundingClientRect().top + 10 + "px";
    pop.onclick = (e) => e.stopPropagation();
  };
  addEventListener("click", close);
  addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
}

document.querySelectorAll("[data-share]").forEach(shareBar);
document.querySelectorAll("[data-share-button]").forEach(shareButton);
