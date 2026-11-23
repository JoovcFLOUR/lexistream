import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

let apiProcess: ChildProcess | null = null;
const TEST_API_PORT = 18787;
const TEST_API_URL = `http://127.0.0.1:${TEST_API_PORT}`;

test.beforeAll(async () => {
  const binPath = path.resolve(process.cwd(), 'target/debug/lexistream-api');
  apiProcess = spawn(binPath, [], {
    env: {
      ...process.env,
      BIND_ADDR: `127.0.0.1:${TEST_API_PORT}`,
      DATABASE_URL:
        process.env.DATABASE_URL ??
        'postgres://lexistream:lexistream_dev_password@127.0.0.1:54329/lexistream',
    },
    stdio: 'ignore',
  });

  // Wait for /api/v1/health
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${TEST_API_URL}/api/v1/health`);
      if (res.ok) break;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 150));
  }
});

test.afterAll(() => {
  apiProcess?.kill('SIGTERM');
});

test.describe('LexiStream End-to-End Browser & Backend Sync Suite', () => {
  test('captures contextual vocabulary from interactive YouTube subtitles and reviews flashcards offline', async ({
    page,
  }) => {
    await page.goto('/youtube-fixture.html');

    const overlay = page.locator('[data-lexistream-overlay="true"]');
    await expect(overlay).toContainText('I never thought this would happen.');

    // Hover over "thought" (verb context)
    const thoughtWord = overlay.locator('.lx-word', { hasText: 'thought' });
    await thoughtWord.hover();

    const tooltipHost = page.locator('[data-lexistream-tooltip-host="true"]');
    await expect(tooltipHost).toBeVisible();
    await expect(tooltipHost.locator('.meta')).toContainText('think · verb');
    await expect(tooltipHost.locator('.translation')).toContainText('pensei / pensou');

    // Click to capture into IndexedDB
    await thoughtWord.click();
    await expect(tooltipHost.locator('.status-badge')).toContainText('Saved (1 context)');

    // Switch to Cue 2 ("That was a fascinating thought by the river bank.")
    await page.locator('#cue-2').click();
    await expect(overlay).toContainText('river bank');

    const bankWord = overlay.locator('.lx-word', { hasText: 'bank' });
    await bankWord.hover();
    await expect(tooltipHost.locator('.translation')).toContainText('margem');
    await bankWord.click();
    await expect(tooltipHost.locator('.status-badge')).toContainText('Saved');

    // Toggle captions off -> verify graceful fallback pill
    await page.locator('#cue-off').click();
    await expect(overlay.locator('.lexistream-status-pill')).toContainText(
      'Enable YouTube captions (CC)',
    );

    // Navigate to Study Dashboard on same origin (shares IndexedDB)
    await page.goto('/');
    await expect(page.getByTestId('kpi-collected')).toHaveText('2');
    await expect(page.getByTestId('kpi-awaiting')).toHaveText('2');

    // Inspect Vocabulary Library & deep-link timestamp
    await page.getByTestId('nav-vocabulary').click();
    await expect(page.getByTestId('vocab-card')).toHaveCount(2);
    await expect(page.locator('a[href*="t=125s"]')).toBeVisible();

    // Complete FSRS Flashcard review session
    await page.getByTestId('nav-flashcards').click();
    await page.getByTestId('reveal-answer-btn').click();
    await page.getByTestId('rate-good').click();

    await page.getByTestId('reveal-answer-btn').click();
    await page.getByTestId('rate-easy').click();

    await expect(page.getByTestId('flashcards-empty')).toContainText('All Caught Up!');

    // Verify Statistics reflects reviewed count honestly
    await page.getByTestId('nav-statistics').click();
    await expect(page.locator('main')).toContainText('Demonstrably Retained');
  });

  test('synchronizes offline vocabulary and FSRS progress across two independent browser devices via Rust + PostgreSQL API', async ({
    browser,
  }) => {
    const email = `e2e-sync-${Date.now()}@example.com`;
    const password = 'SafeSyncPassword123!';

    // Device A: capture offline, then register and sync push
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await pageA.goto('/');
    await pageA.getByTestId('seed-sample-btn').click();
    await expect(pageA.getByTestId('kpi-collected')).toHaveText('2');

    await pageA.getByTestId('nav-settings').click();
    await pageA.getByLabel('Rust Backend API URL').fill(TEST_API_URL);
    await pageA.getByLabel('Account Email').fill(email);
    await pageA.getByLabel('Password').fill(password);
    await pageA.getByRole('button', { name: 'Register Account' }).click();
    await expect(pageA.getByRole('status')).toContainText(`Authenticated as ${email}`);

    await pageA.getByTestId('sync-now-btn').click();
    await expect(pageA.getByRole('status')).toContainText('pushed 2 words');
    await contextA.close();

    // Device B (fresh isolated IndexedDB): sign in and pull synced vocabulary
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await pageB.goto('/');
    await expect(pageB.getByTestId('kpi-collected')).toHaveText('0');

    await pageB.getByTestId('nav-settings').click();
    await pageB.getByLabel('Rust Backend API URL').fill(TEST_API_URL);
    await pageB.getByLabel('Account Email').fill(email);
    await pageB.getByLabel('Password').fill(password);
    await pageB.getByRole('button', { name: 'Sign In' }).click();
    await expect(pageB.getByRole('status')).toContainText(`Authenticated as ${email}`);

    await pageB.getByTestId('sync-now-btn').click();
    await expect(pageB.getByRole('status')).toContainText('pulled 2 words');

    await pageB.getByTestId('nav-dashboard').click();
    await expect(pageB.getByTestId('kpi-collected')).toHaveText('2');
    await contextB.close();
  });

  test('starts with zero pre-installed dictionaries, downloads Wiktionary pack on click, powers YouTube hover offline, and uninstalls cleanly', async ({
    page,
  }) => {
    await page.route('**/en-pt-enwiktionary.txt', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: [
          '# English :: Portuguese Wiktionary CC BY-SA',
          'fascinating {adj} (captivatingly interesting) :: fascinante, encantador',
          'aardvark {n} (burrowing mammal) :: porco-formigueiro {m}',
        ].join('\n'),
      });
    });

    await page.goto('/#dictionaries');
    await expect(page.getByTestId('installed-dicts-count')).toHaveText('0');

    // Click download on Inglês -> Português
    await page.getByTestId('download-dict-en-pt').click();
    await expect(page.getByTestId('installed-dicts-count')).toHaveText('1');
    await expect(page.getByTestId('dict-card-en-pt')).toContainText('Installed');

    // Verify YouTube subtitle hover immediately uses the newly downloaded offline Wiktionary pack
    await page.goto('/youtube-fixture.html');
    await page.locator('#cue-2').click();
    const overlay = page.locator('[data-lexistream-overlay="true"]');
    const fascinatingWord = overlay.locator('.lx-word', { hasText: 'fascinating' });
    await fascinatingWord.hover();

    const tooltipHost = page.locator('[data-lexistream-tooltip-host="true"]');
    await expect(tooltipHost.locator('.translation')).toContainText('fascinante, encantador');

    // Uninstall dictionary and verify storage returns to 0
    await page.goto('/#dictionaries');
    await page.getByTestId('remove-dict-en-pt').click();
    await expect(page.getByTestId('installed-dicts-count')).toHaveText('0');
  });

  test('auto-pauses playing YouTube video on subtitle word hover so subtitles never disappear mid-study, and resumes on pointer leave', async ({
    page,
  }) => {
    await page.goto('/youtube-fixture.html');

    // Start video playback -> status switches to PLAYING
    await page.locator('#play-pause-btn').click();
    const status = page.locator('#playback-status');
    await expect(status).toContainText('PLAYING');

    // Hover over a subtitle word -> video auto-pauses immediately
    const overlay = page.locator('[data-lexistream-overlay="true"]');
    const word = overlay.locator('.lx-word', { hasText: 'thought' }).first();
    await word.hover();
    await expect(status).toContainText('PAUSED');
    await expect(overlay.locator('.lexistream-caption-bar')).toHaveAttribute(
      'data-autopause',
      'true',
    );

    // Move mouse outside the subtitle bar -> video automatically resumes playing
    await page.mouse.move(20, 20);
    await expect(status).toContainText('PLAYING');
  });

  test('renders complete static embedded-style subtitle blocks immediately without word-by-word ASR roll-up movement', async ({
    page,
  }) => {
    await page.goto('/youtube-fixture.html');
    await page.locator('.lx-word').first().waitFor({ state: 'visible' });

    // Trigger ASR word-by-word stream simulation (raw DOM has only 1st word "voterai" at t=10.1s)
    await page.locator('#asr-rollup-btn').click();

    const overlay = page.locator('[data-lexistream-overlay="true"]');
    // Immediately displays the FULL static sentence even while raw DOM only has "voterai"!
    await expect(overlay).toHaveText(
      'voterai lors des prochaines élections présidentielles en 2027.',
    );

    const boxAtStart = await overlay.locator('.lexistream-caption-bar').boundingBox();
    await page.waitForTimeout(450);
    const boxDuringSpeech = await overlay.locator('.lexistream-caption-bar').boundingBox();

    // Zero width/position jitter while words are spoken!
    expect(boxDuringSpeech?.width).toBeCloseTo(boxAtStart?.width ?? 0, 0);
    expect(boxDuringSpeech?.x).toBeCloseTo(boxAtStart?.x ?? 0, 0);
  });

  test('displays optional smaller secondary translated subtitle in blurred (hover-to-reveal) or visible mode, and switches target language live', async ({
    page,
  }) => {
    await page.goto('/youtube-fixture.html');
    await page.locator('.lx-word').first().waitFor({ state: 'visible' });
    await page.locator('#asr-rollup-btn').click();

    const overlay = page.locator('[data-lexistream-overlay="true"]');
    // Default Off: no secondary subtitle line
    await expect(overlay.locator('.lx-secondary-sub')).toHaveCount(0);

    // Switch to Blurred mode: secondary Portuguese line appears blurred, then unblurs on hover!
    await page.locator('#secondary-mode-select').selectOption('blurred');
    const secSub = overlay.locator('.lx-secondary-sub');
    await expect(secSub).toHaveText('votarei nas próximas eleições presidenciais em 2027.');

    const blurredFilter = await secSub.evaluate((el) => getComputedStyle(el).filter);
    expect(blurredFilter).toContain('blur');

    await secSub.hover();
    const hoverFilter = await secSub.evaluate((el) => getComputedStyle(el).filter);
    expect(hoverFilter).toBe('none');

    // Switch to Visible mode: stays unblurred even when mouse moves away!
    await page.mouse.move(10, 10);
    await page.locator('#secondary-mode-select').selectOption('visible');
    await expect(secSub).toHaveAttribute('data-visibility', 'visible');
    const visibleFilter = await secSub.evaluate((el) => getComputedStyle(el).filter);
    expect(visibleFilter).toBe('none');

    // Switch target language live from PT -> EN
    await page.locator('#secondary-lang-select').selectOption('en');
    await expect(secSub).toHaveText('will vote in the next presidential elections in 2027.');

    // Restore Off
    await page.locator('#secondary-mode-select').selectOption('off');
    await expect(overlay.locator('.lx-secondary-sub')).toHaveCount(0);
  });
});
