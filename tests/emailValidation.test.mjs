import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
  EMAIL_REGEX,
  EMAIL_ERROR_MESSAGE,
  isValidEmail,
} from '../src/lib/emailValidation.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

test('isValidEmail accepts valid email addresses', () => {
  const validEmails = [
    'name@gmail.com',
    'first.last@company.ca',
    'a+b@sub.domain.co.uk',
    ' name@gmail.com ',
    "o'neil@fiore.ca",
  ];

  for (const email of validEmails) {
    assert.equal(isValidEmail(email), true, `Expected valid: ${JSON.stringify(email)}`);
  }
});

test('isValidEmail rejects incomplete, malformed, non-string, and overly long emails', () => {
  const longEmail = `${'a'.repeat(290)}@gmail.com`;
  assert.equal(longEmail.length, 300);

  const invalidEmails = [
    'name@gmail',
    'name@gmail.',
    'name@.com',
    'name@gmail.c',
    '@gmail.com',
    'name.gmail.com',
    'name@@gmail.com',
    'name@gm ail.com',
    'name@gmail..com',
    '',
    null,
    undefined,
    123,
    longEmail,
  ];

  for (const email of invalidEmails) {
    assert.equal(isValidEmail(email), false, `Expected invalid: ${JSON.stringify(email)}`);
  }
});

test('EMAIL_REGEX and EMAIL_ERROR_MESSAGE are exported with expected values', () => {
  assert.ok(EMAIL_REGEX instanceof RegExp);
  assert.equal(
    EMAIL_ERROR_MESSAGE,
    'Please enter a complete email address, including the domain (e.g. name@company.com).'
  );
});

test('source-level checks: submit.ts validates email before fetch and AdsForm.astro wires pattern + isValidEmail', () => {
  const submitSource = fs.readFileSync(
    path.join(repoRoot, 'src/pages/api/submit.ts'),
    'utf8'
  );
  assert.match(
    submitSource,
    /import\s*\{[^}]*\bisValidEmail\b[^}]*\}\s*from\s*['"]\.\.\/\.\.\/lib\/emailValidation(?:\.ts)?['"]/,
    'submit.ts must import isValidEmail'
  );
  assert.ok(
    submitSource.includes("'invalid_email'"),
    "submit.ts must contain 'invalid_email'"
  );

  const checkIndex = submitSource.indexOf('isValidEmail(');
  const fetchIndex = submitSource.indexOf('fetch(');
  assert.ok(checkIndex !== -1, 'submit.ts must call isValidEmail(');
  assert.ok(fetchIndex !== -1, 'submit.ts must contain fetch(');
  assert.ok(
    checkIndex < fetchIndex,
    'isValidEmail check must appear before the first fetch( call in submit.ts'
  );

  const formSource = fs.readFileSync(
    path.join(repoRoot, 'src/components/AdsForm.astro'),
    'utf8'
  );
  assert.ok(
    formSource.includes('isValidEmail'),
    'AdsForm.astro must reference isValidEmail'
  );
  const emailInputMatch = formSource.match(
    /<input\b[^>]*id="ads-f-business-email"[^>]*>/
  );
  assert.ok(emailInputMatch, 'AdsForm.astro must contain #ads-f-business-email input');
  const patternMatch = emailInputMatch[0].match(/pattern="([^"]+)"/);
  assert.ok(patternMatch, '#ads-f-business-email input must have a pattern attribute');
  assert.equal(patternMatch[1], '[^@\\s]+@[^@\\s]+\\.[A-Za-z]{2,}');

  // Verify browser v-flag compatibility of the HTML pattern attribute
  const vRegex = new RegExp(`^(?:${patternMatch[1]})$`, 'v');
  assert.equal(vRegex.test('name@gmail.com'), true);
  assert.equal(vRegex.test('name@gmail'), false);
});

test('submit.ts runtime rejects invalid_email and non-object JSON with 400 before calling fetch', async () => {
  registerHooks({
    load(url, context, nextLoad) {
      if (url.endsWith('/src/pages/api/submit.ts')) {
        const loaded = nextLoad(url, context);
        const sourceText =
          typeof loaded.source === 'string'
            ? loaded.source
            : Buffer.from(loaded.source).toString('utf8');
        const patched = sourceText
          .replaceAll('import.meta.env.TURNSTILE_HOSTNAMES', 'process.env.TURNSTILE_HOSTNAMES')
          .replaceAll('import.meta.env.TURNSTILE_SECRET', 'process.env.TURNSTILE_SECRET');
        return { ...loaded, source: patched };
      }
      return nextLoad(url, context);
    },
  });

  const prevFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('fetch must not be called for invalid_email or invalid_json');
  };

  try {
    const { POST } = await import('../src/pages/api/submit.ts');

    const badEmailReq = new Request('https://wholesale.fiorefoodscanada.com/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessEmail: 'name@gmail',
        turnstile_token: 'tok_test',
      }),
    });
    const badEmailRes = await POST({ request: badEmailReq });
    assert.equal(badEmailRes.status, 400);
    assert.deepEqual(await badEmailRes.json(), { ok: false, error: 'invalid_email' });
    assert.equal(fetchCalls, 0);

    for (const badBody of ['null', '[]']) {
      const badJsonReq = new Request('https://wholesale.fiorefoodscanada.com/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: badBody,
      });
      const badJsonRes = await POST({ request: badJsonReq });
      assert.equal(badJsonRes.status, 400);
      assert.deepEqual(await badJsonRes.json(), { ok: false, error: 'invalid_json' });
      assert.equal(fetchCalls, 0);
    }
  } finally {
    globalThis.fetch = prevFetch;
  }
});
