type SlackBlock = Record<string, unknown>;

function getSlackToken() {
  return process.env.SLACK_BOT_TOKEN || process.env.SLACK_ACCESS_TOKEN;
}

export function isSlackConfigured() {
  return Boolean(getSlackToken());
}

export async function postSlackMessage(input: {
  channel: string;
  text: string;
  blocks?: SlackBlock[];
}) {
  const token = getSlackToken();
  if (!token) {
    return { ok: false, message: "SLACK_BOT_TOKEN or SLACK_ACCESS_TOKEN is not configured." };
  }

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({
      channel: input.channel,
      text: input.text,
      blocks: input.blocks
    })
  });

  const payload = (await response.json()) as { ok?: boolean; error?: string; channel?: string; ts?: string };
  return {
    ok: Boolean(payload.ok),
    message: payload.ok ? "Slack message sent." : `Slack message failed: ${payload.error || response.statusText}`,
    error: payload.ok ? null : payload.error || response.statusText,
    channel: typeof payload.channel === "string" ? payload.channel : input.channel,
    ts: typeof payload.ts === "string" ? payload.ts : null
  };
}
