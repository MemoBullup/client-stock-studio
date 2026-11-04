import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export interface DashboardOverview {
  registered: number;
  pending_review: number;
  pending_count: number;
  pending_photo: number;
  today: number;
  my_drafts: number;
  unclassified: { skus: number; counted: number };
  categories: Array<{
    id: string;
    name: string;
    skus: number;
    counted: number;
    photographed: number;
  }>;
}

export interface AdminDashboard {
  registered: number;
  cost_pending: number;
  counted: number;
  valued: number;
  counted_without_cost: number;
  valuation: Array<{ currency: string; value: number; skus: number }>;
  activity: Array<{
    user_id: string;
    name: string;
    total: number;
    today: number;
    week: number;
    drafts: number;
    counts_today: number;
  }>;
}

export function startOfTodayIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function useDashboard() {
  return useQuery({
    queryKey: ["dashboard", "overview"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_overview", {
        _today_start: startOfTodayIso(),
      });
      if (error) throw error;
      return data as unknown as DashboardOverview;
    },
    staleTime: 30_000,
  });
}

export function useAdminDashboard(enabled: boolean) {
  return useQuery({
    queryKey: ["dashboard", "admin"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_dashboard", {
        _today_start: startOfTodayIso(),
      });
      if (error) throw error;
      return data as unknown as AdminDashboard;
    },
    staleTime: 30_000,
  });
}

/** Porcentaje con un decimal; 0 si no hay base. */
export function pct(part: number, whole: number): number {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10;
}
