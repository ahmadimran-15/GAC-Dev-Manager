import { NextResponse } from "next/server";
import { answerFrom, interpret } from "@/lib/ai";
import { getMessages, listConversations, msgText } from "@/lib/store";
import { allMembers, board } from "@/lib/clickup";
import { searchClickUp, searchEmail, searchMessages } from "@/lib/search";

// Turns a spoken/typed instruction into an action to confirm, or runs a search and answers.
export async function POST(req: Request) {
  const { text, history } = await req.json().catch(() => ({}));
  if (!String(text ?? "").trim()) return NextResponse.json({ error: "Say or type something first" }, { status: 400 });
  const now = Date.now();
  const convs = listConversations().slice(0, 25);
  const b = await board();
  const members = await allMembers().catch(() => b.team);
  const byStage = new Map<string, string[]>();
  for (const p of b.projectInfo) byStage.set(p.stage, [...(byStage.get(p.stage) ?? []), `${p.name}${p.owner ? ` (${p.owner})` : ""}`]);
  const context = [
    "Conversations (most urgent first):",
    ...convs.map((c) => {
      const recent = getMessages(c.id)
        .slice(-4)
        .map((m) => `${m.direction === "in" ? "client" : "us"}: ${msgText(m).slice(0, 160)}`)
        .join(" | ");
      return `- id=${c.id} name="${c.name}" channel=${c.channel} project="${c.project ?? ""}" ${c.waiting ? `WAITING ${Math.round((now - (c.waitingSince ?? now)) / 60000)}m` : "answered"} :: ${recent}`;
    }),
    `Team members: ${members.join(", ")}`,
    `CURRENT projects (new tasks go here): ${b.projects.join(", ")}`,
    ...[...byStage.entries()].filter(([stage]) => !b.projectInfo.find((p) => p.stage === stage)?.current).map(([stage, list]) => `${stage}: ${list.join(", ")}`),
  ].join("\n");

  try {
    const cmd = await interpret(String(text), context, Array.isArray(history) ? history.slice(-6).join("\n") : "");
    if (cmd.intent === "search" && cmd.query) {
      const source = cmd.source ?? "clickup";
      const results = source === "email" ? await searchEmail(cmd.query) : source === "messages" ? searchMessages(cmd.query) : await searchClickUp(cmd.query);
      return NextResponse.json({ intent: "answer", answer: await answerFrom(String(text), source, results), searched: { source, query: cmd.query } });
    }
    let warning: string | null = null;
    if (cmd.intent === "task" && cmd.task?.project) {
      const p = b.projectInfo.find((x) => x.name.toLowerCase() === cmd.task!.project!.toLowerCase());
      if (p && !p.current) warning = `"${p.name}" is in ${p.stage}, not Current Projects. Pick a current project or type a new project name.`;
    }
    const conv = cmd.conversation_id ? convs.find((c) => c.id === cmd.conversation_id) : undefined;
    return NextResponse.json({ ...cmd, warning, conversation: conv ? { id: conv.id, name: conv.name, channel: conv.channel } : null });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Assistant failed" }, { status: 502 });
  }
}
