import { queryOptions, useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export const lowStockSummaryQuery = queryOptions({
  queryKey: ["stock-alerts", "summary"],
  queryFn: async () => {
    const { data, error } = await supabase.rpc("low_stock_summary");
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : null;
    return {
      below: Number(row?.below_count ?? 0),
      pending: Number(row?.pending_count ?? 0),
      configured: Number(row?.configured_count ?? 0),
    };
  },
  staleTime: 30_000,
  refetchInterval: 60_000,
});

export function useLowStockSummary(enabled = true) {
  return useQuery({ ...lowStockSummaryQuery, enabled });
}

export interface MinimumRow {
  variant_id: string;
  location_id: string;
  sku: string | null;
  product_name: string;
  variant_label: string | null;
  record_status: "draft" | "registered" | "archived";
  min_quantity: number;
  quantity: number | null;
  unit_singular: string;
  unit_plural: string;
  allows_decimal: boolean;
  counted_at: string | null;
  updated_at: string;
  total_count: number;
}

export function minimumsQuery(params: { search: string; onlyAlerts: boolean; page: number; pageSize: number }) {
  return queryOptions({
    queryKey: ["stock-alerts", "list", params],
    queryFn: async (): Promise<{ rows: MinimumRow[]; total: number }> => {
      const { data, error } = await supabase.rpc("list_stock_minimums", {
        _search: params.search,
        _only_alerts: params.onlyAlerts,
        _limit: params.pageSize,
        _offset: params.page * params.pageSize,
      });
      if (error) throw error;
      const rows = (data ?? []).map((r) => ({
        ...r,
        min_quantity: Number(r.min_quantity),
        quantity: r.quantity === null ? null : Number(r.quantity),
        total_count: Number(r.total_count),
      })) as MinimumRow[];
      return { rows, total: rows[0]?.total_count ?? 0 };
    },
    placeholderData: (prev) => prev,
  });
}
