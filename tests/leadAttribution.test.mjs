import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
  ATTR_KEYS,
  ATTR_INPUT_IDS,
  ATTR_STORAGE_KEY,
  createAttributionController,
} from '../src/lib/leadAttribution.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function createMockStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    clear() {
      map.clear();
    },
    dump() {
      const raw = map.get(ATTR_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    },
  };
}

function createMockDom() {
  const inputs = {};
  for (const key of ATTR_KEYS) {
    inputs[ATTR_INPUT_IDS[key]] = { value: '' };
  }
  return {
    inputs,
    doc: {
      getElementById(id) {
        return inputs[id] ?? null;
      },
    },
    resetHiddenInputs() {
      for (const id of Object.keys(inputs)) {
        inputs[id].value = '';
      }
    },
    readAttributionFromDom() {
      const out = {};
      for (const key of ATTR_KEYS) {
        out[key] = inputs[ATTR_INPUT_IDS[key]].value;
      }
      return out;
    },
  };
}

function makeLocation(fullUrl) {
  const u = new URL(fullUrl);
  return {
    href: u.href,
    search: u.search,
  };
}

function assertAllSevenStrings(obj) {
  for (const key of ATTR_KEYS) {
    assert.equal(typeof obj[key], 'string', `Expected ${key} to be a string`);
  }
  assert.deepEqual(Object.keys(obj).sort(), [...ATTR_KEYS].sort());
}

test('1) Full UTM+gclid capture -> navigate to clean path -> values preserved in session', (t) => {
  const storage = createMockStorage();
  const dom = createMockDom();
  let currentLoc = makeLocation(
    'https://wholesale.fiorefoodscanada.com/ads?gclid=CjwKCAjw_111&utm_source=google&utm_medium=cpc&utm_campaign=b2b_ontario&utm_term=spanish+cheese&utm_content=ad_variant_1'
  );

  const ctrl = createAttributionController({
    getStorage: () => storage,
    getLocation: () => currentLoc,
    getDocument: () => dom.doc,
  });

  // Landing with full UTM + gclid
  const firstCapture = ctrl.captureAttribution();
  ctrl.syncAttributionInputs();

  const expected = {
    gclid: 'CjwKCAjw_111',
    utm_source: 'google',
    utm_medium: 'cpc',
    utm_campaign: 'b2b_ontario',
    utm_term: 'spanish cheese',
    utm_content: 'ad_variant_1',
    landing_page:
      'https://wholesale.fiorefoodscanada.com/ads?gclid=CjwKCAjw_111&utm_source=google&utm_medium=cpc&utm_campaign=b2b_ontario&utm_term=spanish+cheese&utm_content=ad_variant_1',
  };
  assert.deepEqual(firstCapture, expected);
  assert.deepEqual(dom.readAttributionFromDom(), expected);

  // Navigate to clean path (no query params) -> fresh DOM inputs on new page
  dom.resetHiddenInputs();
  currentLoc = makeLocation('https://wholesale.fiorefoodscanada.com/');

  const afterNav = ctrl.captureAttribution();
  const synced = ctrl.syncAttributionInputs();
  const submitFields = ctrl.getAttributionForSubmit();

  assertAllSevenStrings(submitFields);
  assert.deepEqual(afterNav, expected);
  assert.deepEqual(synced, expected);
  assert.deepEqual(dom.readAttributionFromDom(), expected);
  assert.deepEqual(submitFields, expected);
  assert.deepEqual(storage.dump(), expected);
  t.diagnostic(`observed after clean nav: ${JSON.stringify(submitFields)}`);
});

test('2) Fresh session / cleared storage, no params -> all attribution fields empty except landing_page set once to entry href', (t) => {
  const storage = createMockStorage();
  storage.clear();
  const dom = createMockDom();
  let currentLoc = makeLocation('https://wholesale.fiorefoodscanada.com/ads');

  const ctrl = createAttributionController({
    getStorage: () => storage,
    getLocation: () => currentLoc,
    getDocument: () => dom.doc,
  });

  const captured = ctrl.captureAttribution();
  ctrl.syncAttributionInputs();
  const submitFields = ctrl.getAttributionForSubmit();

  const expected = {
    gclid: '',
    utm_source: '',
    utm_medium: '',
    utm_campaign: '',
    utm_term: '',
    utm_content: '',
    landing_page: 'https://wholesale.fiorefoodscanada.com/ads',
  };

  assertAllSevenStrings(submitFields);
  assert.deepEqual(captured, expected);
  assert.deepEqual(dom.readAttributionFromDom(), expected);
  assert.deepEqual(submitFields, expected);

  // Subsequent clean navigation does not overwrite landing_page or invent params
  currentLoc = makeLocation('https://wholesale.fiorefoodscanada.com/');
  const second = ctrl.captureAttribution();
  assert.deepEqual(second, expected);
  t.diagnostic(`observed fresh session: ${JSON.stringify(submitFields)}`);
});

