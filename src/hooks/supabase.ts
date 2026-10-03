/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Minimal Database stub until regenerated from prod + users/chat_history.
 * Run after migrate: `npx supabase gen types typescript --project-id ypudzainyupvwvgagrgc > src/hooks/supabase.ts`
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string | null;
          first_name: string | null;
          last_name: string | null;
          textsearchable_index_col: unknown;
          username: string | null;
          bio: string | null;
          created_at: string;
          timezone: string | null;
        };
        Insert: {
          id: string;
          email?: string | null;
          first_name?: string | null;
          last_name?: string | null;
          textsearchable_index_col?: unknown;
          username?: string | null;
          bio?: string | null;
          created_at?: string;
          timezone?: string | null;
        };
        Update: {
          id?: string;
          email?: string | null;
          first_name?: string | null;
          last_name?: string | null;
          textsearchable_index_col?: unknown;
          username?: string | null;
          bio?: string | null;
          created_at?: string;
          timezone?: string | null;
        };
        Relationships: [];
      };
      chat_history: {
        Row: {
          id: string;
          created_at: string;
          user_id: string;
          title: string;
          program_id: number | null;
          conversation: Json[] | null;
          pinned: boolean | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          user_id: string;
          title: string;
          program_id?: number | null;
          conversation?: Json[] | null;
          pinned?: boolean | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          user_id?: string;
          title?: string;
          program_id?: number | null;
          conversation?: Json[] | null;
          pinned?: boolean | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
