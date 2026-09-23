(function () {
  "use strict";

  const config = window.WAIT_DUTY_CONFIG || {};
  const schedule = window.SCHEDULE;
  const reminderTimes = config.reminderTimes || ["14:00", "18:30"];
  const eventMinutes = config.eventMinutes ?? 15;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const useGoogleApi = Boolean(config.googleClientId);
  const siteUrl = location.origin + location.pathname;
  const STORAGE_KEY = "waitduty:name";

  // ---------- Schedule data ----------

  // name -> [{ date: "YYYY-MM-DD", floor }]
  const shiftsByName = new Map();
  for (const day of schedule.days) {
    for (const [floor, name] of Object.entries(day.assignments || {})) {
      if (!shiftsByName.has(name)) shiftsByName.set(name, []);
      shiftsByName.get(name).push({ date: day.date, floor });
    }
  }
  const names = [...shiftsByName.keys()].sort((a, b) => a.localeCompare(b));

  function todayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function shiftsFor(name) {
    const all = shiftsByName.get(name) || [];
    return config.hidePastDates ? all.filter((s) => s.date >= todayIso()) : all;
  }

  // Each duty day becomes one small event per reminder time.
  function eventsFor(shifts) {
    return shifts.flatMap((shift) => reminderTimes.map((time) => ({ shift, time })));
  }

  // ---------- Date helpers ----------

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function parseIso(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  // Local wall-clock time as "YYYY-MM-DDTHH:MM:00", optionally shifted by some minutes.
  function localDateTime(iso, time, addMinutes = 0) {
    const [h, m] = time.split(":").map(Number);
    const d = parseIso(iso);
    d.setHours(h, m + addMinutes);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
  }

  function compact(iso) {
    return iso.replaceAll("-", "");
  }

  function formatTime(time) {
    return new Date(`2000-01-01T${time}`).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  function prettyDate(iso) {
    return parseIso(iso).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  }

  // ---------- Event content ----------

  function eventTitle(shift) {
    return `🧹 Wait Duty: ${shift.floor}`;
  }

  function eventDetails(shift) {
    return `LXA wait duty today: ${shift.floor}.\n\nFull schedule: ${siteUrl}`;
  }

  // Google Calendar event IDs must use base32hex characters (0-9, a-v).
  // A stable ID means adding the same shift twice updates it instead of duplicating it.
  function eventId(name, { shift, time }) {
    let hash = 0x811c9dc5;
    for (const ch of name + "|" + shift.floor) {
      hash ^= ch.codePointAt(0);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `dut${compact(shift.date)}${time.replace(":", "")}${hash.toString(16).padStart(8, "0")}`;
  }

  const IMPORT_URL = "https://calendar.google.com/calendar/r/settings/export";

  function calendarDayUrl(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return `https://calendar.google.com/calendar/r/day/${y}/${m}/${d}`;
  }

  function icsEscape(text) {
    return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  }

  function buildIcs(name, shifts) {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//LXA//Wait Duty//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
    // Floating local times (no time zone), so they land at 2:00 PM wherever the calendar is.
    const icsTime = (dt) => dt.replace(/[-:]/g, "");
    for (const event of eventsFor(shifts)) {
      const { shift, time } = event;
      lines.push(
        "BEGIN:VEVENT",
        `UID:${eventId(name, event)}@lxa-wait-duty`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${icsTime(localDateTime(shift.date, time))}`,
        `DTEND:${icsTime(localDateTime(shift.date, time, eventMinutes))}`,
        `SUMMARY:${icsEscape(eventTitle(shift))}`,
        `DESCRIPTION:${icsEscape(eventDetails(shift))}`,
        "TRANSP:TRANSPARENT",
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        `DESCRIPTION:${icsEscape(eventTitle(shift))}`,
        "TRIGGER:PT0M",
        "END:VALARM",
        "END:VEVENT"
      );
    }
    lines.push("END:VCALENDAR");
    return lines.join("\r\n") + "\r\n";
  }

  // ---------- Google Calendar API (only when a client ID is configured) ----------

  let tokenClient = null;

  function loadGoogleIdentity() {
    return new Promise((resolve, reject) => {
      if (window.google?.accounts?.oauth2) return resolve();
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Couldn't load Google sign-in."));
      document.head.appendChild(script);
    });
  }

  function requestToken() {
    return new Promise((resolve, reject) => {
      tokenClient.callback = (resp) => (resp.error ? reject(new Error(resp.error)) : resolve(resp.access_token));
      tokenClient.error_callback = (err) => reject(new Error(err.type || "Sign-in was cancelled."));
      tokenClient.requestAccessToken();
    });
  }

  async function upsertEvent(token, name, event) {
    const { shift, time } = event;
    const id = eventId(name, event);
    const body = {
      id,
      summary: eventTitle(shift),
      description: eventDetails(shift),
      start: { dateTime: localDateTime(shift.date, time), timeZone },
      end: { dateTime: localDateTime(shift.date, time, eventMinutes), timeZone },
      transparency: "transparent",
      status: "confirmed",
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 0 }] },
    };
    const base = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    let res = await fetch(base, { method: "POST", headers, body: JSON.stringify(body) });
    if (res.status === 409) {
      // Already added before (possibly deleted since): overwrite it instead.
      res = await fetch(`${base}/${id}`, { method: "PUT", headers, body: JSON.stringify(body) });
    }
    if (!res.ok) throw new Error(`Google Calendar returned ${res.status}`);
  }

  // ---------- Combobox ----------

  const input = document.getElementById("name-input");
  const list = document.getElementById("name-list");
  const goButton = document.getElementById("go");
  const result = document.getElementById("result");

  let matches = [];
  let activeIndex = -1;
  let selectedName = null;

  function normalize(s) {
    return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  }

  function findMatches(query) {
    const q = normalize(query);
    if (!q) return names;
    const terms = q.split(/\s+/);
    const scored = [];
    for (const name of names) {
      const n = normalize(name);
      const words = n.split(/[\s-]+/);
      const allTermsMatch = terms.every((t) => words.some((w) => w.startsWith(t)));
      if (allTermsMatch || n.includes(q)) scored.push({ name, rank: n.startsWith(q) ? 0 : allTermsMatch ? 1 : 2 });
    }
    return scored.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name)).map((s) => s.name);
  }

  function renderList() {
    list.replaceChildren();
    if (matches.length === 0) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "No one by that name on the schedule";
      list.appendChild(li);
    }
    matches.forEach((name, i) => {
      const li = document.createElement("li");
      li.id = `name-opt-${i}`;
      li.role = "option";
      li.textContent = name;
      li.setAttribute("aria-selected", String(i === activeIndex));
      li.addEventListener("mousedown", (e) => {
        e.preventDefault(); // keep focus in the input
        choose(name);
      });
      list.appendChild(li);
    });
    input.setAttribute("aria-activedescendant", activeIndex >= 0 ? `name-opt-${activeIndex}` : "");
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }

  function openList() {
    matches = findMatches(input.value);
    activeIndex = matches.length ? 0 : -1;
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    renderList();
  }

  function closeList() {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
  }

  function choose(name) {
    input.value = name;
    closeList();
    selectName(name);
  }

  input.addEventListener("input", () => {
    // Typing an exact name (any case) selects it without needing the dropdown.
    const exact = names.find((n) => normalize(n) === normalize(input.value));
    selectName(exact || null);
    openList();
  });
  input.addEventListener("focus", openList);
  input.addEventListener("blur", closeList);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (list.hidden) return openList();
      if (!matches.length) return;
      activeIndex = (activeIndex + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
      renderList();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!list.hidden && matches[activeIndex]) choose(matches[activeIndex]);
      else if (selectedName) goButton.click();
    } else if (e.key === "Escape") {
      closeList();
    }
  });

  // ---------- Results ----------

  function el(tag, props = {}, ...children) {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  }

  function selectName(name) {
    if (name === selectedName) return;
    selectedName = name;
    result.replaceChildren();
    if (!name) return updateButton();

    try { localStorage.setItem(STORAGE_KEY, name); } catch {}
    renderShifts();
    updateButton();
  }

  function updateButton() {
    const shifts = selectedName ? shiftsFor(selectedName) : [];
    goButton.disabled = shifts.length === 0;
    goButton.textContent = shifts.length > 1 ? `Add all ${shifts.length} days to Google Calendar` : "Add to Google Calendar";
  }

  function icsUrl(shifts) {
    return URL.createObjectURL(new Blob([buildIcs(selectedName, shifts)], { type: "text/calendar" }));
  }

  function icsFilename() {
    return `wait-duty-${selectedName.toLowerCase().replace(/\s+/g, "-")}.ics`;
  }

  function renderShifts(statusNode) {
    const shifts = shiftsFor(selectedName);
    result.replaceChildren();
    if (statusNode) result.append(statusNode);

    if (shifts.length === 0) {
      result.append(el("p", { className: "status" }, "You have no upcoming wait duty days. Enjoy!"));
      return;
    }

    const items = shifts.map((shift) => el("li", {},
      el("div", {},
        el("div", { className: "when", textContent: prettyDate(shift.date) }),
        el("div", { className: "floor", textContent: shift.floor })
      )
    ));

    const icsLink = el("a", {
      className: "btn secondary",
      href: icsUrl(shifts),
      download: icsFilename(),
      textContent: "Download .ics (Apple / Outlook)",
    });

    result.append(
      el("p", { className: "status", textContent: `${shifts.length} upcoming duty day${shifts.length === 1 ? "" : "s"}:` }),
      el("ul", { className: "shifts" }, ...items),
      el("div", { className: "actions" }, icsLink),
      el("p", { className: "hint" },
        `Each duty day gets ${reminderTimes.length} short reminder events (${reminderTimes.map(formatTime).join(" and ")}), marked Free so they won't block your schedule.`)
    );
  }

  goButton.addEventListener("click", async () => {
    const shifts = shiftsFor(selectedName);
    if (!shifts.length) return;

    if (!useGoogleApi) {
      // No OAuth client configured: hand Google Calendar one file with every date via its Import page.
      el("a", { href: icsUrl(shifts), download: icsFilename() }).click();
      window.open(IMPORT_URL, "_blank", "noopener");
      renderShifts(el("div", { className: "steps" },
        el("p", { className: "status ok", textContent: "Almost done: two clicks in the Google Calendar tab that just opened:" }),
        el("ol", {},
          el("li", {}, "Click ", el("b", { textContent: "Select file from your computer" }), " and pick ", el("b", { textContent: icsFilename() }), " (in Downloads)."),
          el("li", {}, "Click ", el("b", { textContent: "Import" }), ". All your days go in at once.")
        ),
        el("a", { className: "btn secondary", href: IMPORT_URL, target: "_blank", rel: "noopener", textContent: "Tab didn't open? Open Import page →" })
      ));
      return;
    }

    goButton.disabled = true;
    goButton.textContent = "Adding…";
    try {
      await googleReady;
      const token = await requestToken();
      await Promise.all(eventsFor(shifts).map((e) => upsertEvent(token, selectedName, e)));
      const open = el("a", {
        className: "btn secondary",
        href: calendarDayUrl(shifts[0].date),
        target: "_blank",
        rel: "noopener",
        textContent: "Open Google Calendar →",
      });
      renderShifts(el("p", { className: "status ok" }, `Added ${shifts.length} day${shifts.length === 1 ? "" : "s"} to your calendar. `, open));
    } catch (err) {
      renderShifts(el("p", { className: "status err", textContent: `Couldn't add events (${err.message}). Try again, or use the .ics download below.` }));
    } finally {
      updateButton();
    }
  });

  // ---------- Init ----------

  document.getElementById("footer").textContent =
    `${schedule.title} · ${names.length} people · ${schedule.days.length} days`;

  const googleReady = !useGoogleApi ? Promise.resolve() : loadGoogleIdentity()
      .then(() => {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: config.googleClientId,
          scope: "https://www.googleapis.com/auth/calendar.events",
          callback: () => {},
        });
      });

  let remembered = null;
  try { remembered = localStorage.getItem(STORAGE_KEY); } catch {}
  if (remembered && shiftsByName.has(remembered)) {
    input.value = remembered;
    selectName(remembered);
  }
})();
