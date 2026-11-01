export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          business_name: string
          business_tagline: string | null
          contact_info: string | null
          currency: string
          id: number
          is_demo_environment: boolean
          label_height_mm: number
          label_width_mm: number
          locale: string
          logo_path: string | null
          max_category_depth: number
          qr_base_url: string | null
          sku_digits: number
          sku_goal: number
          sku_prefix: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          business_name?: string
          business_tagline?: string | null
          contact_info?: string | null
          currency?: string
          id?: number
          is_demo_environment?: boolean
          label_height_mm?: number
          label_width_mm?: number
          locale?: string
          logo_path?: string | null
          max_category_depth?: number
          qr_base_url?: string | null
          sku_digits?: number
          sku_goal?: number
          sku_prefix?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          business_name?: string
          business_tagline?: string | null
          contact_info?: string | null
          currency?: string
          id?: number
          is_demo_environment?: boolean
          label_height_mm?: number
          label_width_mm?: number
          locale?: string
          logo_path?: string | null
          max_category_depth?: number
          qr_base_url?: string | null
          sku_digits?: number
          sku_goal?: number
          sku_prefix?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      assistant_messages: {
        Row: {
          created_at: string
          id: string
          message: Json
          message_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: Json
          message_id: string
          role: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: Json
          message_id?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      attributes: {
        Row: {
          code: string
          created_at: string
          data_type: Database["public"]["Enums"]["attribute_data_type"]
          default_unit_id: string | null
          help_text: string | null
          id: string
          is_active: boolean
          name: string
          options: string[]
          sort_order: number
        }
        Insert: {
          code: string
          created_at?: string
          data_type: Database["public"]["Enums"]["attribute_data_type"]
          default_unit_id?: string | null
          help_text?: string | null
          id?: string
          is_active?: boolean
          name: string
          options?: string[]
          sort_order?: number
        }
        Update: {
          code?: string
          created_at?: string
          data_type?: Database["public"]["Enums"]["attribute_data_type"]
          default_unit_id?: string | null
          help_text?: string | null
          id?: string
          is_active?: boolean
          name?: string
          options?: string[]
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "attributes_default_unit_id_fkey"
            columns: ["default_unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: number
          new_data: Json | null
          old_data: Json | null
          record_id: string | null
          table_name: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: never
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: never
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          created_at: string
          created_by: string | null
          depth: number
          description: string | null
          id: string
          is_active: boolean
          is_demo: boolean
          name: string
          parent_id: string | null
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          depth?: number
          description?: string | null
          id?: string
          is_active?: boolean
          is_demo?: boolean
          name: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          depth?: number
          description?: string | null
          id?: string
          is_active?: boolean
          is_demo?: boolean
          name?: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      correction_requests: {
        Row: {
          created_at: string
          id: string
          message: string
          requested_by: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["request_status"]
          variant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          requested_by?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          variant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          requested_by?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "correction_requests_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "variants"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          currency: string
          id: string
          new_cost: number | null
          previous_cost: number | null
          variant_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          currency: string
          id?: string
          new_cost?: number | null
          previous_cost?: number | null
          variant_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          currency?: string
          id?: string
          new_cost?: number | null
          previous_cost?: number | null
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cost_history_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "variants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_sessions: {
        Row: {
          closed_at: string | null
          created_by: string | null
          id: string
          is_demo: boolean
          is_open: boolean
          name: string
          started_at: string
        }
        Insert: {
          closed_at?: string | null
          created_by?: string | null
          id?: string
          is_demo?: boolean
          is_open?: boolean
          name: string
          started_at?: string
        }
        Update: {
          closed_at?: string | null
          created_by?: string | null
          id?: string
          is_demo?: boolean
          is_open?: boolean
          name?: string
          started_at?: string
        }
        Relationships: []
      }
      locations: {
        Row: {
          code: string | null
          created_at: string
          created_by: string | null
          depth: number
          description: string | null
          id: string
          is_active: boolean
          is_demo: boolean
          name: string
          parent_id: string | null
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string
          created_by?: string | null
          depth?: number
          description?: string | null
          id?: string
          is_active?: boolean
          is_demo?: boolean
          name: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string
          created_by?: string | null
          depth?: number
          description?: string | null
          id?: string
          is_active?: boolean
          is_demo?: boolean
          name?: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "locations_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      product_type_attributes: {
        Row: {
          attribute_id: string
          is_required: boolean
          is_variant_defining: boolean
          product_type_id: string
          sort_order: number
        }
        Insert: {
          attribute_id: string
          is_required?: boolean
          is_variant_defining?: boolean
          product_type_id: string
          sort_order?: number
        }
        Update: {
          attribute_id?: string
          is_required?: boolean
          is_variant_defining?: boolean
          product_type_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_type_attributes_attribute_id_fkey"
            columns: ["attribute_id"]
            isOneToOne: false
            referencedRelation: "attributes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_type_attributes_product_type_id_fkey"
            columns: ["product_type_id"]
            isOneToOne: false
            referencedRelation: "product_types"
            referencedColumns: ["id"]
          },
        ]
      }
      product_types: {
        Row: {
          created_at: string
          default_unit_id: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          default_unit_id?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          default_unit_id?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_types_default_unit_id_fkey"
            columns: ["default_unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category_id: string | null
          commercial_description: string | null
          commercial_name: string | null
          created_at: string
          created_by: string | null
          description: string | null
          ecommerce_status: Database["public"]["Enums"]["ecommerce_status"]
          id: string
          is_archived: boolean
          is_demo: boolean
          is_published: boolean
          name: string
          notes: string | null
          product_type_id: string | null
          slug: string | null
          updated_at: string
          updated_by: string | null
          usage_tags: string[]
        }
        Insert: {
          category_id?: string | null
          commercial_description?: string | null
          commercial_name?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          ecommerce_status?: Database["public"]["Enums"]["ecommerce_status"]
          id?: string
          is_archived?: boolean
          is_demo?: boolean
          is_published?: boolean
          name: string
          notes?: string | null
          product_type_id?: string | null
          slug?: string | null
          updated_at?: string
          updated_by?: string | null
          usage_tags?: string[]
        }
        Update: {
          category_id?: string | null
          commercial_description?: string | null
          commercial_name?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          ecommerce_status?: Database["public"]["Enums"]["ecommerce_status"]
          id?: string
          is_archived?: boolean
          is_demo?: boolean
          is_published?: boolean
          name?: string
          notes?: string | null
          product_type_id?: string | null
          slug?: string | null
          updated_at?: string
          updated_by?: string | null
          usage_tags?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_product_type_id_fkey"
            columns: ["product_type_id"]
            isOneToOne: false
            referencedRelation: "product_types"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string
          id: string
          is_active: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string
          id: string
          is_active?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      stock_adjustment_requests: {
        Row: {
          ai_proposal: Json | null
          applied_adjustment_id: string | null
          created_at: string
          id: string
          is_demo: boolean
          location_id: string
          mode: Database["public"]["Enums"]["adjustment_mode"]
          quantity: number
          reason: string
          requested_by: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source_text: string | null
          status: Database["public"]["Enums"]["request_status"]
          variant_id: string
        }
        Insert: {
          ai_proposal?: Json | null
          applied_adjustment_id?: string | null
          created_at?: string
          id?: string
          is_demo?: boolean
          location_id: string
          mode: Database["public"]["Enums"]["adjustment_mode"]
          quantity: number
          reason: string
          requested_by?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_text?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          variant_id: string
        }
        Update: {
          ai_proposal?: Json | null
          applied_adjustment_id?: string | null
          created_at?: string
          id?: string
          is_demo?: boolean
          location_id?: string
          mode?: Database["public"]["Enums"]["adjustment_mode"]
          quantity?: number
          reason?: string
          requested_by?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_text?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_adjustment_requests_applied_adjustment_id_fkey"
            columns: ["applied_adjustment_id"]
            isOneToOne: false
            referencedRelation: "stock_adjustments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustment_requests_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustment_requests_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "variants"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_adjustments: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_demo: boolean
          location_id: string
          new_quantity: number
          previous_quantity: number
          reason: string
          variant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_demo?: boolean
          location_id: string
          new_quantity: number
          previous_quantity: number
          reason: string
          variant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_demo?: boolean
          location_id?: string
          new_quantity?: number
          previous_quantity?: number
          reason?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_adjustments_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "variants"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_counts: {
        Row: {
          capture_ref: string | null
          conversion_factor: number | null
          counted_at: string
          counted_by: string | null
          full_presentations: number | null
          id: string
          idempotency_key: string | null
          is_demo: boolean
          location_id: string
          loose_quantity: number | null
          notes: string | null
          quantity: number
          reviewed_at: string | null
          reviewed_by: string | null
          session_id: string
          status: Database["public"]["Enums"]["count_entry_status"]
          variant_id: string
        }
        Insert: {
          capture_ref?: string | null
          conversion_factor?: number | null
          counted_at?: string
          counted_by?: string | null
          full_presentations?: number | null
          id?: string
          idempotency_key?: string | null
          is_demo?: boolean
          location_id: string
          loose_quantity?: number | null
          notes?: string | null
          quantity: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          session_id: string
          status?: Database["public"]["Enums"]["count_entry_status"]
          variant_id: string
        }
        Update: {
          capture_ref?: string | null
          conversion_factor?: number | null
          counted_at?: string
          counted_by?: string | null
          full_presentations?: number | null
          id?: string
          idempotency_key?: string | null
          is_demo?: boolean
          location_id?: string
          loose_quantity?: number | null
          notes?: string | null
          quantity?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          session_id?: string
          status?: Database["public"]["Enums"]["count_entry_status"]
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_counts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_counts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "inventory_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_counts_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "variants"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_levels: {
        Row: {
          counted_at: string
          counted_by: string | null
          is_demo: boolean
          location_id: string
          quantity: number
          updated_at: string
          updated_by: string | null
          variant_id: string
        }
        Insert: {
          counted_at?: string
          counted_by?: string | null
          is_demo?: boolean
          location_id: string
          quantity: number
          updated_at?: string
          updated_by?: string | null
          variant_id: string
        }
        Update: {
          counted_at?: string
          counted_by?: string | null
          is_demo?: boolean
          location_id?: string
          quantity?: number
          updated_at?: string
          updated_by?: string | null
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_levels_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_levels_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "variants"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_minimums: {
        Row: {
          created_at: string
          created_by: string | null
          is_demo: boolean
          location_id: string
          min_quantity: number
          notes: string | null
          updated_at: string
          updated_by: string | null
          variant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          is_demo?: boolean
          location_id: string
          min_quantity: number
          notes?: string | null
          updated_at?: string
          updated_by?: string | null
          variant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          is_demo?: boolean
          location_id?: string
          min_quantity?: number
          notes?: string | null
          updated_at?: string
          updated_by?: string | null
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_minimums_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_minimums_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "variants"
            referencedColumns: ["id"]
          },
        ]
      }
      units: {
        Row: {
          allows_decimal: boolean
          code: string
          created_at: string
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["unit_kind"]
          name_plural: string
          name_singular: string
          sort_order: number
          symbol: string | null
        }
        Insert: {
          allows_decimal?: boolean
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          kind: Database["public"]["Enums"]["unit_kind"]
          name_plural: string
          name_singular: string
          sort_order?: number
          symbol?: string | null
        }
        Update: {
          allows_decimal?: boolean
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["unit_kind"]
          name_plural?: string
          name_singular?: string
          sort_order?: number
          symbol?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      variant_attribute_values: {
        Row: {
          attribute_id: string
          unit_id: string | null
          updated_at: string
          updated_by: string | null
          value_number: number | null
          value_options: string[] | null
          value_state: Database["public"]["Enums"]["attribute_value_state"]
          value_text: string | null
          variant_id: string
        }
        Insert: {
          attribute_id: string
          unit_id?: string | null
          updated_at?: string
          updated_by?: string | null
          value_number?: number | null
          value_options?: string[] | null
          value_state?: Database["public"]["Enums"]["attribute_value_state"]
          value_text?: string | null
          variant_id: string
        }
        Update: {
          attribute_id?: string
          unit_id?: string | null
          updated_at?: string
          updated_by?: string | null
          value_number?: number | null
          value_options?: string[] | null
          value_state?: Database["public"]["Enums"]["attribute_value_state"]
          value_text?: string | null
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "variant_attribute_values_attribute_id_fkey"
            columns: ["attribute_id"]
            isOneToOne: false
            referencedRelation: "attributes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_attribute_values_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_attribute_values_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "variants"
            referencedColumns: ["id"]
          },
        ]
      }
      variant_costs: {
        Row: {
          cost_per_base_unit: number
          currency: string
          is_demo: boolean
          updated_at: string
          updated_by: string | null
          variant_id: string
        }
        Insert: {
          cost_per_base_unit: number
          currency?: string
          is_demo?: boolean
          updated_at?: string
          updated_by?: string | null
          variant_id: string
        }
        Update: {
          cost_per_base_unit?: number
          currency?: string
          is_demo?: boolean
          updated_at?: string
          updated_by?: string | null
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "variant_costs_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: true
            referencedRelation: "variants"
            referencedColumns: ["id"]
          },
        ]
      }
      variant_images: {
        Row: {
          alt_text: string | null
          id: string
          is_demo: boolean
          is_primary: boolean
          sort_order: number
          storage_path: string
          thumbnail_path: string | null
          uploaded_at: string
          uploaded_by: string | null
          variant_id: string
        }
        Insert: {
          alt_text?: string | null
          id?: string
          is_demo?: boolean
          is_primary?: boolean
          sort_order?: number
          storage_path: string
          thumbnail_path?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
          variant_id: string
        }
        Update: {
          alt_text?: string | null
          id?: string
          is_demo?: boolean
          is_primary?: boolean
          sort_order?: number
          storage_path?: string
          thumbnail_path?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "variant_images_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "variants"
            referencedColumns: ["id"]
          },
        ]
      }
      variants: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          base_unit_id: string
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          created_by: string | null
          defining_signature: string | null
          id: string
          idempotency_key: string | null
          is_demo: boolean
          legacy_code: string | null
          notes: string | null
          photo_status: Database["public"]["Enums"]["photo_status"]
          presentation_unit_id: string | null
          product_id: string
          record_status: Database["public"]["Enums"]["record_status"]
          review_status: Database["public"]["Enums"]["review_status"]
          sku: string | null
          supplier_code: string | null
          units_per_presentation: number | null
          updated_at: string
          updated_by: string | null
          variant_label: string | null
          version: number
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          base_unit_id: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          defining_signature?: string | null
          id?: string
          idempotency_key?: string | null
          is_demo?: boolean
          legacy_code?: string | null
          notes?: string | null
          photo_status?: Database["public"]["Enums"]["photo_status"]
          presentation_unit_id?: string | null
          product_id: string
          record_status?: Database["public"]["Enums"]["record_status"]
          review_status?: Database["public"]["Enums"]["review_status"]
          sku?: string | null
          supplier_code?: string | null
          units_per_presentation?: number | null
          updated_at?: string
          updated_by?: string | null
          variant_label?: string | null
          version?: number
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          base_unit_id?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          defining_signature?: string | null
          id?: string
          idempotency_key?: string | null
          is_demo?: boolean
          legacy_code?: string | null
          notes?: string | null
          photo_status?: Database["public"]["Enums"]["photo_status"]
          presentation_unit_id?: string | null
          product_id?: string
          record_status?: Database["public"]["Enums"]["record_status"]
          review_status?: Database["public"]["Enums"]["review_status"]
          sku?: string | null
          supplier_code?: string | null
          units_per_presentation?: number | null
          updated_at?: string
          updated_by?: string | null
          variant_label?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "variants_base_unit_id_fkey"
            columns: ["base_unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variants_presentation_unit_id_fkey"
            columns: ["presentation_unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_stock_adjustment: {
        Args: {
          _location_id: string
          _mode: Database["public"]["Enums"]["adjustment_mode"]
          _quantity: number
          _reason: string
          _variant_id: string
        }
        Returns: string
      }
      bootstrap_first_admin: { Args: { _email: string }; Returns: undefined }
      category_product_counts: {
        Args: never
        Returns: {
          category_id: string
          product_count: number
        }[]
      }
      delete_category: {
        Args: { _id: string; _reassign?: boolean; _reassign_to?: string }
        Returns: undefined
      }
      delete_location: { Args: { _id: string }; Returns: undefined }
      generate_sku: { Args: never; Returns: string }
      get_public_branding: {
        Args: never
        Returns: {
          business_name: string
          business_tagline: string
          logo_path: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      list_stock_minimums: {
        Args: {
          _limit?: number
          _offset?: number
          _only_alerts?: boolean
          _search?: string
        }
        Returns: {
          allows_decimal: boolean
          counted_at: string
          location_id: string
          min_quantity: number
          product_name: string
          quantity: number
          record_status: Database["public"]["Enums"]["record_status"]
          sku: string
          total_count: number
          unit_plural: string
          unit_singular: string
          updated_at: string
          variant_id: string
          variant_label: string
        }[]
      }
      location_stock_counts: {
        Args: never
        Returns: {
          location_id: string
          sku_count: number
        }[]
      }
      low_stock_summary: {
        Args: never
        Returns: {
          below_count: number
          configured_count: number
          pending_count: number
        }[]
      }
      review_adjustment_request: {
        Args: { _approve: boolean; _id: string; _note?: string }
        Returns: string
      }
      search_variants: {
        Args: { _limit?: number; _q: string }
        Returns: {
          allows_decimal: boolean
          id: string
          product_name: string
          record_status: Database["public"]["Enums"]["record_status"]
          sku: string
          unit_plural: string
          unit_singular: string
          variant_label: string
        }[]
      }
      set_user_active: {
        Args: { _active: boolean; _user_id: string }
        Returns: undefined
      }
      set_user_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: undefined
      }
      suggest_variant_candidates: {
        Args: { _limit?: number; _text: string }
        Returns: {
          allows_decimal: boolean
          attributes: string
          id: string
          product_name: string
          product_type: string
          score: number
          sku: string
          unit_plural: string
          unit_singular: string
          variant_label: string
        }[]
      }
    }
    Enums: {
      adjustment_mode: "set" | "increase" | "decrease"
      app_role: "admin" | "editor"
      attribute_data_type: "text" | "number" | "select" | "multiselect"
      attribute_value_state: "value" | "not_applicable" | "pending"
      count_entry_status: "confirmed" | "in_review" | "rejected"
      ecommerce_status: "not_ready" | "in_preparation" | "ready"
      photo_status: "pending" | "uploaded" | "approved"
      record_status: "draft" | "registered" | "archived"
      request_status: "open" | "resolved" | "rejected"
      review_status: "pending" | "validated"
      unit_kind: "inventory" | "measure"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      adjustment_mode: ["set", "increase", "decrease"],
      app_role: ["admin", "editor"],
      attribute_data_type: ["text", "number", "select", "multiselect"],
      attribute_value_state: ["value", "not_applicable", "pending"],
      count_entry_status: ["confirmed", "in_review", "rejected"],
      ecommerce_status: ["not_ready", "in_preparation", "ready"],
      photo_status: ["pending", "uploaded", "approved"],
      record_status: ["draft", "registered", "archived"],
      request_status: ["open", "resolved", "rejected"],
      review_status: ["pending", "validated"],
      unit_kind: ["inventory", "measure"],
    },
  },
} as const
