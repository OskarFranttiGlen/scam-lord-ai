/* eslint-disable @typescript-eslint/naming-convention */
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
      calls: {
        Row: {
          ai_notes: Json | null
          channel: string
          conversation: Json | null
          created_at: string
          ended_at: string | null
          handoff_reason: string | null
          id: string
          jev_checks: Json
          livekit_room_name: string | null
          payment_link_sent: boolean
          photo_path: string | null
          photo_summary: string | null
          resend_email_id: string | null
          satisfaction_score: number | null
          started_at: string | null
          status: string
          stripe_invoice_id: string
          tenancy_id: string
          tenant_feedback: string | null
          transcript: string | null
          twilio_message_sid: string | null
          updated_at: string
        }
        Insert: {
          ai_notes?: Json | null
          channel?: string
          conversation?: Json | null
          created_at?: string
          ended_at?: string | null
          handoff_reason?: string | null
          id?: string
          jev_checks?: Json
          livekit_room_name?: string | null
          payment_link_sent?: boolean
          photo_path?: string | null
          photo_summary?: string | null
          resend_email_id?: string | null
          satisfaction_score?: number | null
          started_at?: string | null
          status?: string
          stripe_invoice_id: string
          tenancy_id: string
          tenant_feedback?: string | null
          transcript?: string | null
          twilio_message_sid?: string | null
          updated_at?: string
        }
        Update: {
          ai_notes?: Json | null
          channel?: string
          conversation?: Json | null
          created_at?: string
          ended_at?: string | null
          handoff_reason?: string | null
          id?: string
          jev_checks?: Json
          livekit_room_name?: string | null
          payment_link_sent?: boolean
          photo_path?: string | null
          photo_summary?: string | null
          resend_email_id?: string | null
          satisfaction_score?: number | null
          started_at?: string | null
          status?: string
          stripe_invoice_id?: string
          tenancy_id?: string
          tenant_feedback?: string | null
          transcript?: string | null
          twilio_message_sid?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calls_tenancy_id_fkey"
            columns: ["tenancy_id"]
            isOneToOne: false
            referencedRelation: "tenancies"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_history: {
        Row: {
          conversation: Json[] | null
          created_at: string
          id: string
          pinned: boolean | null
          program_id: number | null
          title: string
          user_id: string
        }
        Insert: {
          conversation?: Json[] | null
          created_at?: string
          id?: string
          pinned?: boolean | null
          program_id?: number | null
          title: string
          user_id: string
        }
        Update: {
          conversation?: Json[] | null
          created_at?: string
          id?: string
          pinned?: boolean | null
          program_id?: number | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      landlords: {
        Row: {
          created_at: string
          external_pms_id: string | null
          id: string
          name: string
          phone: string | null
          stripe_connected_account_id: string | null
          stripe_customer_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          external_pms_id?: string | null
          id?: string
          name: string
          phone?: string | null
          stripe_connected_account_id?: string | null
          stripe_customer_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          external_pms_id?: string | null
          id?: string
          name?: string
          phone?: string | null
          stripe_connected_account_id?: string | null
          stripe_customer_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      maintenance_requests: {
        Row: {
          appointment_label: string | null
          created_at: string
          description: string
          id: string
          reported_at: string
          resolved_at: string | null
          source_call_id: string | null
          status: string
          tenancy_id: string
          updated_at: string
          urgency: string
        }
        Insert: {
          appointment_label?: string | null
          created_at?: string
          description: string
          id?: string
          reported_at?: string
          resolved_at?: string | null
          source_call_id?: string | null
          status?: string
          tenancy_id: string
          updated_at?: string
          urgency?: string
        }
        Update: {
          appointment_label?: string | null
          created_at?: string
          description?: string
          id?: string
          reported_at?: string
          resolved_at?: string | null
          source_call_id?: string | null
          status?: string
          tenancy_id?: string
          updated_at?: string
          urgency?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_requests_source_call_id_fkey"
            columns: ["source_call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_requests_tenancy_id_fkey"
            columns: ["tenancy_id"]
            isOneToOne: false
            referencedRelation: "tenancies"
            referencedColumns: ["id"]
          },
        ]
      }
      office_tasks: {
        Row: {
          collection_paused_until: string | null
          created_at: string
          details: string
          due_date: string
          id: string
          source_call_id: string | null
          status: string
          stripe_invoice_id: string | null
          tenancy_id: string
          type: string
          updated_at: string
        }
        Insert: {
          collection_paused_until?: string | null
          created_at?: string
          details: string
          due_date: string
          id?: string
          source_call_id?: string | null
          status?: string
          stripe_invoice_id?: string | null
          tenancy_id: string
          type: string
          updated_at?: string
        }
        Update: {
          collection_paused_until?: string | null
          created_at?: string
          details?: string
          due_date?: string
          id?: string
          source_call_id?: string | null
          status?: string
          stripe_invoice_id?: string | null
          tenancy_id?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "office_tasks_source_call_id_fkey"
            columns: ["source_call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "office_tasks_tenancy_id_fkey"
            columns: ["tenancy_id"]
            isOneToOne: false
            referencedRelation: "tenancies"
            referencedColumns: ["id"]
          },
        ]
      }
      perks: {
        Row: {
          body: string
          condition_text: string
          created_at: string
          id: string
          landlord_id: string
          updated_at: string
        }
        Insert: {
          body: string
          condition_text: string
          created_at?: string
          id?: string
          landlord_id: string
          updated_at?: string
        }
        Update: {
          body?: string
          condition_text?: string
          created_at?: string
          id?: string
          landlord_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "perks_landlord_id_fkey"
            columns: ["landlord_id"]
            isOneToOne: false
            referencedRelation: "landlords"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          call_id: string
          created_at: string
          fee_waiver_amount: number
          id: string
          installment_amounts: number[]
          installment_count: number
          installment_dates: string[]
          perk_id: string | null
          stripe_subscription_schedule_id: string | null
          updated_at: string
        }
        Insert: {
          call_id: string
          created_at?: string
          fee_waiver_amount?: number
          id?: string
          installment_amounts: number[]
          installment_count: number
          installment_dates: string[]
          perk_id?: string | null
          stripe_subscription_schedule_id?: string | null
          updated_at?: string
        }
        Update: {
          call_id?: string
          created_at?: string
          fee_waiver_amount?: number
          id?: string
          installment_amounts?: number[]
          installment_count?: number
          installment_dates?: string[]
          perk_id?: string | null
          stripe_subscription_schedule_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plans_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plans_perk_id_fkey"
            columns: ["perk_id"]
            isOneToOne: false
            referencedRelation: "perks"
            referencedColumns: ["id"]
          },
        ]
      }
      policies: {
        Row: {
          created_at: string
          fee_waiver_cap: number
          grace_days: number
          id: string
          landlord_id: string
          max_installments: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          fee_waiver_cap: number
          grace_days: number
          id?: string
          landlord_id: string
          max_installments: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          fee_waiver_cap?: number
          grace_days?: number
          id?: string
          landlord_id?: string
          max_installments?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "policies_landlord_id_fkey"
            columns: ["landlord_id"]
            isOneToOne: true
            referencedRelation: "landlords"
            referencedColumns: ["id"]
          },
        ]
      }
      properties: {
        Row: {
          address: string
          created_at: string
          external_pms_id: string | null
          id: string
          landlord_id: string
          name: string
          updated_at: string
        }
        Insert: {
          address: string
          created_at?: string
          external_pms_id?: string | null
          id?: string
          landlord_id: string
          name: string
          updated_at?: string
        }
        Update: {
          address?: string
          created_at?: string
          external_pms_id?: string | null
          id?: string
          landlord_id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "properties_landlord_id_fkey"
            columns: ["landlord_id"]
            isOneToOne: false
            referencedRelation: "landlords"
            referencedColumns: ["id"]
          },
        ]
      }
      tenancies: {
        Row: {
          created_at: string
          email: string | null
          external_pms_id: string | null
          id: string
          language: string
          name: string
          phone: string
          stripe_customer_id: string | null
          unit_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          external_pms_id?: string | null
          id?: string
          language?: string
          name: string
          phone: string
          stripe_customer_id?: string | null
          unit_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          external_pms_id?: string | null
          id?: string
          language?: string
          name?: string
          phone?: string
          stripe_customer_id?: string | null
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenancies_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      units: {
        Row: {
          created_at: string
          external_pms_id: string | null
          id: string
          label: string
          property_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          external_pms_id?: string | null
          id?: string
          label: string
          property_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          external_pms_id?: string | null
          id?: string
          label?: string
          property_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "units_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          bio: string | null
          created_at: string
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          textsearchable_index_col: unknown
          timezone: string | null
          username: string | null
        }
        Insert: {
          bio?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id: string
          last_name?: string | null
          textsearchable_index_col?: unknown
          timezone?: string | null
          username?: string | null
        }
        Update: {
          bio?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          textsearchable_index_col?: unknown
          timezone?: string | null
          username?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      scam_lord_current_landlord_id: { Args: never; Returns: string }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
