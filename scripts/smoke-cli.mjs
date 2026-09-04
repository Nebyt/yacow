// End-to-end checks for the non-interactive subcommands, run against the real
// built binary (`dist/cli.js`) with piped stdin.
//
// These live outside jest for the same reason as scripts/smoke.mjs: the entry
// point pulls in Ink, whose ESM-only yoga-layout dep cannot be transpiled by
// babel-jest. Spawning the binary also covers what jest cannot -- argument
// routing, exit codes, and the stdout/stderr split that makes `--json` pipeable.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli.js');

const PAPER = {
  scrambled:
    'air comic label visual scale twist sell build ankle copy expect rocket crystal allow tissue eager jaguar crouch million cushion beach',
  password: 'testpasswordtest',
  words: 'business sight another write gadget near where hollow insane dynamic grain hurt slim clip require',
  plate: 'PDED-7795',
  mainnetFirst: 'Ae2tdPwUPEZ5WTs87mbEwJjbW7pmkigLfBnLp3eKfGehapUMKiewwMn5yxh',
  preprodFirst: 'FHnt4NL7yPXuTx86MN8hrgDkzFD5bW5DzuhpmGzJ6N52omwxYQ5NvfAoxULSfM8',
};

function run(args, stdin = null) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => {
      stdout += d;
    });
    child.stderr.on('data', d => {
      stderr += d;
    });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
    if (stdin !== null) child.stdin.write(stdin);
    child.stdin.end();
  });
}

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) {
    console.log(`PASS  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const secrets = `${PAPER.scrambled}\n${PAPER.password}\n`;

// 1. --json on stdout, parseable, with the golden wallet's plate and addresses.
{
  const { code, stdout, stderr } = await run(['paper-addresses', '--stdin', '--json'], secrets);
  let parsed = null;
  try {
    parsed = JSON.parse(stdout);
  } catch (e) {
    // handled by the checks below
  }
  check('json: exit 0', code === 0, `code ${code} / ${stderr.trim()}`);
  check('json: stdout is pure JSON', parsed !== null, stdout.slice(0, 120));
  check('json: golden plate', parsed?.plate === PAPER.plate, String(parsed?.plate));
  check('json: 10 addresses by default', parsed?.addresses?.length === 10, String(parsed?.addresses?.length));
  check('json: golden first address', parsed?.addresses?.[0]?.address === PAPER.mainnetFirst);
  check('json: path recorded', parsed?.addresses?.[3]?.path === "44'/1815'/0'/0/3");
  check('json: wrong-password warning on stderr', stderr.includes('wrong paper password'));
  check(
    'json: no secret ever printed',
    !stdout.includes(PAPER.password) && !stdout.includes('business sight') && !stderr.includes(PAPER.password),
  );
}

// 2. Table output honours --count and --network.
{
  const { code, stdout } = await run(['paper-addresses', '--stdin', '--count', '3', '--network', 'preprod'], secrets);
  const rows = stdout.trim().split('\n').filter(l => /^\s*\d+\s+/.test(l));
  check('table: exit 0', code === 0);
  check('table: 3 rows', rows.length === 3, String(rows.length));
  check('table: preprod first address', stdout.includes(PAPER.preprodFirst));
  check('table: plate shown', stdout.includes(PAPER.plate));
}

// 3. A wrong password succeeds but yields a different wallet.
{
  const { code, stdout } = await run(
    ['paper-addresses', '--stdin', '--json'],
    `${PAPER.scrambled}\nwrong-password\n`,
  );
  const parsed = JSON.parse(stdout);
  check('wrong password: exit 0', code === 0);
  check('wrong password: different plate', parsed.plate !== PAPER.plate);
  check('wrong password: different address', parsed.addresses[0].address !== PAPER.mainnetFirst);
}

// 4. --phrase-file reads phrase + password from the file.
{
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const dir = await mkdtemp(path.join(tmpdir(), 'yacow-smoke-'));
  const file = path.join(dir, 'paper.txt');
  await writeFile(file, secrets, { mode: 0o600 });
  const { code, stdout } = await run(['paper-addresses', '--phrase-file', file, '--json', '--count', '1']);
  await rm(dir, { recursive: true, force: true });
  const parsed = code === 0 ? JSON.parse(stdout) : null;
  check('phrase-file: exit 0', code === 0);
  check('phrase-file: golden first address', parsed?.addresses?.[0]?.address === PAPER.mainnetFirst);
}

// 5. Input and flag errors exit non-zero with a readable message.
for (const [name, args, stdin, expected] of [
  ['malformed phrase', ['paper-addresses', '--stdin'], 'too few words\npw\n', '21 words'],
  ['bad count', ['paper-addresses', '--stdin', '--count', '0'], secrets, 'between 1 and'],
  ['bad network', ['paper-addresses', '--stdin', '--network', 'sancho'], secrets, 'mainnet'],
  ['no tty and no input flag', ['paper-addresses'], null, '--stdin'],
  ['missing password line', ['paper-addresses', '--stdin'], `${PAPER.scrambled}`, 'second line'],
  ['stdin plus phrase-file', ['paper-addresses', '--stdin', '--phrase-file', '/tmp/nope'], secrets, 'not both'],
]) {
  const { code, stderr } = await run(args, stdin);
  check(`error: ${name}`, code !== 0 && stderr.includes(expected), `code ${code} / ${stderr.trim().slice(0, 120)}`);
}

// 6. Help and unknown commands.
{
  const help = await run(['paper-addresses', '--help']);
  check('help: exit 0', help.code === 0, `code ${help.code}`);
  check('help: lists the flags', ['--network', '--count', '--json', '--stdin'].every(f => help.stdout.includes(f)));

  const topLevel = await run(['--help']);
  check('help: top-level lists paper-addresses', topLevel.code === 0 && topLevel.stdout.includes('paper-addresses'));

  const unknown = await run(['no-such-command']);
  check('unknown command: exit non-zero', unknown.code !== 0, `code ${unknown.code}`);
}

console.log(failures === 0 ? '\nAll CLI smoke checks passed.' : `\n${failures} CLI smoke check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
