import { createInterface } from 'node:readline/promises';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../src/db/schema.ts';
import { createOwner } from './seed-users.ts';

// Run with: pnpm prod:init — once, on a fresh cloud database, after `pnpm db:migrate && pnpm db:seed`.
// Creates the first owner; the outlets are theirs to add in the backoffice. A hub never runs this:
// its owner comes from the desktop setup wizard (US-088).
if (process.env.DEPLOYMENT !== 'cloud') {
  console.error('prod:init is for the cloud database only (DEPLOYMENT=cloud).');
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
// The iterator queues lines, so piped answers are not lost the way they are between `rl.question` calls.
const lines = rl[Symbol.asyncIterator]();
// ponytail: hides typed passwords through readline's internal `_writeToOutput`; swap for a prompt library if Node changes it.
let muted = false;
const out = rl as unknown as { _writeToOutput: (text: string) => void };
out._writeToOutput = (text) => {
  if (!muted) process.stdout.write(text);
  else if (text.includes('\n')) process.stdout.write('\n');
};
const ask = async (prompt: string, hidden = false) => {
  process.stdout.write(prompt);
  muted = hidden;
  try {
    return String((await lines.next()).value ?? '');
  } finally {
    muted = false;
  }
};

const name = await ask('Owner name: ');
const username = await ask('Username: ');
const password = await ask('Password: ', true);
const repeat = await ask('Repeat password: ', true);
rl.close();

if (password !== repeat) {
  console.error('Passwords do not match.');
  process.exit(1);
}

const db = drizzle(process.env.DATABASE_URL!, { schema });
try {
  console.log(`owner ${await createOwner(db, { name, username, password })} created`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await db.$client.end();
}
