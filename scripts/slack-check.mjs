import fs from "node:fs";

function loadDotEnv(filePath = ".env") {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

async function slackApi(method, body) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN || process.env.SLACK_ACCESS_TOKEN}`,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(body || {})
  });
  return response.json();
}

function redact(value) {
  if (!value) return "missing";
  return `set (${value.length} chars, ${value.slice(0, 4)}...)`;
}

async function main() {
  loadDotEnv();

  const token = process.env.SLACK_BOT_TOKEN || process.env.SLACK_ACCESS_TOKEN;
  const channel = process.env.SLACK_MANAGER_CHANNEL_ID;
  const shouldPost = process.argv.includes("--post");
  const shouldCheckChannel = process.argv.includes("--check-channel");

  console.log(
    JSON.stringify(
      {
        env: {
          SLACK_BOT_TOKEN: redact(process.env.SLACK_BOT_TOKEN),
          SLACK_ACCESS_TOKEN: redact(process.env.SLACK_ACCESS_TOKEN),
          SLACK_MANAGER_CHANNEL_ID: channel ? `set (${channel})` : "missing",
          SLACK_SIGNING_SECRET: redact(process.env.SLACK_SIGNING_SECRET)
        }
      },
      null,
      2
    )
  );

  if (!token) {
    throw new Error("No Slack token found. Set SLACK_BOT_TOKEN or SLACK_ACCESS_TOKEN.");
  }

  const auth = await slackApi("auth.test");
  if (!auth.ok) {
    throw new Error(`Slack auth.test failed: ${auth.error || "unknown_error"}`);
  }
  console.log(`Slack auth OK: team=${auth.team}, user=${auth.user}, bot_id=${auth.bot_id || "n/a"}`);

  if (!channel) {
    console.log("SLACK_MANAGER_CHANNEL_ID is missing. Add a channel ID like C0123456789 before testing report sends.");
    return;
  }

  if (shouldCheckChannel) {
    const channelInfo = await slackApi("conversations.info", { channel });
    if (!channelInfo.ok) {
      throw new Error(`Slack channel check failed: ${channelInfo.error || "unknown_error"}`);
    }
    console.log(`Slack channel OK: #${channelInfo.channel?.name || channel}`);
  }

  if (!shouldPost) {
    console.log("Dry run complete. Token auth is valid. Add --post to verify chat.postMessage.");
    return;
  }

  const post = await slackApi("chat.postMessage", {
    channel,
    text: "Decoded Coach Slack check: report notifications are configured."
  });
  if (!post.ok) {
    throw new Error(`Slack test post failed: ${post.error || "unknown_error"}`);
  }
  console.log(`Slack test message sent: ts=${post.ts}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
