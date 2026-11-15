import { performance } from 'node:perf_hooks';
import { Window } from 'happy-dom';
import { tokenizeSubtitle } from '@lexistream/language-core';
import { summarizeDistribution, type DistributionSummary } from '../optimization/pareto';

export interface ExtensionDomBenchmarkResult {
  cueRendering200Transitions: {
    delegatedDocumentFragment: DistributionSummary;
    perWordListeners: DistributionSummary;
    listenerCountDelegated: number;
    listenerCountPerWord: number;
  };
  observerBackgroundChurn300Mutations: {
    scopedPlayerObserverCallbacks: number;
    scopedPlayerTotalMs: number;
    documentWideObserverCallbacks: number;
    documentWideTotalMs: number;
  };
}

export async function runExtensionDomBenchmarks(): Promise<ExtensionDomBenchmarkResult> {
  const win = new Window();
  const doc = win.document as unknown as Document;

  const sampleCue =
    'Every subtitle word becomes interactive without disrupting playback or wasting memory.';
  const tokens = tokenizeSubtitle(sampleCue, 'en');

  // 1. Delegated DocumentFragment vs Per-Word Listeners
  const delegatedHost = doc.createElement('div');
  let delegatedListeners = 3; // mouseover, mouseout, click once on container
  const noop = () => {};
  delegatedHost.addEventListener('mouseover', noop);
  delegatedHost.addEventListener('mouseout', noop);
  delegatedHost.addEventListener('click', noop);

  const perNodeHost = doc.createElement('div');
  let perWordListeners = 0;

  const delegatedSamples: number[] = [];
  const perNodeSamples: number[] = [];

  for (let i = 0; i < 200; i++) {
    const t0 = performance.now();
    delegatedHost.replaceChildren();
    const frag = doc.createDocumentFragment();
    for (const tok of tokens) {
      if (!tok.isWord) {
        frag.appendChild(doc.createTextNode(tok.text));
      } else {
        const sp = doc.createElement('span');
        sp.className = 'lx-word';
        sp.dataset.idx = String(tok.index);
        sp.textContent = tok.text;
        frag.appendChild(sp);
      }
    }
    delegatedHost.appendChild(frag);
    delegatedSamples.push(performance.now() - t0);

    const t1 = performance.now();
    perNodeHost.replaceChildren();
    perWordListeners = 0;
    for (const tok of tokens) {
      if (!tok.isWord) {
        perNodeHost.appendChild(doc.createTextNode(tok.text));
      } else {
        const sp = doc.createElement('span');
        sp.className = 'lx-word';
        sp.textContent = tok.text;
        sp.addEventListener('mouseover', noop);
        sp.addEventListener('mouseout', noop);
        sp.addEventListener('click', noop);
        perWordListeners += 3;
        perNodeHost.appendChild(sp);
      }
    }
    perNodeSamples.push(performance.now() - t1);
  }

  // 2. Scoped #movie_player MutationObserver vs Document-Wide MutationObserver
  doc.body.innerHTML = '';
  const player = doc.createElement('div');
  player.id = 'movie_player';
  const captionBox = doc.createElement('div');
  captionBox.className = 'ytp-caption-window-container';
  player.appendChild(captionBox);

  const commentsFeed = doc.createElement('div');
  commentsFeed.id = 'comments';
  doc.body.appendChild(player);
  doc.body.appendChild(commentsFeed);

  let scopedCallbacks = 0;
  let docWideCallbacks = 0;

  const scopedObs = new win.MutationObserver(() => {
    scopedCallbacks++;
    // Simulate lightweight cue check
    void captionBox.textContent;
  });
  scopedObs.observe(player as unknown as Parameters<typeof scopedObs.observe>[0], {
    childList: true,
    subtree: true,
    characterData: true,
  });

  const tScoped0 = performance.now();
  for (let i = 0; i < 30; i++) {
    for (let j = 0; j < 10; j++) {
      const comment = doc.createElement('div');
      comment.textContent = `Live chat / comment item #${i * 10 + j}`;
      commentsFeed.appendChild(comment);
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  captionBox.textContent = 'Actual subtitle update';
  await new Promise((r) => setTimeout(r, 15));
  const scopedPlayerTotalMs = performance.now() - tScoped0;
  scopedObs.disconnect();

  commentsFeed.replaceChildren();
  const docWideObs = new win.MutationObserver(() => {
    docWideCallbacks++;
    void doc.querySelector('.ytp-caption-window-container')?.textContent;
  });
  docWideObs.observe(doc.body as unknown as Parameters<typeof docWideObs.observe>[0], {
    childList: true,
    subtree: true,
    characterData: true,
  });

  const tDoc0 = performance.now();
  for (let i = 0; i < 30; i++) {
    for (let j = 0; j < 10; j++) {
      const comment = doc.createElement('div');
      comment.textContent = `Live chat / comment item #${i * 10 + j}`;
      commentsFeed.appendChild(comment);
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  captionBox.textContent = 'Actual subtitle update 2';
  await new Promise((r) => setTimeout(r, 15));
  const documentWideTotalMs = performance.now() - tDoc0;
  docWideObs.disconnect();

  await win.happyDOM.close();

  return {
    cueRendering200Transitions: {
      delegatedDocumentFragment: summarizeDistribution(delegatedSamples),
      perWordListeners: summarizeDistribution(perNodeSamples),
      listenerCountDelegated: delegatedListeners,
      listenerCountPerWord: perWordListeners,
    },
    observerBackgroundChurn300Mutations: {
      scopedPlayerObserverCallbacks: scopedCallbacks,
      scopedPlayerTotalMs,
      documentWideObserverCallbacks: docWideCallbacks,
      documentWideTotalMs,
    },
  };
}
