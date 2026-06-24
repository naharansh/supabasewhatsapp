"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type { Message, Conversation } from "@/types";
interface RealtimeEvent<T> {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: T;
  old: Partial<T>;
}

interface UseRealtimeOptions {
  channelName: string;
  onMessageEvent?: (event: RealtimeEvent<Message>) => void;
  onConversationEvent?: (event: RealtimeEvent<Conversation>) => void;
  enabled?: boolean;
}

async function fetchAll<T extends { id: string }>(
  table: string,
  select?: string,
  filters?: { column: string; operator: string; value: unknown }[]
): Promise<T[]> {
  try {
    const res = await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "select",
        table,
        ...(select ? { select } : {}),
        ...(filters ? { filters } : {}),
      }),
    });
    const json = await res.json();
    if (json.error) return [];
    return (json.data as T[]) ?? [];
  } catch {
    return [];
  }
}

export function useRealtime({
  onMessageEvent,
  onConversationEvent,
  enabled = true,
}: UseRealtimeOptions) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevMessagesRef = useRef<Map<string, Message>>(new Map());
  const prevConversationsRef = useRef<Map<string, Conversation>>(new Map());
  const [isConnected, setIsConnected] = useState(false);

  const onMessageRef = useRef(onMessageEvent);
  const onConversationRef = useRef(onConversationEvent);
  useEffect(() => {
    onMessageRef.current = onMessageEvent;
    onConversationRef.current = onConversationEvent;
  });

  useEffect(() => {
    if (!enabled) return;

    setIsConnected(true);

    intervalRef.current = setInterval(async () => {
      // Only poll recent messages (last 72 hours) to keep payloads small
      const recentCutoff = new Date(
        Date.now() - 72 * 60 * 60 * 1000
      ).toISOString();
      const [messages, conversations] = await Promise.all([
        fetchAll<Message>("messages", undefined, [
          { column: "created_at", operator: "gte", value: recentCutoff },
        ]),
        fetchAll<Conversation>("conversations", "*, contact:contacts(*)"),
      ]);

      const prevMessages = prevMessagesRef.current;
      const prevConversations = prevConversationsRef.current;

      // Detect message changes
      const messageIds = new Set(messages.map((m) => m.id));
      for (const m of messages) {
        const prev = prevMessages.get(m.id);
        if (!prev) {
          onMessageRef.current?.({ eventType: "INSERT", new: m, old: {} });
        } else if (JSON.stringify(prev) !== JSON.stringify(m)) {
          onMessageRef.current?.({ eventType: "UPDATE", new: m, old: prev });
        }
      }
      for (const id of prevMessages.keys()) {
        if (!messageIds.has(id)) {
          const old = prevMessages.get(id)!;
          onMessageRef.current?.({ eventType: "DELETE", new: {} as Message, old });
        }
      }

      // Detect conversation changes
      const conversationIds = new Set(conversations.map((c) => c.id));
      for (const c of conversations) {
        const prev = prevConversations.get(c.id);
        if (!prev) {
          onConversationRef.current?.({
            eventType: "INSERT",
            new: c,
            old: {},
          });
        } else if (JSON.stringify(prev) !== JSON.stringify(c)) {
          onConversationRef.current?.({
            eventType: "UPDATE",
            new: c,
            old: prev,
          });
        }
      }
      for (const id of prevConversations.keys()) {
        if (!conversationIds.has(id)) {
          const old = prevConversations.get(id)!;
          onConversationRef.current?.({
            eventType: "DELETE",
            new: {} as Conversation,
            old,
          });
        }
      }

      prevMessagesRef.current = new Map(messages.map((m) => [m.id, m]));
      prevConversationsRef.current = new Map(
        conversations.map((c) => [c.id, c])
      );
    }, 2000);

    return () => {
      setIsConnected(false);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled]);

  const unsubscribe = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsConnected(false);
  }, []);

  return { isConnected, unsubscribe };
}
