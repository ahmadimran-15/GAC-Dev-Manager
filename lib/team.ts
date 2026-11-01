// Teammates get a private link /team-reply/<token>. Configure TEAM_TOKENS="TuLab:abc123,Ali Raza:def456".
export function teamTokens(): { name: string; token: string }[] {
  const raw = process.env.TEAM_TOKENS ?? (process.env.NODE_ENV !== "production" ? "TuLab:demo" : "");
  return raw
    .split(",")
    .map((p) => p.split(":").map((s) => s.trim()))
    .filter(([n, t]) => n && t)
    .map(([name, token]) => ({ name, token }));
}

export const memberForToken = (token: string) => teamTokens().find((t) => t.token === token)?.name ?? null;