test('3) sessionStorage denied (mock throw on getItem/setItem and quota-style setItem throw) -> helpers return current URL values and never throw', (t) => {
  // 3a: Both getItem and setItem throw SecurityError
  const throwingStorage = {
    getItem() {
      throw new Error('SecurityError: sessionStorage is disabled');
    },
    setItem() {
      throw new Error('SecurityError: sessionStorage is disabled');
    },
  };
  const domA = createMockDom();
  const locA = makeLocation(
    'https://wholesale.fiorefoodscanada.com/ads?gclid=GCLID_NO_STORAGE&utm_source=google&utm_campaign=private_browsing'
  );

  const ctrlA = createAttributionController({
    getStorage: () => throwingStorage,
    getLocation: () => locA,
    getDocument: () => domA.doc,
  });

  const expectedA = {
    gclid: 'GCLID_NO_STORAGE',
    utm_source: 'google',
    utm_medium: '',
    utm_campaign: 'private_browsing',
    utm_term: '',
    utm_content: '',
    landing_page:
      'https://wholesale.fiorefoodscanada.com/ads?gclid=GCLID_NO_STORAGE&utm_source=google&utm_campaign=private_browsing',
  };

  assert.doesNotThrow(() => ctrlA.captureAttribution());
  assert.doesNotThrow(() => ctrlA.syncAttributionInputs());
  assert.deepEqual(domA.readAttributionFromDom(), expectedA);
  assert.deepEqual(ctrlA.getAttributionForSubmit(), expectedA);

  // Simulate form.reset() wiping hidden inputs, followed by syncAttributionInputs()
  domA.resetHiddenInputs();
  assert.deepEqual(ctrlA.syncAttributionInputs(), expectedA);
  assert.deepEqual(domA.readAttributionFromDom(), expectedA);

  // 3b: setItem throws QuotaExceededError while getItem returns null (does not throw)
  const quotaStorage = {
    getItem() {
      return null;
    },
    setItem() {
      throw new Error('QuotaExceededError');
    },
  };
  const domB = createMockDom();
  const ctrlB = createAttributionController({
    getStorage: () => quotaStorage,
    getLocation: () => locA,
    getDocument: () => domB.doc,
  });

  assert.doesNotThrow(() => ctrlB.captureAttribution());
  assert.deepEqual(ctrlB.syncAttributionInputs(), expectedA);
  assert.deepEqual(domB.readAttributionFromDom(), expectedA);
  assert.deepEqual(ctrlB.getAttributionForSubmit(), expectedA);
  t.diagnostic(`observed with throwing sessionStorage: ${JSON.stringify(ctrlA.getAttributionForSubmit())}`);
});

