#!/usr/bin/env node
/**
 * Starts the ScamLord LiveKit voice worker in dev mode.
 *
 * Equivalent to: npx tsx src/voice/worker.ts dev
 *
 * Requires LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET plus STT/TTS keys
 * (see src/voice/worker.ts module doc).
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerEntry = path.join(root, "src/voice/worker.ts");

const child = spawn("npx", ["tsx", workerEntry, "dev"], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
});

child.on("exit", (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }
    process.exit(code ?? 1);
});
