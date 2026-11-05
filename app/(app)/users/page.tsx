import LoginsManager from "@/components/LoginsManager";
import TeamNumbersManager from "@/components/TeamNumbersManager";
import TeamWhatsAppAccess from "@/components/TeamWhatsAppAccess";

export const metadata = { title: "Users · GAC Desk" };

// Everything about who can sign in and what they see. Kept out of Settings, which had grown long
// enough that adding a teammate meant scrolling past the whole system health page to find it.
export default function UsersPage() {
  return (
    <div className="fade-in mx-auto w-full max-w-[1100px] px-4 pb-20 pt-6 md:px-6 md:pt-10 xl:px-10">
      <h1 className="text-[30px] font-semibold tracking-tight">Users</h1>
      <p className="mt-1 text-[15px] text-[var(--ink-2)]">Who can sign in, what each of them can open, and how much of WhatsApp the team sees.</p>

      <h2 className="mb-1 mt-10 text-[13.5px] font-semibold">Logins</h2>
      <LoginsManager />

      <h2 className="mb-1 mt-10 text-[13.5px] font-semibold">What the team&apos;s WhatsApp portal shows</h2>
      <TeamWhatsAppAccess />

      <h2 className="mb-1 mt-10 text-[13.5px] font-semibold">Team numbers</h2>
      <p className="mb-2 text-[13px] text-[var(--ink-2)]">
        Numbers on our own side. These are the only people the team sees by name in their portal — everyone else reads “Client”.
      </p>
      <TeamNumbersManager />
    </div>
  );
}
