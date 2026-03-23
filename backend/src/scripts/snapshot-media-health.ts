import { initializeSchema } from "../db/schema";
import { runAndPersistMediaHealthSnapshot } from "../services/media-health-snapshot-service";

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

function getArgValue(name: string): string | undefined {
  const prefixed = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefixed));
  if (inline) {
    return inline.slice(prefixed.length);
  }

  const index = process.argv.findIndex((arg) => arg === name);
  if (index >= 0) {
    return process.argv[index + 1];
  }

  return undefined;
}

async function run(): Promise<void> {
  initializeSchema();

  const externalSampleSize = parseOptionalNumber(getArgValue("--sample"));
  const externalConcurrency = parseOptionalNumber(getArgValue("--concurrency"));
  const metricDate = getArgValue("--date");

  const snapshot = await runAndPersistMediaHealthSnapshot({
    triggerType: "script",
    externalSampleSize,
    externalConcurrency,
    metricDate,
  });

  console.log("media_health_snapshot_result", snapshot);
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error("media_health_snapshot_failed", { error: message });
  process.exitCode = 1;
});
