import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import { appUsers, managerRepAssignments } from "../../src/db/schema";

const salesReps = [
  "Bryton",
  "Josh",
  "Jen",
  "Janay",
  "Tanner",
  "Jonathan",
  "Shea",
  "Colton",
  "Greg",
  "Chris",
  "Alec"
];

function parseArgs() {
  const args = process.argv.slice(2);
  const managerEmailIndex = args.indexOf("--manager-email");
  return {
    managerEmail: managerEmailIndex >= 0 ? args[managerEmailIndex + 1] : "manager@enhancify.example"
  };
}

function emailForName(name: string) {
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@enhancify.example`;
}

async function upsertUser(input: { email: string; displayName: string; role: "rep" | "manager" | "admin" }) {
  const db = getDb();
  const inserted = await db
    .insert(appUsers)
    .values({
      email: input.email,
      displayName: input.displayName,
      role: input.role,
      active: true
    })
    .onConflictDoUpdate({
      target: appUsers.email,
      set: {
        displayName: input.displayName,
        role: input.role,
        active: true
      }
    })
    .returning({ id: appUsers.id });
  return inserted[0].id;
}

async function main() {
  const args = parseArgs();
  const db = getDb();
  const managerId = await upsertUser({
    email: args.managerEmail,
    displayName: "Sales Manager",
    role: "manager"
  });

  const seeded = [];
  for (const name of salesReps) {
    const existing = await db.select().from(appUsers).where(eq(appUsers.email, emailForName(name))).limit(1);
    const repId = await upsertUser({
      email: emailForName(name),
      displayName: name,
      role: "rep"
    });

    if (existing[0]?.closeUserId) {
      await db.update(appUsers).set({ closeUserId: existing[0].closeUserId }).where(eq(appUsers.id, repId));
    }

    await db
      .insert(managerRepAssignments)
      .values({
        managerUserId: managerId,
        repUserId: repId
      })
      .onConflictDoNothing();
    seeded.push({ name, email: emailForName(name), repId });
  }

  console.log(JSON.stringify({ ok: true, managerEmail: args.managerEmail, reps: seeded.length, seeded }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
