#!/usr/bin/env node
/**
 * Build load-ready Sample Workspace fixtures from raw scrape/enrich output.
 * Dataset shaping only: no Company Signal Score, Plan Table, or Stripe calls.
 *
 *   processed/customers.jsonl       → one row per unique commenter (de-dupe key)
 *   processed/feedback_items.jsonl  → public.feedback_items-shaped forum rows
 *   processed/ideas.jsonl           → public.ideas candidates (Feature Requests)
 *
 * Join before Stripe exists: local_customer_key on customers + feedback_items.
 * Later: Stripe.customers.create → fill stripe_customer_id → copy to customer_id.
 *
 * Usage:
 *   node scripts/build-processed.mjs
 *
 * Prerequisite: scrape categories; enrich-authors.mjs recommended so profile is present.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd(), "data/sample-workspace");
const RAW_DIR = resolve(ROOT, "raw");
const PROCESSED_DIR = resolve(ROOT, "processed");
const AUTHORS_PATH = resolve(RAW_DIR, "authors.jsonl");

const FEEDBACK_SLUGS = ["questions", "troubleshooting"];
const IDEAS_SLUG = "feature-requests";

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

function localCustomerKey(login) {
    return `gh_user_${login}`;
}

function feedbackItemId(number) {
    return `gh_${number}`;
}

function stagingEmail(login) {
    const safe = String(login)
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return `${safe || "unknown"}@sample-workspace.local`;
}

await mkdir(PROCESSED_DIR, { recursive: true });

const authors = await readJsonl(AUTHORS_PATH);
const authorsByLogin = new Map(authors.map((a) => [a.login, a]));

const customersByKey = new Map();
const feedbackItems = [];
const ideas = [];

for (const slug of FEEDBACK_SLUGS) {
    const rows = await readJsonl(resolve(RAW_DIR, slug, "discussions.jsonl"));
    for (const post of rows) {
        const login = post.authorLogin;
        if (!login) {
            feedbackItems.push({
                id: feedbackItemId(post.number),
                source: "forum",
                customer_id: null,
                local_customer_key: null,
                body: formatForumBody(post),
                created_at: post.createdAt,
                category_slug: post.categorySlug ?? slug,
                role: post.role ?? "feedback",
                title: post.title,
                url: post.url,
                github_login: null,
            });
            continue;
        }

        const key = localCustomerKey(login);
        const author = authorsByLogin.get(login);
        if (!customersByKey.has(key)) {
            customersByKey.set(key, {
                local_customer_key: key,
                github_login: login,
                email: stagingEmail(login),
                // filled later when creating Stripe sandbox customers
                stripe_customer_id: null,
                // kept for later scoring / anonymization; not a DB column yet
                profile: author?.profile ?? null,
                enrich_error: author?.enrichError ?? null,
            });
        }

        feedbackItems.push({
            id: feedbackItemId(post.number),
            source: "forum",
            customer_id: null,
            local_customer_key: key,
            body: formatForumBody(post),
            created_at: post.createdAt,
            category_slug: post.categorySlug ?? slug,
            role: post.role ?? "feedback",
            title: post.title,
            url: post.url,
            github_login: login,
        });
    }
}

const ideaPosts = await readJsonl(resolve(RAW_DIR, IDEAS_SLUG, "discussions.jsonl"));
for (const post of ideaPosts) {
    const text = (post.title ?? "").trim();
    if (!text) {
        continue;
    }
    ideas.push({
        id: null,
        text,
        created_at: post.createdAt,
        source_discussion_id: feedbackItemId(post.number),
        source_url: post.url,
        github_login: post.authorLogin ?? null,
    });
}

const customers = [...customersByKey.values()].sort((a, b) =>
    a.local_customer_key.localeCompare(b.local_customer_key),
);
feedbackItems.sort((a, b) => a.id.localeCompare(b.id));
ideas.sort((a, b) => a.text.localeCompare(b.text));

const customersPath = resolve(PROCESSED_DIR, "customers.jsonl");
const feedbackPath = resolve(PROCESSED_DIR, "feedback_items.jsonl");
const ideasPath = resolve(PROCESSED_DIR, "ideas.jsonl");

await writeJsonl(customersPath, customers);
await writeJsonl(feedbackPath, feedbackItems);
await writeJsonl(ideasPath, ideas);

console.log(
    JSON.stringify(
        {
            done: {
                customers: customers.length,
                customersWithProfile: customers.filter((c) => c.profile != null).length,
                feedback_items: feedbackItems.length,
                feedbackUnlinked: feedbackItems.filter((f) => !f.local_customer_key).length,
                ideas: ideas.length,
                paths: {
                    customers: customersPath,
                    feedback_items: feedbackPath,
                    ideas: ideasPath,
                },
            },
        },
        null,
        2,
    ),
);

function formatForumBody(post) {
    const title = (post.title ?? "").trim();
    const body = (post.body ?? "").trim();
    if (title && body) {
        return `${title}\n\n${body}`;
    }
    return title || body || "";
}
