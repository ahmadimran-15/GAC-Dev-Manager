// When the server is allowed to spend AI credits on its own.
//
// Overnight nobody is reading the dashboard, but clients and bots keep posting, and every one of those
// messages used to cost a drafted reply. Background AI now runs in office hours only — noon to
// midnight Pakistan time by default — and outside them nothing is drafted until someone asks for it.
//
// This never blocks anything a person clicked: Suggest a reply, Rewrite, the Assistant and the Image
// tab all work at 4 am. It also never blocks the SOD / EOD screenshot check, which has to answer at
// midnight, when the end-of-day proof actually arrives.

const TZ = process.env.AI_HOURS_TZ || "Asia/Karachi";
const FROM = Number(process.env.AI_HOURS_FROM ?? 12); // 12 = noon
const TO = Number(process.env.AI_HOURS_TO ?? 24); // 24 = midnight

export const aiHour = (at: number = Date.now()) =>
  Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(at)) % 24;

// Inside the window? A window that wraps past midnight (e.g. 20 → 6) is handled too.
export function aiHoursNow(at: number = Date.now()) {
  if (!(FROM >= 0 && TO > 0)) return true;
  const h = aiHour(at);
  const to = TO % 24;
  return FROM < to || to === 0 ? h >= FROM && (to === 0 || h < to) : h >= FROM || h < to;
}

// For the dashboard and the logs: "12:00–24:00 Asia/Karachi"
export const aiHoursLabel = () => `${String(FROM).padStart(2, "0")}:00–${String(TO).padStart(2, "0")}:00 ${TZ}`;

export const aiHoursInfo = () => ({ from: FROM, to: TO, tz: TZ, now: aiHoursNow(), hour: aiHour(), label: aiHoursLabel() });
