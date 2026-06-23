"use client";

import { useEffect, useRef, useState } from "react";

export function useTotalUnread(): number {
  const [total, setTotal] = useState(0);
  const countsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    let cancelled = false;

    const fetchAll = async () => {
      try {
        const res = await fetch("/api/data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "select",
            table: "conversations",
            select: "id,unread_count",
          }),
        });
        const json = await res.json();
        if (cancelled || json.error || !json.data) return;
        const rows = json.data as { id: string; unread_count: number }[];
        const map = new Map<string, number>();
        let sum = 0;
        for (const row of rows) {
          const n = row.unread_count ?? 0;
          map.set(row.id, n);
          if (n > 0) sum += 1;
        }
        countsRef.current = map;
        setTotal(sum);
      } catch {
        return;
      }
    };

    fetchAll();

    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "select",
            table: "conversations",
            select: "id,unread_count",
          }),
        });
        const json = await res.json();
        if (cancelled || json.error || !json.data) return;
        const rows = json.data as { id: string; unread_count: number }[];
        const map = countsRef.current;
        for (const row of rows) {
          map.set(row.id, row.unread_count ?? 0);
        }
        const fetchedIds = new Set(rows.map((r) => r.id));
        for (const id of map.keys()) {
          if (!fetchedIds.has(id)) map.delete(id);
        }
        let sum = 0;
        for (const n of map.values()) if (n > 0) sum += 1;
        setTotal(sum);
      } catch {
        return;
      }
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return total;
}
