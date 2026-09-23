# LXA Wait Duty

A one-page site: type your name, pick it, press **Add all days to Google Calendar**, and every
one of your wait duty days goes into your calendar at once. Each duty day gets two small
15-minute events, at **2:00 PM** and **6:30 PM**, and each one pops up a reminder when it starts.
They're marked **Free**, so they never block your schedule.

## How it works

- `schedule.js`: the schedule, generated from the PDF. Don't edit it by hand.
- `config.js`: settings (Google client ID, reminder times, event length, hide past dates).
- `index.html` + `app.js`: the site. No build step, no server needed.

There are two modes:

| Mode | When | What the button does |
|---|---|---|
| **Import** (default) | `googleClientId` is empty | Downloads one `.ics` file with every date and opens Google Calendar's Import page. You pick the file and click Import. Google usually ignores reminders inside imported files, so the pop-ups follow your calendar's default notifications. |
| **One-click** (recommended) | `googleClientId` is set | Signs in with Google and adds every date at once, with the 2:00 PM and 6:30 PM pop-ups guaranteed. Running it again updates the events instead of duplicating them. |

One-click mode works in phone browsers (Safari, Chrome). Google blocks sign-in inside apps'
built-in browsers (GroupMe, Instagram, Snapchat), so the site detects those and tells people to
open the link in Safari or Chrome instead.

Both modes also offer a `.ics` download for Apple Calendar or Outlook, which do honor the built-in reminders.

## Publish it (Vercel, free)

1. On [vercel.com](https://vercel.com), click **Add New → Project** and import this GitHub repo.
2. Keep Framework Preset as **Other**, leave the build settings empty, and click **Deploy**.
3. Share the production URL (`https://<project>.vercel.app`) in the group chat. Every push to
   `main` redeploys automatically.

## Turn on one-click mode

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) and create a project.
2. **APIs & Services → Library**: enable **Google Calendar API**.
3. **OAuth consent screen**: pick *External*, fill in the app name and your email, and add the scope
   `https://www.googleapis.com/auth/calendar.events`. Then **publish** the app. You don't need
   Google's verification: people will see an "unverified app" screen (Advanced → Go to site) and
   can still use it, for up to 100 users.
4. **Credentials → Create credentials → OAuth client ID → Web application**. Under *Authorized
   JavaScript origins*, add your Vercel production URL, e.g. `https://<project>.vercel.app`, with no trailing
   slash (and `http://localhost:8765` for testing). Sign-in only works on origins listed here, so
   Vercel preview URLs won't work. Test on the production URL.
5. Paste the client ID into `googleClientId` in `config.js` and push.

## New semester

```sh
pip install pypdf
python scripts/extract_schedule.py "path/to/new schedule.pdf"
```

Then update `title` in the script if the semester name changed. The script checks every date
against its weekday and stops if a row looks wrong.

## Run locally

```sh
python -m http.server 8765
```

Then open http://localhost:8765.
