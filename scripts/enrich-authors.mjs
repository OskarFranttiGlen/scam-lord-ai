#!/usr/bin/env node
/**
 * Fetch public GitHub profiles for unique commenters in raw/authors.jsonl.
 * Dataset gathering only: stores profile JSON for later (score / Plan Table / Stripe).
 *
 * Prerequisite: run scripts/scrape-one-discussion.mjs so authors.jsonl exists.
 *
 * Usage:
 *   node scripts/enrich-authors.mjs
 *   node scripts/enrich-authors.mjs --limit=50
 *   node scripts/enrich-authors.mjs --force   # re-fetch even if profile exists
 *
 * Then optional: node scripts/build-processed.mjs for Supabase/Stripe-shaped files.
 */

import { config } from "dotenv";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

config({ path: resolve(process.cwd(), ".env.local") });

const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const AUTHORS_PATH = resolve(
    process.cwd(),
    "data/sample-workspace/raw/authors.jsonl",
);
const MIN_RATE_REMAINING = 200;
const PAUSE_MS = 150;

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : null;
const force = args.includes("--force");

if (limitArg && (!Number.isFinite(limit) || limit < 1)) {
    console.error("Invalid --limit=N (positive number required).");
    process.exit(1);
}

if (!TOKEN) {
    console.error("Set GITHUB_TOKEN or GH_TOKEN in .env.local first.");
    process.exit(1);
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

async function ghRest(path, attempt = 1) {
    const res = await fetch(`https://api.github.com${path}`, {
        headers: {
            Authorization: `Bearer ${TOKEN}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "shipworthy-sample-workspace-scrape",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    });

    const remaining = Number(res.headers.get("x-ratelimit-remaining"));
    const resetSec = Number(res.headers.get("x-ratelimit-reset"));
    if (Number.isFinite(remaining) && remaining < MIN_RATE_REMAINING && Number.isFinite(resetSec)) {
        const waitMs = Math.max(0, resetSec * 1000 - Date.now()) + 1000;
        console.warn(`REST rateLimit.remaining=${remaining}; sleeping ${waitMs}ms`);
        await sleep(waitMs);
    }

    if (res.status === 404) {
        return { ok: false, status: 404, json: null };
    }

    if (res.status === 403 || res.status === 429 || res.status === 502 || res.status === 503) {
        if (attempt >= 6) {
            console.error(`GitHub HTTP ${res.status} after ${attempt} attempts for ${path}`);
            process.exit(1);
        }
        const retryAfter = Number(res.headers.get("retry-after"));
        const waitMs = Number.isFinite(retryAfter)
            ? retryAfter * 1000
            : Math.min(60_000, 1000 * 2 ** attempt);
        console.warn(`HTTP ${res.status} on ${path}; sleeping ${waitMs}ms (attempt ${attempt})`);
        await sleep(waitMs);
        return ghRest(path, attempt + 1);
    }

    if (!res.ok) {
        const text = await res.text();
        console.error(`GitHub HTTP ${res.status} for ${path}: ${text}`);
        process.exit(1);
    }

    return { ok: true, status: res.status, json: await res.json() };
}

function needsEnrichment(author) {
    if (force) {
        return true;
    }
    return author.profile == null && author.enrichError == null;
}

const authors = await readJsonl(AUTHORS_PATH);
if (authors.length === 0) {
    console.error(`No authors at ${AUTHORS_PATH}. Scrape a category first.`);
    process.exit(1);
}

const pending = authors.filter(needsEnrichment);
const toFetch = limit == null ? pending : pending.slice(0, limit);

console.log(
    JSON.stringify({
        starting: {
            authorsOnDisk: authors.length,
            pending: pending.length,
            fetching: toFetch.length,
            force,
            path: AUTHORS_PATH,
        },
    }),
);

let fetched = 0;
let ok = 0;
let missing = 0;

for (const target of toFetch) {
    const userRes = await ghRest(`/users/${encodeURIComponent(target.login)}`);
    if (!userRes.ok) {
        target.profile = null;
        target.enrichError = `http_${userRes.status}`;
        target.enrichedAt = new Date().toISOString();
        delete target.companySignalScore;
        delete target.companySignalSignals;
        missing += 1;
        fetched += 1;
        await writeJsonl(AUTHORS_PATH, authors);
        console.log(
            JSON.stringify({
                login: target.login,
                status: "missing",
                done: fetched,
                left: toFetch.length - fetched,
            }),
        );
        await sleep(PAUSE_MS);
        continue;
    }

    const user = userRes.json;
    const orgsRes = await ghRest(
        `/users/${encodeURIComponent(target.login)}/orgs?per_page=100`,
    );
    const orgs = orgsRes.ok ? orgsRes.json : [];

    target.profile = {
        login: user.login,
        type: user.type,
        name: user.name,
        company: user.company,
        bio: user.bio,
        blog: user.blog,
        location: user.location,
        email: user.email,
        hireable: user.hireable,
        twitterUsername: user.twitter_username,
        publicRepos: user.public_repos,
        publicGists: user.public_gists,
        followers: user.followers,
        following: user.following,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
        orgLogins: orgs.map((o) => o.login),
        orgCount: orgs.length,
    };
    delete target.enrichError;
    delete target.companySignalScore;
    delete target.companySignalSignals;
    target.enrichedAt = new Date().toISOString();

    ok += 1;
    fetched += 1;
    await writeJsonl(AUTHORS_PATH, authors);

    console.log(
        JSON.stringify({
            login: target.login,
            status: "ok",
            company: target.profile.company,
            orgCount: target.profile.orgCount,
            done: fetched,
            left: toFetch.length - fetched,
        }),
    );

    await sleep(PAUSE_MS);
}

console.log(
    JSON.stringify(
        {
            done: {
                fetched,
                ok,
                missing,
                authorsOnDisk: authors.length,
                withProfile: authors.filter((a) => a.profile != null).length,
                path: AUTHORS_PATH,
                next: "Optional: node scripts/build-processed.mjs",
            },
        },
        null,
        2,
    ),
);
