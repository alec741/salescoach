type SlackBlock = Record<string, unknown>;

export function isSlackConfigured() {
  return Boolean(process.env.SLACK_BOT_TOKEN);
}

export async function postSlackMessage(input: {
  channel: string;
  text: string;
  blocks?: SlackBlock[];
}) {
  if (!process.env.SLACK_BOT_TOKEN) {
    return { ok: false, message: "SLACK_BOT_TOKEN is not configured." };
  }

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({
      channel: input.channel,
      text: input.text,
      blocks: input.blocks
    })
  });

  const payload = (await response.json()) as { ok?: boolean; error?: string };
  return {
    ok: Boolean(payload.ok),
    message: payload.ok ? "Slack message sent." : `Slack message failed: ${payload.error || response.statusText}`
  };
}
