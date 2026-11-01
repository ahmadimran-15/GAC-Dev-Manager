// Runs once when the server starts: email polling, WhatsApp reminders, reply suggestions.
export async function register() {
  // DISABLE_WORKER=1 for a side-by-side test instance (no polling, reminders or webhook registration)
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.DISABLE_WORKER !== "1") {
    const { startWorker } = await import("./lib/inbound");
    startWorker();
    // Keep ClickUp's status webhook pointed at the current PUBLIC_URL (only re-registers when it changed)
    setTimeout(() => {
      import("./lib/clickup")
        .then((c) => (process.env.CLICKUP_TOKEN && process.env.PUBLIC_URL ? c.ensureClickupWebhook() : null))
        .catch((e) => console.error("ClickUp webhook:", e instanceof Error ? e.message : e));
    }, 15_000);
  }
}
