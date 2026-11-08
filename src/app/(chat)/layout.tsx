import type { ReactNode } from "react";
import { ChatApp } from "@/components/chat-app";

// The chat UI lives in this shared layout so it stays mounted — streams included —
// while the URL moves between "/" and "/c/[id]". The pages themselves render nothing.
export default function ChatLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ChatApp />
      {children}
    </>
  );
}
