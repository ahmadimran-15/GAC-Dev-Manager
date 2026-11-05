"use client";
import { Component, type ReactNode } from "react";

// Keeps one broken piece from taking the whole page down. Without it a render error anywhere in a
// chat gives the blank "Application error: a client-side exception has occurred" screen, which says
// nothing about what failed; this shows the message and leaves the rest of the page usable.

interface Props {
  children: ReactNode;
  what?: string; // what failed, in words: "this chat"
}

export default class Guard extends Component<Props, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    // Moving to another chat should clear the last one's error rather than stay stuck on it.
    if (prev.children !== this.props.children && this.state.error) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="p-6 text-[13px]">
        <p className="font-medium text-[var(--red)]">Something in {this.props.what ?? "this page"} could not be shown.</p>
        <p className="mt-1 text-[var(--ink-2)]">The rest still works. Send this line to your manager:</p>
        <code className="mt-2 block break-words rounded-lg bg-[var(--bg)] px-3 py-2 text-[12px]">{error.message || String(error)}</code>
        <button className="btn btn-sm mt-3" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}
