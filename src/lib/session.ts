import { queryOptions, useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import logoDark from "@/assets/aly-logo-dark.png.asset.json";

export type AppRole = Database["public"]["Enums"]["app_role"];
export type AppSettings = Database["public"]["Tables"]["app_settings"]["Row"];

export interface Me {
  id: string;
  email: string | null;
  fullName: string;
  isActive: boolean;
  role: AppRole | null;
}

export const ROLE_LABEL: Record<AppRole, string> = {
  admin: "Administrador",
  editor: "Editor",
};

export const meQuery = queryOptions({
  queryKey: ["me"],
  queryFn: async (): Promise<Me | null> => {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (!user) return null;
    const [profileRes, roleRes] = await Promise.all([
      supabase.from("profiles").select("full_name, email, is_active").eq("id", user.id).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", user.id).maybeSingle(),
    ]);
    return {
      id: user.id,
      email: profileRes.data?.email ?? user.email ?? null,
      fullName: profileRes.data?.full_name || user.email?.split("@")[0] || "Usuario",
      isActive: profileRes.data?.is_active ?? true,
      role: (roleRes.data?.role as AppRole | undefined) ?? null,
    };
  },
  staleTime: 60_000,
});

export function useMe() {
  return useQuery(meQuery);
}

export const settingsQuery = queryOptions({
  queryKey: ["settings"],
  queryFn: async (): Promise<AppSettings | null> => {
    const { data, error } = await supabase.from("app_settings").select("*").eq("id", 1).maybeSingle();
    if (error) throw error;
    return data;
  },
  staleTime: 5 * 60_000,
});

export function useSettings() {
  return useQuery(settingsQuery);
}

export interface Branding {
  businessName: string;
  tagline: string;
  logoUrl: string;
  isCustomLogo: boolean;
}

export const DEFAULT_LOGO_URL = logoDark.url;

export const brandingQuery = queryOptions({
  queryKey: ["branding"],
  queryFn: async (): Promise<Branding> => {
    const { data } = await supabase.rpc("get_public_branding");
    const row = Array.isArray(data) ? data[0] : null;
    let logoUrl = DEFAULT_LOGO_URL;
    let isCustomLogo = false;
    if (row?.logo_path) {
      const signed = await supabase.storage.from("branding").createSignedUrl(row.logo_path, 60 * 60 * 12);
      if (signed.data?.signedUrl) {
        logoUrl = signed.data.signedUrl;
        isCustomLogo = true;
      }
    }
    return {
      businessName: row?.business_name ?? "Aly",
      tagline: row?.business_tagline ?? "Creaciones con estilo",
      logoUrl,
      isCustomLogo,
    };
  },
  staleTime: 30 * 60_000,
});

export function useBranding() {
  return useQuery(brandingQuery);
}
