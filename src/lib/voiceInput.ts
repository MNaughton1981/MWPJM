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

  r.onresult = (event) => {
    let interim = '';
    let finalText = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) finalText += result[0].transcript;
      else interim += result[0].transcript;
    }
    if (finalText) cb.onAppendFinal(finalText);
    if (interim) cb.onInterim(interim);
  };
  r.onerror = (event) => cb.onError(event.error || 'unknown');
  r.onend = cb.onEnd;

  return {
    start: () => r.start(),
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