test('4) Session has campaign-A UTMs; then URL with only a NEW gclid -> gclid updated, ALL utm_* cleared to "" (no mix)', (t) => {
  const storage = createMockStorage();
  const dom = createMockDom();
  const firstEntryHref =
    'https://wholesale.fiorefoodscanada.com/?utm_source=linkedin&utm_medium=paid_social&utm_campaign=campaign_a&utm_term=charcuterie&utm_content=carousel_1';
  let currentLoc = makeLocation(firstEntryHref);

  const ctrl = createAttributionController({
    getStorage: () => storage,
    getLocation: () => currentLoc,
    getDocument: () => dom.doc,
  });

  // Step 1: Campaign-A UTMs captured (no gclid)
  const step1 = ctrl.captureAttribution();
  assert.deepEqual(step1, {
    gclid: '',
    utm_source: 'linkedin',
    utm_medium: 'paid_social',
    utm_campaign: 'campaign_a',
    utm_term: 'charcuterie',
    utm_content: 'carousel_1',
    landing_page: firstEntryHref,
  });

  // Step 2: Later URL has ONLY a new gclid -> must update gclid and clear all 5 utm_* to ""
  currentLoc = makeLocation('https://wholesale.fiorefoodscanada.com/ads?gclid=EAIaIQobChMI_NEW_CLICK_1');
  const step2 = ctrl.captureAttribution();
  ctrl.syncAttributionInputs();
  const submit2 = ctrl.getAttributionForSubmit();

  const expectedStep2 = {
    gclid: 'EAIaIQobChMI_NEW_CLICK_1',
    utm_source: '',
    utm_medium: '',
    utm_campaign: '',
    utm_term: '',
    utm_content: '',
    landing_page: firstEntryHref,
  };
  assert.deepEqual(step2, expectedStep2);
  assert.deepEqual(dom.readAttributionFromDom(), expectedStep2);
  assert.deepEqual(submit2, expectedStep2);

  // Step 3: Click with gclid_2 + partial UTMs, followed by click with gclid_3 only -> clears prior gclid_2 UTMs too
  currentLoc = makeLocation(
    'https://wholesale.fiorefoodscanada.com/ads?gclid=EAIaIQobChMI_CLICK_2&utm_source=google&utm_medium=cpc&utm_campaign=campaign_b'
  );
  const step3 = ctrl.captureAttribution();
  assert.equal(step3.gclid, 'EAIaIQobChMI_CLICK_2');
  assert.equal(step3.utm_campaign, 'campaign_b');
  assert.equal(step3.utm_term, '');

  // Reloading with the SAME gclid preserves campaign_b UTMs
  currentLoc = makeLocation('https://wholesale.fiorefoodscanada.com/ads?gclid=EAIaIQobChMI_CLICK_2');
  const sameGclidReload = ctrl.captureAttribution();
  assert.equal(sameGclidReload.gclid, 'EAIaIQobChMI_CLICK_2');
  assert.equal(sameGclidReload.utm_source, 'google');
  assert.equal(sameGclidReload.utm_medium, 'cpc');
  assert.equal(sameGclidReload.utm_campaign, 'campaign_b');

  // New gclid_3 with no UTMs clears google/cpc/campaign_b back to ""
  currentLoc = makeLocation('https://wholesale.fiorefoodscanada.com/ads?gclid=EAIaIQobChMI_CLICK_3');
  const step4 = ctrl.captureAttribution();
  assert.deepEqual(step4, {
    gclid: 'EAIaIQobChMI_CLICK_3',
    utm_source: '',
    utm_medium: '',
    utm_campaign: '',
    utm_term: '',
    utm_content: '',
    landing_page: firstEntryHref,
  });
  t.diagnostic(`observed after new gclid-only click: ${JSON.stringify(submit2)}`);
});

test('5) landing_page: first entry URL kept after later navigations (including gclid-only navigation)', (t) => {
  const storage = createMockStorage();
  const dom = createMockDom();
  const entryUrl = 'https://wholesale.fiorefoodscanada.com/?utm_source=newsletter&utm_campaign=fall_catalog';
  let currentLoc = makeLocation(entryUrl);

  const ctrl = createAttributionController({
    getStorage: () => storage,
    getLocation: () => currentLoc,
    getDocument: () => dom.doc,
  });

  ctrl.captureAttribution();
  assert.equal(ctrl.readStoredAttribution().landing_page, entryUrl);

  // Clean internal navigation
  currentLoc = makeLocation('https://wholesale.fiorefoodscanada.com/privacy-policy');
  ctrl.captureAttribution();
  assert.equal(ctrl.readStoredAttribution().landing_page, entryUrl);

  // UTM-only navigation
  currentLoc = makeLocation('https://wholesale.fiorefoodscanada.com/ads?utm_content=cta_footer');
  ctrl.captureAttribution();
  assert.equal(ctrl.readStoredAttribution().landing_page, entryUrl);

  // gclid-only navigation (new click) -> landing_page STILL remains first entry URL
  currentLoc = makeLocation('https://wholesale.fiorefoodscanada.com/ads?gclid=EAIaIQobChMI_LATER_GCLID');
  const finalAttr = ctrl.captureAttribution();
  assert.equal(finalAttr.landing_page, entryUrl);
  assert.equal(finalAttr.gclid, 'EAIaIQobChMI_LATER_GCLID');
  assert.equal(finalAttr.utm_source, '');
  assert.equal(finalAttr.utm_campaign, '');
  assert.equal(finalAttr.utm_content, '');
  t.diagnostic(`observed after multi-hop + gclid-only nav: ${JSON.stringify(finalAttr)}`);
});

