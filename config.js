// Site settings. See README.md for how to get a Google OAuth client ID.
window.WAIT_DUTY_CONFIG = {
  // With a client ID, "Add to Google Calendar" signs in with Google and adds
  // every duty day in one click. Without one, the site falls back to
  // per-date "Add" links plus a downloadable .ics file.
  googleClientId: "864747562688-vqkdib0jl6e71bo5if9m2gvuq6g48q2h.apps.googleusercontent.com",

  // On each duty day, a small event (with a popup) is added at each of these
  // times, 24-hour format.
  reminderTimes: ["14:00", "18:30"],

  // Length of each reminder event, in minutes. They're marked Free either way.
  eventMinutes: 15,

  // Skip duty days that are already over.
  hidePastDates: true,
};
