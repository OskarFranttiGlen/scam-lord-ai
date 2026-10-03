#!/usr/bin/env node
/**
 * Scrape every discussion in one Sample Workspace category into
 * data/sample-workspace/raw/<category-slug>/discussions.jsonl.
 *
 * Layout (raw is gitignored):
 *   raw/categories.json
 *   raw/authors.jsonl                         # shared across categories
 *   raw/questions/discussions.jsonl           # Feedback Items
 *   raw/troubleshooting/discussions.jsonl     # Feedback Items
 *   raw/feature-requests/discussions.jsonl    # Idea candidates only
 *
 * Usage:
 *   # put GITHUB_TOKEN=... or GH_TOKEN=... in .env.local, then:
 *   node scripts/scrape-one-discussion.mjs questions
 *   node scripts/scrape-one-discussion.mjs troubleshooting
 *   node scripts/scrape-one-discussion.mjs feature-requests
 *   node scripts/scrape-one-discussion.mjs questions --limit=20   # smoke / resume test
 *
 * Re-runs upsert by discussion number (safe to interrupt and restart).
 *
 * After scraping, fetch commenter profiles (dataset only, no scoring yet):
 *   node scripts/enrich-authors.mjs
 * Optional table-shaped export:
 *   node scripts/build-processed.mjs
 */

import { config } from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

config({ path: resolve(process.cwd(), ".env.local") });

const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const OWNER = "supabase";
const NAME = "supabase";
const PAGE_SIZE = 50;
const MIN_RATE_REMAINING = 200;
const PAGE_PAUSE_MS = 250;

/** Categories we scrape for Sample Workspace (ADR 0035). */
const SCRAPE_CATEGORIES = {
    questions: {
        name: "Questions",
        slug: "questions",
        role: "feedback",
    },
    troubleshooting: {
        name: "Troubleshooting",
        slug: "troubleshooting",
        role: "feedback",
    },
    "feature-requests": {
        name: "Feature Requests",
        slug: "feature-requests",
        role: "ideas_only",
    },
};

const DEFAULT_SLUG = "questions";
const RAW_DIR = resolve(process.cwd(), "data/sample-workspace/raw");
const AUTHORS_PATH = resolve(RAW_DIR, "authors.jsonl");
const CATEGORIES_PATH = resolve(RAW_DIR, "categories.json");

const args = process.argv.slice(2);
const requestedSlug = (args.find((a) => !a.startsWith("--")) ?? DEFAULT_SLUG).toLowerCase();
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : null;
if (limitArg && (!Number.isFinite(limit) || limit < 1)) {
    console.error("Invalid --limit=N (positive number required).");
    process.exit(1);
}

const scrapeTarget = SCRAPE_CATEGORIES[requestedSlug];
if (!scrapeTarget) {
    console.error(
        `Unknown category slug "${requestedSlug}". Use: ${Object.keys(SCRAPE_CATEGORIES).join(", ")}`,
    );
    process.exit(1);
}

if (!TOKEN) {
    console.error("Set GITHUB_TOKEN or GH_TOKEN in .env.local first.");
    console.error("Create at https://github.com/settings/tokens");
    console.error("  Classic: enable read:discussion");
    console.error("  Fine-grained: Permissions → Discussions → Read-only");
    process.exit(1);
}

