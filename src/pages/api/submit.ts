// src/pages/api/submit.ts
// Server-side endpoint: validates Turnstile token, then forwards to Make.com.
import type { APIRoute } from 'astro';

export const prerender = false; // force server-side in hybrid mode

const EXPECTED_ACTION = 'contact-request';
const MAKE_WEBHOOK = 'https://hook.eu1.make.com/p2y0iv7yw5or87vjmhkniwf2fjd1ejyo';

export const POST: APIRoute = async ({ request }) => {
  // ── 1. Parse body ──────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'invalid_json' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── 2. Turnstile token basic validation ────────────────────────────────────
  const token = body['turnstile_token'];
  if (
    typeof token !== 'string' ||
    token.length === 0 ||
    token.length > 2048
  ) {
    return new Response(JSON.stringify({ ok: false, error: 'missing_token' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── 3. Hostname allowlist ──────────────────────────────────────────────────
  const expectedHostnames = new Set(
    (import.meta.env.TURNSTILE_HOSTNAMES ?? '')
      .split(',')
      .map((h: string) => h.trim())
      .filter(Boolean),
  );
  if (expectedHostnames.size === 0) {
    console.error('[turnstile] TURNSTILE_HOSTNAMES is not configured');
    return new Response(JSON.stringify({ ok: false, error: 'server_config' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── 4. Siteverify ──────────────────────────────────────────────────────────
  const secret = import.meta.env.TURNSTILE_SECRET;
  if (!secret || secret === 'REPLACE_WITH_YOUR_WIDGET_SECRET') {
    console.error('[turnstile] TURNSTILE_SECRET is not configured');
    return new Response(JSON.stringify({ ok: false, error: 'server_config' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Collect the client IP (Cloudflare passes CF-Connecting-IP; fall back to X-Forwarded-For)
  const clientIp =
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    '';

  let siteverifyResult: { success: boolean; action?: string; hostname?: string; 'error-codes'?: string[] };
  try {
    const sv = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: AbortSignal.timeout(10_000),
        body: new URLSearchParams({
          secret,
          response: token,
          ...(clientIp ? { remoteip: clientIp } : {}),
        }),
      },
    );
    if (!sv.ok) throw new Error(`siteverify HTTP ${sv.status}`);
    siteverifyResult = await sv.json();
  } catch (err) {
    console.error('[turnstile] siteverify fetch failed:', err);
    return new Response(JSON.stringify({ ok: false, error: 'siteverify_unavailable' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── 5. Enforce success + action + hostname ─────────────────────────────────
  if (
    !siteverifyResult.success ||
    siteverifyResult.action !== EXPECTED_ACTION ||
    !expectedHostnames.has(siteverifyResult.hostname ?? '')
  ) {
    console.warn('[turnstile] rejected:', {
      success: siteverifyResult.success,
      action: siteverifyResult.action,
      hostname: siteverifyResult.hostname,
      errors: siteverifyResult['error-codes'],
    });
    return new Response(JSON.stringify({ ok: false, error: 'forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── 6. Forward to Make.com ─────────────────────────────────────────────────
  // Strip the token before forwarding (it has already been redeemed)
  const { turnstile_token: _drop, ...safePayload } = body as Record<string, unknown> & { turnstile_token: string };

  try {
    const makeRes = await fetch(MAKE_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify(safePayload),
    });
    if (!makeRes.ok) throw new Error(`Make.com responded ${makeRes.status}`);
  } catch (err) {
    console.error('[submit] Make.com webhook failed:', err);
    return new Response(JSON.stringify({ ok: false, error: 'webhook_failed' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
