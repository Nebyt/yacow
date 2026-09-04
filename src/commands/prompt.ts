// Minimal terminal prompts for the non-interactive commands.
//
// The Ink pages own input in the TUI; commands run before Ink mounts, so they
// read stdin directly. Prompts and notes go to stderr so that stdout carries
// only the command's result and stays pipeable (`--json`).
import * as readline from 'node:readline/promises';

// Control characters we handle while echoing is off. Built from char codes so
// the source stays free of literal control bytes.
const CTRL_C = String.fromCharCode(3);
const DELETE = String.fromCharCode(127);
const BACKSPACE = String.fromCharCode(8);

export function isInteractive(): boolean {
  return process.stdin.isTTY === true && process.stderr.isTTY === true;
}

const NO_INPUT = 'No input received (stdin closed).';

/** Read a whole line, echoed. Use for non-secret input. */
export async function promptLine(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  try {
    return await rl.question(question);
  } catch {
    // readline rejects on EOF (Ctrl-D) with an opaque error.
    throw new Error(NO_INPUT);
  } finally {
    rl.close();
  }
}

/** Read a line without echoing it; each character shows as `*`. */
export function promptHidden(question: string): Promise<string> {
  const { stdin, stderr } = process;
  if (stdin.isTTY !== true) {
    return Promise.reject(new Error('No TTY available to read a password; use --stdin or --phrase-file.'));
  }

  return new Promise<string>((resolve, reject) => {
    let value = '';
    stderr.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const cleanup = (): void => {
      stdin.off('data', onData);
      stdin.off('end', onEnd);
      stdin.setRawMode(false);
      stdin.pause();
    };

    // Without this the promise would hang forever if stdin closed mid-entry.
    const onEnd = (): void => {
      cleanup();
      stderr.write('\n');
      reject(new Error(NO_INPUT));
    };

    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          cleanup();
          stderr.write('\n');
          resolve(value);
          return;
        }
        if (char === CTRL_C) {
          cleanup();
          stderr.write('\n');
          reject(new Error('Cancelled.'));
          return;
        }
        if (char === DELETE || char === BACKSPACE) {
          if (value.length > 0) {
            value = value.slice(0, -1);
            stderr.write('\b \b');
          }
          continue;
        }
        if (char < ' ') continue; // ignore any other control character
        value += char;
        stderr.write('*');
      }
    };

    stdin.on('data', onData);
    stdin.on('end', onEnd);
  });
}

/** Read all of stdin (used by --stdin). */
export async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
