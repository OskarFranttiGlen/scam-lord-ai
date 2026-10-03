/**
 * @module api/artifacts
 *
 * Server-safe Chat artifact load/save against `public.artifacts`. Callers pass
 * the Supabase client. Does not import the browser client or any fitness /
 * Hevy / program-prescription helpers (ADR 0034 slice 2).
 *
 * Depends on: @supabase/supabase-js, @/hooks/supabase
 * Used by: Artifact CRUD tools (later slices), dashboard persistence
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/hooks/supabase";

type TSupabase = SupabaseClient<Database>;

/**
 * Document shapes are ambient globals in `@types/global.d.ts` (ADR 0034 / 03).
 * Keep this alias for callers that prefer an explicit Artifact item import name.
 */
export type TArtifactItemDocument = TArtifactItem;

export type TArtifactRow = {
  id: string;
  user_id: string;
  title: string | null;
  document: TChatArtifactDocument;
  created_at: string;
  updated_at: string;
};

export const EMPTY_CHAT_ARTIFACT_DOCUMENT: TChatArtifactDocument = {
  title: "",
  weeks: [],
};

/**
 * Narrows jsonb into the Chat artifact document shape.
 * Unknown or malformed payloads become an empty document.
 *
 * @param value - Raw jsonb from Supabase
 */
export function parseChatArtifactDocument(
  value: unknown,
): TChatArtifactDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...EMPTY_CHAT_ARTIFACT_DOCUMENT };
  }

  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title : "";
  const weeksRaw = Array.isArray(record.weeks) ? record.weeks : [];

  const weeks: TArtifactWeekDocument[] = weeksRaw.map((week) => {
    if (!week || typeof week !== "object" || Array.isArray(week)) {
      return { days: [] };
    }
    const weekRecord = week as Record<string, unknown>;
    const daysRaw = Array.isArray(weekRecord.days) ? weekRecord.days : [];
    const days: TArtifactDayDocument[] = daysRaw.map((day) => {
      if (!day || typeof day !== "object" || Array.isArray(day)) {
        return { id: "", title: "", items: [] };
      }
      const dayRecord = day as Record<string, unknown>;
      const itemsRaw = Array.isArray(dayRecord.items) ? dayRecord.items : [];
      const items: TArtifactItemDocument[] = itemsRaw.map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return { id: "", title: "" };
        }
        const itemRecord = item as Record<string, unknown>;
        const parsed: TArtifactItemDocument = {
          id: typeof itemRecord.id === "string" ? itemRecord.id : "",
          title: typeof itemRecord.title === "string" ? itemRecord.title : "",
        };
        if (typeof itemRecord.notes === "string") {
          parsed.notes = itemRecord.notes;
        }
        return parsed;
      });
      return {
        id: typeof dayRecord.id === "string" ? dayRecord.id : "",
        title: typeof dayRecord.title === "string" ? dayRecord.title : "",
        items,
      };
    });
    return { days };
  });

  return { title, weeks };
}

function toArtifactRow(row: {
  id: string;
  user_id: string;
  title: string | null;
  document: Json;
  created_at: string;
  updated_at: string;
}): TArtifactRow {
  return {
    id: row.id,
    user_id: row.user_id,
    title: row.title,
    document: parseChatArtifactDocument(row.document),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Serialize a Chat artifact document into Supabase jsonb.
 * `artifacts.document` is `jsonb NOT NULL`, so the generated insert type is
 * `NonNullable<Json>`. `JSON.stringify` of an object never yields null.
 */
function chatArtifactDocumentToJson(
  document: TChatArtifactDocument,
): NonNullable<Json> {
  return JSON.parse(JSON.stringify(document)) as NonNullable<Json>;
}

/**
 * Loads one Chat artifact owned by the authenticated user.
 *
 * @param client - RLS-bound Supabase client
 * @param userId - Authenticated user id
 * @param artifactId - Artifact row id
 */
export async function getArtifactById(
  client: TSupabase,
  userId: string,
  artifactId: string,
): Promise<TArtifactRow | null> {
  const { data, error } = await client
    .from("artifacts")
    .select("id, user_id, title, document, created_at, updated_at")
    .eq("user_id", userId)
    .eq("id", artifactId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return toArtifactRow(data);
}

/**
 * Inserts a new Chat artifact for the authenticated user.
 *
 * @param client - RLS-bound Supabase client
 * @param userId - Authenticated user id
 * @param document - Chat artifact JSON document
 * @param options.id - Optional caller-supplied uuid
 */
export async function createArtifact(
  client: TSupabase,
  userId: string,
  document: TChatArtifactDocument,
  options?: { id?: string },
): Promise<TArtifactRow | null> {
  const title = document.title.trim() || null;
  const insertRow = {
    user_id: userId,
    title,
    document: chatArtifactDocumentToJson(document),
    ...(options?.id ? { id: options.id } : {}),
  };

  const { data, error } = await client
    .from("artifacts")
    .insert(insertRow)
    .select("id, user_id, title, document, created_at, updated_at")
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return toArtifactRow(data);
}

/**
 * Replaces the JSON document (and denormalized title) for one owned artifact.
 *
 * @param client - RLS-bound Supabase client
 * @param userId - Authenticated user id
 * @param artifactId - Artifact row id
 * @param document - Next Chat artifact JSON document
 */
export async function saveArtifactDocument(
  client: TSupabase,
  userId: string,
  artifactId: string,
  document: TChatArtifactDocument,
): Promise<TArtifactRow | null> {
  const title = document.title.trim() || null;

  const { data, error } = await client
    .from("artifacts")
    .update({
      title,
      document: chatArtifactDocumentToJson(document),
    })
    .eq("user_id", userId)
    .eq("id", artifactId)
    .select("id, user_id, title, document, created_at, updated_at")
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return toArtifactRow(data);
}