test('6) submit.ts passthrough: strips only turnstile_token and forwards gclid + 6 UTM/landing keys intact', async (t) => {
  // 6a: Static verification of src/pages/api/submit.ts
  const submitPath = path.join(repoRoot, 'src/pages/api/submit.ts');
  const submitSource = fs.readFileSync(submitPath, 'utf8');

  assert.match(
    submitSource,
    /const\s*\{\s*turnstile_token:\s*_drop,\s*\.\.\.safePayload\s*\}\s*=\s*body/,
    'submit.ts must strip only turnstile_token via rest spread into safePayload'
  );
  assert.match(
    submitSource,
    /body:\s*JSON\.stringify\(safePayload\)/,
    'submit.ts must forward JSON.stringify(safePayload) to Make webhook'
  );
  for (const key of ATTR_KEYS) {
    assert.equal(
      submitSource.includes(key),
      false,
      `submit.ts should not filter or special-case ${key}`
    );
  }

  // 6b: Unit/runtime verification against the real POST handler in src/pages/api/submit.ts
  // Shim Astro's import.meta.env via Node module loader hook and mock global fetch (NO live network calls).
  registerHooks({
    load(url, context, nextLoad) {
      if (url.endsWith('/src/pages/api/submit.ts')) {
        const loaded = nextLoad(url, context);
        const sourceText =
          typeof loaded.source === 'string'
            ? loaded.source
            : Buffer.from(loaded.source).toString('utf8');
        const patched = sourceText.replaceAll('import.meta.env.', '(process.env.');
        // Balance opening paren added in replacement: import.meta.env.FOO -> (process.env.FOO)
        const balanced = patched
          .replace('(process.env.TURNSTILE_HOSTNAMES', '(process.env.TURNSTILE_HOSTNAMES)')
          .replace('(process.env.TURNSTILE_SECRET', '(process.env.TURNSTILE_SECRET)');
        return { ...loaded, source: balanced };
      }
      return nextLoad(url, context);
    },
  });

  const prevHostnames = process.env.TURNSTILE_HOSTNAMES;
  const prevSecret = process.env.TURNSTILE_SECRET;
  const prevFetch = globalThis.fetch;

  let forwardedUrl = null;
  let forwardedPayload = null;

  process.env.TURNSTILE_HOSTNAMES = 'wholesale.fiorefoodscanada.com';
  process.env.TURNSTILE_SECRET = 'test_secret_not_real';

  globalThis.fetch = async (url, init) => {
    const urlStr = String(url);
    if (urlStr.includes('challenges.cloudflare.com/turnstile/v0/siteverify')) {
      return new Response(
        JSON.stringify({
          success: true,
          action: 'contact-request',
          hostname: 'wholesale.fiorefoodscanada.com',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    forwardedUrl = urlStr;
    forwardedPayload = JSON.parse(String(init?.body ?? '{}'));
    return new Response(JSON.stringify({ accepted: true }), { status: 200 });
  };

  try {
    const { POST } = await import('../src/pages/api/submit.ts');
    const incomingBody = {
      businessName: 'Aurora Fine Cheese Ltd.',
      firstName: 'Jane',
      lastName: 'Smith',
      businessEmail: 'jane@auroracheese.ca',
      province: 'Ontario',
      businessType: 'Cheese Shop',
      businessWebsite: 'www.auroracheese.ca',
      gclid: 'CjwKCAjw_PASSTHROUGH_999',
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'ontario_wholesale',
      utm_term: 'imported cheese distributor',
      utm_content: 'responsive_search_1',
      landing_page: 'https://wholesale.fiorefoodscanada.com/ads?gclid=CjwKCAjw_PASSTHROUGH_999&utm_source=google',
      turnstile_token: 'tok_test_12345',
      privacy_consent: true,
      timestamp: '2026-11-05T23:00:00.000Z',
    };

    const req = new Request('https://wholesale.fiorefoodscanada.com/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(incomingBody),
    });

    const res = await POST({ request: req });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.deepEqual(json, { ok: true });

    assert.ok(forwardedUrl?.startsWith('https://hook.eu1.make.com/'));
    assert.ok(forwardedPayload && typeof forwardedPayload === 'object');
    assert.equal('turnstile_token' in forwardedPayload, false, 'turnstile_token must be stripped');

    const { turnstile_token: _expectedDrop, ...expectedSafePayload } = incomingBody;
    assert.deepEqual(forwardedPayload, expectedSafePayload);
    for (const key of ATTR_KEYS) {
      assert.equal(typeof forwardedPayload[key], 'string');
      assert.equal(forwardedPayload[key], incomingBody[key]);
    }
    t.diagnostic(
      `observed safePayload keys (${Object.keys(forwardedPayload).length}, turnstile_token=${'turnstile_token' in forwardedPayload}): ${JSON.stringify({
        gclid: forwardedPayload.gclid,
        utm_source: forwardedPayload.utm_source,
        utm_medium: forwardedPayload.utm_medium,
        utm_campaign: forwardedPayload.utm_campaign,
        utm_term: forwardedPayload.utm_term,
        utm_content: forwardedPayload.utm_content,
        landing_page: forwardedPayload.landing_page,
      })}`
    );
  } finally {
    globalThis.fetch = prevFetch;
    if (prevHostnames === undefined) delete process.env.TURNSTILE_HOSTNAMES;
    else process.env.TURNSTILE_HOSTNAMES = prevHostnames;
    if (prevSecret === undefined) delete process.env.TURNSTILE_SECRET;
    else process.env.TURNSTILE_SECRET = prevSecret;
  }
});
