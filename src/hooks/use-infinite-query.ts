/**
 * @module use-infinite-query
 *
 * Provides a type-safe, cursor-based infinite scrolling hook for Supabase
 * Postgres tables. Uses an external store pattern (via useSyncExternalStore)
 * rather than React Query, giving fine-grained control over pagination state
 * while remaining compatible with server-side rendering.
 *
 * The hook automatically derives TypeScript row types from the generated
 * Supabase Database type, so callers get full autocompletion and type
 * checking on table names, columns, and returned data.
 *
 * Depends on: @supabase/supabase-js, @supabase/postgrest-js, ./supabase (generated DB types)
 * Used by: list/feed views that need "load more" pagination (e.g. exercise library, workout history)
 */

import { createClient } from "@/utils/supabase/client";
import { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { Database } from "./supabase";

const supabase = createClient();

/** The `public` schema of the database. */
type TDatabaseSchema = Database["public"];

/** Union of all table names in the public schema. */
type TSupabaseTableName = keyof TDatabaseSchema["Tables"];

/** Row type for a given table name. */
type TSupabaseTableData<T extends TSupabaseTableName> =
  TDatabaseSchema["Tables"][T]["Row"];

/**
 * Return type of `client.from(table).select(...)` for one table.
 * Instantiated from the same call the store makes, so the filter callback
 * and `.range()` share one builder type.
 */
function selectPage<T extends TSupabaseTableName>(
  tableName: T,
  columns: string,
) {
  return (supabase as SupabaseClient<Database>)
    .from(tableName)
    .select(columns, { count: "exact" });
}

type TSupabaseSelectBuilder<T extends TSupabaseTableName = TSupabaseTableName> =
  ReturnType<typeof selectPage<T>>;

/**
 * A transformer applied to the Supabase select builder before execution.
 * Use it to add filters, ordering, etc. Any `.range()` call will be
 * overwritten by the pagination logic.
 */
type TSupabaseQueryHandler<T extends TSupabaseTableName = TSupabaseTableName> =
  (query: TSupabaseSelectBuilder<T>) => TSupabaseSelectBuilder<T>;

/**
 * Configuration for {@link useInfiniteQuery}.
 *
 * @template T - A Supabase table name from the public schema.
 */
interface IUseInfiniteQueryProps<T extends TSupabaseTableName> {
  /** The Supabase table to paginate over. */
  tableName: T;
  /** PostgREST column selection string (default `"*"`). */
  columns?: string;
  /** Number of rows fetched per page (default `20`). */
  pageSize?: number;
  /** Optional query modifier for filtering/ordering. `.range()` is appended automatically. */
  trailingQuery?: TSupabaseQueryHandler<T>;
}

/** Internal pagination state managed by the external store. */
interface IStoreState<TData> {
  data: TData[];
  count: number;
  isSuccess: boolean;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  hasInitialFetch: boolean;
}

type TListener = () => void;

function rowId(row: unknown): unknown {
  if (typeof row !== "object" || row === null || !("id" in row)) {
    return undefined;
  }
  return row.id;
}

/**
 * Creates a standalone pagination store that lives outside of React's state
 * tree. This allows `useSyncExternalStore` to subscribe to it, keeping
 * renders efficient and SSR-safe (the server snapshot returns `initialState`).
 *
 * @param props - Query configuration (table, columns, page size, filters).
 * @returns An object with `getState`, `subscribe`, `fetchNextPage`, and `initialize`.
 */
function createStore<
  TData extends TSupabaseTableData<T>,
  T extends TSupabaseTableName,
>(props: IUseInfiniteQueryProps<T>) {
  const { tableName, columns = "*", pageSize = 20, trailingQuery } = props;

  let state: IStoreState<TData> = {
    data: [],
    count: 0,
    isSuccess: false,
    isLoading: false,
    isFetching: false,
    error: null,
    hasInitialFetch: false,
  };

  const listeners = new Set<TListener>();

  const notify = () => {
    listeners.forEach((listener) => listener());
  };

  const setState = (newState: Partial<IStoreState<TData>>) => {
    state = { ...state, ...newState };
    notify();
  };

  /** Fetches a single page starting at `skip`. Guards against concurrent or exhausted fetches. */
  const fetchPage = async (skip: number) => {
    if (
      state.hasInitialFetch &&
      (state.isFetching || state.count <= state.data.length)
    )
      return;

    setState({ isFetching: true });

    let query: TSupabaseSelectBuilder<T> = selectPage(tableName, columns);

    if (trailingQuery) {
      query = trailingQuery(query);
    }
    const {
      data: newData,
      count,
      error,
    } = await query.range(skip, skip + pageSize - 1);

    if (error) {
      console.error("An unexpected error occurred:", error);
      setState({ error });
    } else {
      // Deduplicate by `id` to prevent duplicates when rows shift between pages during concurrent inserts.
      const pageRows: unknown[] = Array.isArray(newData) ? newData : [];
      const deduplicatedData = pageRows.filter((item): item is TData => {
        const id = rowId(item);
        return !state.data.some((old) => rowId(old) === id);
      });
      setState({
        data: [...state.data, ...deduplicatedData],
        count: count || 0,
        isSuccess: true,
        error: null,
      });
    }
    setState({ isFetching: false });
  };

  const fetchNextPage = async () => {
    if (state.isFetching) return;
    await fetchPage(state.data.length);
  };

  const initialize = async () => {
    setState({ isLoading: true, isSuccess: false, data: [] });
    await fetchNextPage();
    setState({ isLoading: false, hasInitialFetch: true });
  };

  return {
    getState: () => state,
    subscribe: (listener: TListener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    fetchNextPage,
    initialize,
  };
}

/** SSR-safe snapshot: useSyncExternalStore returns this on the server to avoid hydration mismatches. */
const initialState: unknown = {
  data: [],
  count: 0,
  isSuccess: false,
  isLoading: false,
  isFetching: false,
  error: null,
  hasInitialFetch: false,
};

/**
 * Paginate over a Supabase table with infinite-scroll semantics.
 *
 * Manages fetch lifecycle (loading / fetching / success / error), deduplicates
 * rows by `id`, and exposes a `fetchNextPage` callback for scroll-triggered loading.
 *
 * @template TData - The row type for the target table.
 * @template T     - The table name literal.
 * @param props - Query configuration (table, columns, page size, optional query modifier).
 * @returns Paginated data, status flags, and a `fetchNextPage` trigger.
 */
function useInfiniteQuery<
  TData extends TSupabaseTableData<T>,
  T extends TSupabaseTableName = TSupabaseTableName,
>(props: IUseInfiniteQueryProps<T>) {
  const storeRef = useRef(createStore<TData, T>(props));

  const subscribe = useCallback((onStoreChange: () => void) => {
    return storeRef.current.subscribe(onStoreChange);
  }, []);

  const getSnapshot = useCallback(() => storeRef.current.getState(), []);

  const getServerSnapshot = useCallback(
    () => initialState as IStoreState<TData>,
    [],
  );

  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    // Recreate store if props change
    if (
      storeRef.current.getState().hasInitialFetch &&
      (props.tableName !== props.tableName ||
        props.columns !== props.columns ||
        props.pageSize !== props.pageSize)
    ) {
      storeRef.current = createStore<TData, T>(props);
    }

    if (!state.hasInitialFetch && typeof window !== "undefined") {
      storeRef.current.initialize();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.tableName, props.columns, props.pageSize, state.hasInitialFetch]);

  const fetchNextPage = useCallback(() => {
    return storeRef.current.fetchNextPage();
  }, []);

  return {
    data: state.data,
    count: state.count,
    isSuccess: state.isSuccess,
    isLoading: state.isLoading,
    isFetching: state.isFetching,
    error: state.error,
    hasMore: state.count > state.data.length,
    fetchNextPage,
  };
}

export {
  useInfiniteQuery,
  type TSupabaseQueryHandler,
  type TSupabaseTableData,
  type TSupabaseTableName,
  type IUseInfiniteQueryProps,
};
