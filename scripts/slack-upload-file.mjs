import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv, ROOT } from "./coach/shared.mjs";

function parseArgs(argv) {
  const args = {
    channel: process.env.SLACK_MANAGER_CHANNEL_ID || null,
    file: null,
    filename: null,
    initialComment: "",
    title: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case "--channel":
        args.channel = next;
        index += 1;
        break;
      case "--file":
        args.file = next;
        index += 1;
        break;
      case "--filename":
        args.filename = next;
        index += 1;
        break;
      case "--initial-comment":
        args.initialComment = next;
        index += 1;
        break;
      case "--title":
        args.title = next;
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.file) throw new Error("--file is required.");
  if (!args.channel) throw new Error("SLACK_MANAGER_CHANNEL_ID is required unless --channel is provided.");
  return args;
}

function slackToken() {
  return process.env.SLACK_BOT_TOKEN || process.env.SLACK_ACCESS_TOKEN;
}

export async function uploadSlackFile(input) {
  loadLocalEnv();
  const token = slackToken();
  if (!token) throw new Error("SLACK_BOT_TOKEN or SLACK_ACCESS_TOKEN is required.");

  const filePath = path.resolve(ROOT, input.file);
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

  const fileBuffer = fs.readFileSync(filePath);
  const form = new FormData();
  form.set("channels", input.channel || process.env.SLACK_MANAGER_CHANNEL_ID);
  form.set("filename", input.filename || path.basename(filePath));
  form.set("title", input.title || path.basename(filePath, path.extname(filePath)));
  if (input.initialComment) form.set("initial_comment", input.initialComment);
  form.set("file", new Blob([fileBuffer], { type: "application/pdf" }), input.filename || path.basename(filePath));

  const response = await fetch("https://slack.com/api/files.upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: form
  });
  const payload = await response.json();
  if (!payload.ok) {
    throw new Error(`Slack file upload failed: ${payload.error || response.statusText}`);
  }

  return {
    ok: true,
    fileId: payload.file?.id || null,
    permalink: payload.file?.permalink || null,
    title: payload.file?.title || null
  };
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const result = await uploadSlackFile(args);
  console.log(JSON.stringify(result, null, 2));
}

function isDirectExecution() {
  const entry = process.argv[1];
  return Boolean(entry) && path.resolve(entry) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
