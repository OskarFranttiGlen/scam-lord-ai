/** Dummy Supabase env so modules that import @/api/index can load in unit tests. */
process.env.NEXT_PUBLIC_REACT_APP_SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_REACT_APP_SUPABASE_KEY ??= "test-supabase-anon-key";
process.env.NEXT_PUBLIC_REACT_APP_SUPABASE_BLOG_URL ??= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_REACT_APP_SUPABASE_BLOG_KEY ??= "test-supabase-blog-anon-key";

/**
 * Node >= 22.4 ships an experimental `localStorage` global that is undefined
 * unless --localstorage-file is passed. Its accessor sits on globalThis and
 * shadows the jsdom `window.localStorage` in DOM test environments, so bare
 * `localStorage` reads in code under test blow up. DOM environments get an
 * in-memory Storage (or a shared pointer to whichever real storage works);
 * node-environment tests keep Node's native globals untouched.
 */
function createMemoryStorage(): Storage {
    const entries = new Map<string, string>();
    return {
        get length() {
            return entries.size;
        },
        clear() {
            entries.clear();
        },
        getItem(key: string) {
            return entries.get(key) ?? null;
        },
        key(index: number) {
            return Array.from(entries.keys())[index] ?? null;
        },
        removeItem(key: string) {
            entries.delete(key);
        },
        setItem(key: string, value: string) {
            entries.set(key, String(value));
        },
    };
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
    const usable =
        [globalThis.localStorage, window.localStorage].find(
            (storage) => storage && typeof storage.getItem === "function",
        ) ?? createMemoryStorage();
    for (const target of [window, globalThis]) {
        if (target.localStorage !== usable) {
            try {
                Object.defineProperty(target, "localStorage", {
                    configurable: true,
                    writable: true,
                    value: usable,
                });
            } catch {
                // Some environments lock storage; leave that target untouched.
            }
        }
    }
}
