import { spawn } from "node:child_process";
import http from "node:http";

const requiredForProduction = [
  "DATABASE_URL",
  "NEON_AUTH_BASE_URL",
  "NEON_AUTH_COOKIE_SECRET",
  "SLACK_MANAGER_CHANNEL_ID"
];

const requiredAnyForProduction = [
  ["SLACK_BOT_TOKEN", "SLACK_ACCESS_TOKEN"],
  ["OPENROUTER_API_KEY", "OPENAI_API_KEY"]
];

const routes = ["/manager", "/rep", "/rep/calls", "/rep/summaries", "/manager/reports", "/settings/users"];

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { shell: true, stdio: "inherit", ...options });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

function fetchStatus(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode || 0));
    });
    request.on("error", () => resolve(0));
    request.setTimeout(10_000, () => {
      request.destroy();
      resolve(0);
    });
  });
}

async function waitForServer(baseUrl) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = await fetchStatus(baseUrl);
    if (status > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function stopServer(child, port) {
  child.kill();
  if (process.platform !== "win32") return;
  await run(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `$connections = netstat -ano | Select-String ':${port}\\\\s'; ` +
        `$ids = @(); foreach ($line in $connections) { ` +
        `$parts = ($line.ToString() -split '\\\\s+') | Where-Object { $_ }; ` +
        `if ($parts.Length -ge 5 -and $parts[1] -match ':${port}$') { $ids += [int]$parts[-1] } ` +
        `}; foreach ($id in ($ids | Sort-Object -Unique)) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }`
    ],
    { stdio: "ignore" }
  );
}

async function smokeRoutes() {
  const port = process.env.PREFLIGHT_PORT || "3107";
  const baseUrl = `http://localhost:${port}`;
  const child = spawn("npm", ["run", "start", "--", "-p", port], {
    shell: true,
    stdio: "ignore",
    detached: false
  });

  try {
    const ready = await waitForServer(baseUrl);
    if (!ready) return { ok: false, results: routes.map((route) => ({ route, status: 0 })) };

    const results = [];
    for (const route of routes) {
      results.push({ route, status: await fetchStatus(`${baseUrl}${route}`) });
    }
    return { ok: results.every((result) => result.status === 200), results };
  } finally {
    await stopServer(child, port);
  }
}

async function main() {
  const missing = requiredForProduction.filter((name) => !process.env[name]);
  const missingAny = requiredAnyForProduction
    .filter((group) => !group.some((name) => process.env[name]))
    .map((group) => group.join(" or "));
  console.log(
    JSON.stringify(
      {
        env: {
          missing: [...missing, ...missingAny],
          configured: [
            ...requiredForProduction.filter((name) => process.env[name]),
            ...requiredAnyForProduction.flatMap((group) => group.filter((name) => process.env[name]))
          ]
        }
      },
      null,
      2
    )
  );

  const checks = [
    ["lint", ["run", "lint"]],
    ["typecheck", ["run", "typecheck"]],
    ["profiles", ["run", "profiles:validate"]],
    ["prompt", ["run", "prompt:render", "--", "enhancify"]],
    ["db-generate", ["run", "db:generate"]],
    ["build", ["run", "build"]]
  ];

  for (const [name, args] of checks) {
    const code = await run("npm", args);
    if (code !== 0) {
      console.error(`Preflight failed at ${name}.`);
      process.exitCode = code;
      return;
    }
  }

  const smoke = await smokeRoutes();
  console.log(JSON.stringify({ routeSmoke: smoke.results }, null, 2));
  if (!smoke.ok) {
    process.exitCode = 1;
    return;
  }

  const auditCode = await run("npm", ["audit", "--audit-level=moderate"]);
  if (auditCode !== 0) {
    console.error("Preflight completed functional checks, but dependency audit has unresolved advisories.");
    process.exitCode = auditCode;
    return;
  }

  console.log("Preflight passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
