"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function useTotalUnread(): number {
  const [total, setTotal] = useState(0);
  const countsRef = useRef<Map<string, number>>(new Map());
  const supabaseRef = useRef(createClient());

  useEffect(() => {
    let cancelled = false;
    const supabase = supabaseRef.current;

    const fetchAll = async () => {
      try {
        const { data: rows, error } = await supabase
          .from("conversations")
          .select("id,unread_count");
        if (error || cancelled || !rows) return;
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
        const { data: rows, error } = await supabase
          .from("conversations")
          .select("id,unread_count");
        if (error || cancelled || !rows) return;
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