async function ghGraphQL(query, variables = {}, attempt = 1) {
    const res = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${TOKEN}`,
            "Content-Type": "application/json",
            "User-Agent": "shipworthy-sample-workspace-scrape",
        },
        body: JSON.stringify({ query, variables }),
    });

    if (res.status === 502 || res.status === 503 || res.status === 429) {
        if (attempt >= 6) {
            console.error(`GitHub HTTP ${res.status} after ${attempt} attempts.`);
            process.exit(1);
        }
        const retryAfter = Number(res.headers.get("retry-after"));
        const waitMs = Number.isFinite(retryAfter)
            ? retryAfter * 1000
            : Math.min(60_000, 1000 * 2 ** attempt);
        console.warn(`HTTP ${res.status}; sleeping ${waitMs}ms (attempt ${attempt})`);
        await sleep(waitMs);
        return ghGraphQL(query, variables, attempt + 1);
    }

    const json = await res.json();
    if (!res.ok || json.errors) {
        console.error(JSON.stringify(json, null, 2));
        process.exit(1);
    }
    return json.data;
}

async function respectRateLimit(rateLimit) {
    if (!rateLimit) {
        return;
    }
    if (rateLimit.remaining > MIN_RATE_REMAINING) {
        return;
    }
    const resetAtMs = new Date(rateLimit.resetAt).getTime();
    const waitMs = Math.max(0, resetAtMs - Date.now()) + 1000;
    console.warn(
        `rateLimit.remaining=${rateLimit.remaining}; sleeping ${waitMs}ms until ${rateLimit.resetAt}`,
    );
    await sleep(waitMs);
}

async function readJsonl(path) {
    try {
        const text = await readFile(path, "utf8");
        return text
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line));
    } catch (err) {
        if (err && err.code === "ENOENT") {
            return [];
        }
        throw err;
    }
}

async function writeJsonl(path, rows) {
    const body =
        rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");
    await writeFile(path, body, "utf8");
}

function toMap(rows, key) {
    return new Map(rows.map((row) => [row[key], row]));
}

function mapToRows(map) {
    return [...map.values()];
}

const categoriesQuery = `
query ($owner: String!, $name: String!) {
  rateLimit { remaining resetAt }
  repository(owner: $owner, name: $name) {
    discussionCategories(first: 20) {
      nodes { id name slug }
    }
  }
}
`;

const pageQuery = `
query (
  $owner: String!
  $name: String!
  $categoryId: ID!
  $pageSize: Int!
  $cursor: String
) {
  rateLimit { remaining resetAt }
  repository(owner: $owner, name: $name) {
    discussions(first: $pageSize, after: $cursor, categoryId: $categoryId) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        number
        title
        url
        createdAt
        category { name slug }
        author { login }
        body
      }
    }
  }
}
`;

await mkdir(RAW_DIR, { recursive: true });
await mkdir(resolve(process.cwd(), "data/sample-workspace/processed"), {
    recursive: true,
});
for (const cat of Object.values(SCRAPE_CATEGORIES)) {
    await mkdir(resolve(RAW_DIR, cat.slug), { recursive: true });
}

const meta = await ghGraphQL(categoriesQuery, { owner: OWNER, name: NAME });
await respectRateLimit(meta.rateLimit);
const categories = meta.repository.discussionCategories.nodes;
await writeFile(CATEGORIES_PATH, JSON.stringify(categories, null, 2) + "\n", "utf8");

const preferred =
    categories.find((c) => c.slug === scrapeTarget.slug) ??
    categories.find((c) => c.name === scrapeTarget.name);
if (!preferred) {
    console.error(
        `Category not found on repo: ${scrapeTarget.name} (${scrapeTarget.slug})`,
    );
    process.exit(1);
}

const categoryDir = resolve(RAW_DIR, scrapeTarget.slug);
const discussionsPath = resolve(categoryDir, "discussions.jsonl");

const discussionMap = toMap(await readJsonl(discussionsPath), "number");
const authorMap = toMap(await readJsonl(AUTHORS_PATH), "login");

let cursor = null;
let page = 0;
let fetchedThisRun = 0;
let appended = 0;
let updated = 0;

console.log(
    JSON.stringify({
        starting: {
            category: preferred.name,
            slug: scrapeTarget.slug,
            role: scrapeTarget.role,
            existingDiscussions: discussionMap.size,
            limit: limit ?? "all",
            path: discussionsPath,
        },
    }),
);

while (true) {
    if (limit != null && fetchedThisRun >= limit) {
        break;
    }

    const pageSize =
        limit == null ? PAGE_SIZE : Math.min(PAGE_SIZE, limit - fetchedThisRun);

    const data = await ghGraphQL(pageQuery, {
        owner: OWNER,
        name: NAME,
        categoryId: preferred.id,
        pageSize,
        cursor,
    });
    await respectRateLimit(data.rateLimit);

    const conn = data.repository.discussions;
    const scrapedAt = new Date().toISOString();
    page += 1;

    for (const post of conn.nodes) {
        const row = {
            source: "github_discussion",
            repo: `${OWNER}/${NAME}`,
            role: scrapeTarget.role,
            id: post.id,
            number: post.number,
            title: post.title,
            url: post.url,
            createdAt: post.createdAt,
            category: post.category.name,
            categorySlug: post.category.slug,
            authorLogin: post.author?.login ?? null,
            body: post.body ?? "",
            scrapedAt,
        };

        if (discussionMap.has(row.number)) {
            updated += 1;
        } else {
            appended += 1;
        }
        discussionMap.set(row.number, row);
        fetchedThisRun += 1;

        if (row.authorLogin) {
            const existing = authorMap.get(row.authorLogin);
            authorMap.set(row.authorLogin, {
                login: row.authorLogin,
                scrapedAt,
                profile: existing?.profile ?? null,
                enrichedAt: existing?.enrichedAt ?? null,
                enrichError: existing?.enrichError,
            });
        }
    }

    await writeJsonl(discussionsPath, mapToRows(discussionMap));
    await writeJsonl(AUTHORS_PATH, mapToRows(authorMap));

    console.log(
        JSON.stringify({
            page,
            fetchedThisRun,
            totalOnDisk: discussionMap.size,
            authorsOnDisk: authorMap.size,
            rateLimitRemaining: data.rateLimit?.remaining ?? null,
            hasNextPage: conn.pageInfo.hasNextPage,
        }),
    );

    if (!conn.pageInfo.hasNextPage) {
        break;
    }
    if (limit != null && fetchedThisRun >= limit) {
        break;
    }

    cursor = conn.pageInfo.endCursor;
    await sleep(PAGE_PAUSE_MS);
}

console.log(
    JSON.stringify(
        {
            done: {
                category: preferred.name,
                slug: scrapeTarget.slug,
                role: scrapeTarget.role,
                fetchedThisRun,
                appended,
                updated,
                totalOnDisk: discussionMap.size,
                authorsOnDisk: authorMap.size,
                discussionsPath,
                authorsPath: AUTHORS_PATH,
            },
        },
        null,
        2,
    ),
);
