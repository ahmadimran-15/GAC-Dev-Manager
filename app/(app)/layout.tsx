import { LiveProvider } from "@/components/Live";
import TopNav from "@/components/TopNav";
import Assistant from "@/components/Assistant";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <LiveProvider>
      <TopNav />
      <main className="app-main">{children}</main>
      <Assistant />
    </LiveProvider>
  );
}
