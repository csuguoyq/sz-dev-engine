import { Transform, type TransformCallback } from "node:stream";

/**
 * Redaction for logs and UI-served content. Catches the credentials that
 * actually appear in sz-dev / agent output: Bugzilla session cookies, generic
 * secret-looking `key=value`/`key: value` pairs, Authorization/Cookie headers,
 * PEM private-key blocks, and `user:pass@host` URL credentials. Public keys
 * (ssh-rsa / ssh-ed25519) are intentionally NOT redacted — they are not secret.
 *
 * `clip` keeps the tail of a redacted string so the most recent, usually most
 * relevant, output survives the preview cap.
 */

// ANSI escape sequences (CSI: ESC [ ... final-byte). Agent CLIs emit colored
// output even in headless mode; strip it so error text and log previews stay
// plain (the integration doc's P13 improvement).
const ANSI_CSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

// No word boundary: underscore-prefixed keys (my_password=, input_access_token=)
// must still match; a bare `token=` is deliberately NOT listed because agent
// output uses "token: N" for usage counts (see test/units.test.ts).
const KEY_VALUE = /((?:Bugzilla_logincookie|Bugzilla_login|api[_-]?token|access[_-]?token|auth[_-]?token|apikey|secret[_-]?key?|access[_-]?key|private[_-]?key|passwd|password))\s*([=:])\s*(\S+)/gi;

const HEADER_SECRET = /(Authorization|Cookie|Proxy-Authorization)(\s*:\s*)(.*)/gi;

const PRIVATE_KEY_BLOCK =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;

const URL_CREDENTIALS = /(https?:\/\/)([^\s:/@]+)(:[^\s:/@]+)(@)/g;

export function redact(text: string): string {
  let out = text;
  out = out.replace(ANSI_CSI, "");
  out = out.replace(KEY_VALUE, (_match, key: string, sep: string) => `${key}${sep}<redacted>`);
  out = out.replace(HEADER_SECRET, (_match, header: string, sep: string) => `${header}${sep}<redacted>`);
  out = out.replace(PRIVATE_KEY_BLOCK, "<redacted private key>");
  out = out.replace(URL_CREDENTIALS, (_match, scheme: string, user: string, _pass: string, at: string) => `${scheme}${user}<redacted>${at}`);
  return out;
}

export function clip(text: string, max = 500): string {
  const clean = redact(text).trim();
  if (clean.length <= max) return clean;
  return clean.slice(clean.length - max);
}

/**
 * Line-buffered redacting sink. Agent/tool output arrives as arbitrary
 * chunks (a secret can span a chunk boundary), so `redact` must run on
 * COMPLETE lines: `push` holds back a trailing partial line until its
 * newline arrives (or `flush`), and redacts each complete line before
 * handing it to `write`. A streaming TextDecoder keeps multi-byte
 * characters intact across chunk boundaries.
 *
 * The pending buffer is capped: a pathological stream that never emits a
 * newline is flushed as a "line" at the cap, so unbounded output cannot
 * grow memory without bound.
 */
export function createLineRedactor(
  write: (line: string) => void,
  cap = 1024 * 1024,
): { push(chunk: Buffer | string): void; flush(): void } {
  const decoder = new TextDecoder("utf-8");
  let pending = "";
  return {
    push(chunk: Buffer | string): void {
      pending += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
      let newline = pending.indexOf("\n");
      while (newline !== -1) {
        const line = pending.slice(0, newline + 1);
        pending = pending.slice(newline + 1);
        write(redact(line));
        newline = pending.indexOf("\n");
      }
      if (pending.length > cap) {
        write(redact(pending + "\n"));
        pending = "";
      }
    },
    flush(): void {
      pending += decoder.decode();
      if (pending) {
        write(redact(pending + "\n"));
        pending = "";
      }
    },
  };
}

/**
 * Stream transform that applies {@link createLineRedactor} to a piped
 * stream — used where the output is a Node stream (the viewer's detached
 * pipeline start log) instead of a callback sink.
 */
export class RedactingLineTransform extends Transform {
  private readonly inner: { push(chunk: Buffer | string): void; flush(): void };

  constructor() {
    super();
    this.inner = createLineRedactor((line) => this.push(line));
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    try {
      this.inner.push(chunk);
      callback();
    } catch (err) {
      callback(err instanceof Error ? err : new Error(String(err)));
    }
  }

  _flush(callback: TransformCallback): void {
    try {
      this.inner.flush();
      callback();
    } catch (err) {
      callback(err instanceof Error ? err : new Error(String(err)));
    }
  }
}
