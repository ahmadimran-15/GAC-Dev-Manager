import Assistant from "@/components/Assistant";

export const metadata = { title: "Assistant · GAC Desk" };

// The same assistant as the "/" pop-up, with the whole screen to itself.
export default function AssistantPage() {
  return (
    <div className="fade-in mx-auto flex h-[calc(100dvh-124px)] w-full max-w-[1100px] flex-col px-4 pb-4 pt-6 md:h-[calc(100vh/var(--ui-zoom)-120px)] md:px-6 md:pt-10 xl:px-10">
      <div className="mb-4 shrink-0">
        <h1 className="text-[30px] font-semibold tracking-tight">Assistant</h1>
        <p className="mt-1 text-[15px] text-[var(--ink-2)]">Ask it to find something, draft a reply or create a task. English, Urdu or Hindi, typed or spoken.</p>
      </div>
      <Assistant full />
    </div>
  );
}
