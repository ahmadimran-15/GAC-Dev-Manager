// Runs once when the server starts: email polling, WhatsApp reminders, reply suggestions.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWorker } = await import("./lib/inbound");
    startWorker();
  }
}
