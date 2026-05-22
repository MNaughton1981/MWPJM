/**
 * Thin wrapper around the Web Speech API (SpeechRecognition).
 *
 * Privacy note: in Chrome / Edge / Pixel Chrome, audio is streamed to
 * the browser vendor's transcription service (Google for Chrome,
 * Microsoft for Edge). Audio is not retained per the vendors' docs, but
 * corporate IT policies sometimes prohibit this — the user opted in.
 *
 * Browser support (May 2026): Chrome, Edge, Pixel Chrome (good).
 * Safari / iOS: partial / unreliable. Firefox: no.
 * Always feature-detect via isVoiceInputSupported() before showing UI.
 */

interface SpeechRecognitionAlternative {
  transcript: string;
}
interface SpeechRecognitionResult {
  isFinal: boolean;
  0: SpeechRecognitionAlternative;
}
interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEvent {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEvent {
  error: string;
}
interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface WindowWithSR extends Window {
  SpeechRecognition?: { new (): SpeechRecognitionInstance };
  webkitSpeechRecognition?: { new (): SpeechRecognitionInstance };
}

function getSRClass():
  | { new (): SpeechRecognitionInstance }
  | undefined {
  const w = window as WindowWithSR;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function isVoiceInputSupported(): boolean {
  return !!getSRClass();
}

export interface VoiceController {
  start: () => void;
  stop: () => void;
  destroy: () => void;
}

export interface VoiceCallbacks {
  /** Called frequently while the user is speaking — partial guess. */
  onInterim: (text: string) => void;
  /** Called when the engine commits a chunk of text (sentence boundary). */
  onAppendFinal: (text: string) => void;
  /** Called on any recognition error (mic denied, network, no speech, …). */
  onError: (err: string) => void;
  /** Called when recognition ends (whether by user or by engine timeout). */
  onEnd: () => void;
  lang?: string;
}

export function createVoiceInput(cb: VoiceCallbacks): VoiceController | null {
  const SR = getSRClass();
  if (!SR) return null;

  const r = new SR();
  r.continuous = true;
  r.interimResults = true;
  r.lang = cb.lang ?? 'en-US';

  // Track which result indices we've already committed as final.
  // Pixel/Android Chrome doesn't always advance event.resultIndex correctly,
  // so trusting it caused the "Joe Joe Joe Joe Warren Joe Warren..." echo
  // pattern. We iterate all results every event but only emit ones we
  // haven't seen committed yet.
  let lastCommittedIndex = -1;

  r.onresult = (event) => {
    let interim = '';
    let newFinal = '';
    for (let i = 0; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        if (i > lastCommittedIndex) {
          newFinal += result[0].transcript;
          lastCommittedIndex = i;
        }
      } else {
        interim += result[0].transcript;
      }
    }
    if (newFinal) cb.onAppendFinal(newFinal);
    // Always call onInterim, even with '', so stale interim text clears
    // when the engine moves a phrase from interim → final.
    cb.onInterim(interim);
  };
  r.onerror = (event) => cb.onError(event.error || 'unknown');
  r.onend = cb.onEnd;

  return {
    start: () => {
      // Reset committed-index tracking for each new dictation session.
      lastCommittedIndex = -1;
      r.start();
    },
    stop: () => r.stop(),
    destroy: () => {
      r.onresult = null;
      r.onerror = null;
      r.onend = null;
      try {
        r.abort();
      } catch {
        // ignore
      }
    },
  };
}
