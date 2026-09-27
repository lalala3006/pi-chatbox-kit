import { createContext, useContext, type ReactNode } from "react";
import type { ChatboxClient } from "../client/index.js";

const ClientContext = createContext<ChatboxClient | null>(null);

export function ChatboxProvider({ client, children }: { client: ChatboxClient; children: ReactNode }) {
  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>;
}

export function useClient(override?: ChatboxClient): ChatboxClient {
  const inherited = useContext(ClientContext);
  if (!override && !inherited) throw new Error("ChatboxProvider or client is required");
  return (override ?? inherited)!;
}
