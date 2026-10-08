(() => {
  'use strict';
  const main = document.querySelector('main.chapter');
  const panel = document.querySelector('[data-speech-reader]');
  if (!main || !panel || !window.LectureSpeechContent) return;
  // Capture the original MathML before the following deferred MathJax script
  // replaces it with SVG. Never reconstruct formula speech from visible glyphs.
  const captured = window.LectureSpeechContent.capture(main);
  const controls = {
    voice: panel.querySelector('[data-speech-voice]'),
    rate: panel.querySelector('[data-speech-rate]'),
    pitch: panel.querySelector('[data-speech-pitch]'),
    start: panel.querySelector('[data-speech-start]'),
    follow: panel.querySelector('[data-speech-follow]'),
    play: panel.querySelector('[data-speech-play]'),
    pause: panel.querySelector('[data-speech-pause]'),
    stop: panel.querySelector('[data-speech-stop]'),
    preview: panel.querySelector('[data-speech-preview]'),
    status: panel.querySelector('[data-speech-status]')
  };
  const synth = window.speechSynthesis;
  if (!synth || !window.SpeechSynthesisUtterance) {
    controls.status.textContent = 'Read aloud is not available in this browser. Try opening this page in Safari, Chrome or Edge.';
    for (const input of panel.querySelectorAll('button, select, input')) input.disabled = true;
    return;
  }
  const preferenceKey = 'franck-sueur-narration';
  let preference = {};
  try { preference = JSON.parse(localStorage.getItem(preferenceKey) || '{}'); } catch (_) {}
  if (!preference || typeof preference !== 'object' || Array.isArray(preference)) preference = {};
  if ([0.75, 0.85, 1, 1.15, 1.3].includes(Number(preference.rate))) controls.rate.value = String(preference.rate);
  if ([0.82, 0.9, 1].includes(Number(preference.pitch))) controls.pitch.value = String(preference.pitch);
  let voices = [];
  let token = 0;
  let state = 'idle';
  let currentUtterance;
  let workerPromise;
  let reading = [];
  let index = 0;
  let highlighted;
  let pendingResume;
  const mathCache = new Map();
  const sectionIds = new Set();
  for (const chunk of captured) {
    if (chunk.kind !== 'heading' || !/^H[23]$/.test(chunk.element.tagName) || !chunk.sectionId || sectionIds.has(chunk.sectionId)) continue;
    sectionIds.add(chunk.sectionId);
    const option = document.createElement('option');
    option.value = chunk.sectionId;
    const navigation = Array.from(document.querySelectorAll('.toc-link')).find(link => link.hash === '#' + chunk.sectionId);
    option.textContent = (navigation?.textContent || chunk.tokens.filter(t => t.kind === 'text').map(t => t.text).join(' ')).replace(/\s+/g, ' ').trim();
    controls.start.append(option);
  }
  function savePreference() {
    const voice = selectedVoice();
    preference = { voice: voice?.voiceURI, rate: Number(controls.rate.value), pitch: Number(controls.pitch.value) };
    try { localStorage.setItem(preferenceKey, JSON.stringify(preference)); } catch (_) {}
  }
  function selectedVoice() { return voices.find(v => v.voiceURI === controls.voice.value); }
  function refreshVoices() {
    const old = controls.voice.value || preference.voice;
    voices = synth.getVoices().filter(v => /^en(?:[-_]|$)/i.test(v.lang));
    voices.sort((a, b) => {
      const score = v => (/^en[-_]GB/i.test(v.lang) ? 0 : 2) + (v.localService ? 0 : 1);
      return score(a) - score(b) || a.name.localeCompare(b.name);
    });
    controls.voice.replaceChildren();
    if (!voices.length) {
      const option = document.createElement('option'); option.value = ''; option.textContent = 'System voice · English'; controls.voice.append(option);
      return;
    }
    for (const voice of voices) {
      const option = document.createElement('option'); option.value = voice.voiceURI; option.textContent = `${voice.name} · ${voice.lang}`; controls.voice.append(option);
    }
    const preferred = voices.find(v => v.voiceURI === old)
      || voices.find(v => v.name === 'Daniel' && /^en[-_]GB/i.test(v.lang))
      || voices[0];
    controls.voice.value = preferred.voiceURI;
  }
  refreshVoices();
  synth.addEventListener('voiceschanged', refreshVoices);
  controls.voice.addEventListener('change', savePreference);
  controls.rate.addEventListener('change', savePreference);
  controls.pitch.addEventListener('change', savePreference);

  const mini = document.createElement('div');
  mini.className = 'speech-miniplayer';
  mini.hidden = true;
  const miniStatus = document.createElement('span');
  const miniPause = document.createElement('button');
  miniPause.type = 'button'; miniPause.textContent = 'Pause'; miniPause.setAttribute('aria-label', 'Pause narration');
  const miniStop = document.createElement('button');
  miniStop.type = 'button'; miniStop.textContent = 'Stop'; miniStop.setAttribute('aria-label', 'Stop narration');
  mini.append(miniStatus, miniPause, miniStop);
  document.body.append(mini);
  miniPause.addEventListener('click', () => state === 'paused' ? controls.play.click() : controls.pause.click());
  miniStop.addEventListener('click', () => controls.stop.click());

  function setState(next, message) {
    state = next;
    controls.play.textContent = next === 'paused' ? 'Resume' : 'Play';
    controls.play.disabled = next === 'playing' || next === 'preparing' || next === 'preview';
    controls.pause.disabled = next !== 'playing' && next !== 'preparing';
    controls.stop.disabled = next === 'idle';
    controls.preview.disabled = next !== 'idle';
    controls.start.disabled = next !== 'idle';
    if (message) controls.status.textContent = message;
    panel.dataset.speechState = next;
    mini.hidden = next === 'idle' || next === 'preview';
    miniStatus.textContent = next === 'paused' ? 'Paused' : (next === 'preparing' ? 'Preparing narration…' : `Reading ${index + 1} of ${reading.length}`);
    miniPause.textContent = next === 'paused' ? 'Resume' : 'Pause';
    miniPause.setAttribute('aria-label', next === 'paused' ? 'Resume narration' : 'Pause narration');
  }
  function clearHighlight() { highlighted?.classList.remove('speech-current'); highlighted = undefined; }
  function stop(message = 'Stopped.') {
    token += 1;
    synth.cancel();
    currentUtterance = undefined;
    pendingResume = undefined;
    clearHighlight();
    setState('idle', message);
  }
  function isVisible(element) {
    return element?.isConnected && element.getClientRects().length > 0;
  }
  function buildReading() {
    const chunks = captured.filter(c => isVisible(c.element));
    const startAt = controls.start.value;
    const startIndex = startAt ? chunks.findIndex(c => c.sectionId === startAt) : 0;
    return chunks.slice(Math.max(0, startIndex));
  }
  function splitSpeech(text) {
    const parts = [];
    let remaining = text.replace(/\s+/g, ' ').trim();
    while (remaining.length > 220) {
      let end = remaining.lastIndexOf(' ', 220);
      if (end < 80) end = 220;
      const sentence = remaining.slice(0, end).match(/[.!?;](?=\s)[^.!?;]*$/);
      if (sentence && sentence.index > 80) end = sentence.index + 1;
      parts.push(remaining.slice(0, end).trim());
      remaining = remaining.slice(end).trim();
    }
    if (remaining) parts.push(remaining);
    return parts;
  }
  // Speech engine integration is supplied by a separate, lazily loaded module.
  // It reads the original MathML with mathematical speech rules.
  async function mathematicalSpeech(mathml) {
    if (!mathCache.has(mathml)) {
      if (!workerPromise) workerPromise = Promise.resolve(window.LectureMathSpeech.create());
      const speech = workerPromise.then(engine => engine.speak(mathml));
      mathCache.set(mathml, speech);
      speech.catch(() => { mathCache.delete(mathml); workerPromise = undefined; });
    }
    return mathCache.get(mathml);
  }
  async function speechFor(chunk) {
    const words = await Promise.all(chunk.tokens.map(t => t.kind === 'math' ? mathematicalSpeech(t.mathml) : t.text));
    return splitSpeech(words.join(' '));
  }
  function speak(text, myToken, ended) {
    panel.dataset.speechText = text;
    const utterance = new SpeechSynthesisUtterance(text);
    currentUtterance = utterance;
    const voice = selectedVoice();
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang || 'en-GB';
    utterance.rate = Number(controls.rate.value);
    utterance.pitch = Number(controls.pitch.value);
    utterance.onend = () => {
      if (myToken !== token) return;
      currentUtterance = undefined;
      if (state === 'paused') pendingResume = ended;
      else ended();
    };
    utterance.onerror = event => {
      if (myToken !== token) return;
      stop('Narration could not play. Try another voice or press Play again.');
    };
    synth.speak(utterance);
  }
  async function readNext(myToken) {
    if (myToken !== token) return;
    if (state === 'paused') { pendingResume = () => readNext(myToken); return; }
    if (index >= reading.length) { clearHighlight(); setState('idle', 'End of this page.'); return; }
    const chunk = reading[index];
    setState('preparing', `Preparing passage ${index + 1} of ${reading.length}…`);
    let parts;
    try { parts = await speechFor(chunk); }
    catch (error) {
      console.warn('Mathematical narration could not be prepared:', error);
      if (myToken === token) stop('The mathematical narration could not load. Please try again; the text and formulas remain available on the page.');
      return;
    }
    if (myToken !== token) return;
    if (state === 'paused') { pendingResume = () => readPrepared(); return; }
    readPrepared();
    function readPrepared() {
      if (myToken !== token) return;
      clearHighlight(); highlighted = chunk.element; highlighted.classList.add('speech-current');
      if (controls.follow.checked) highlighted.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setState('playing', `Reading passage ${index + 1} of ${reading.length}.`);
      let part = 0;
      function nextPart() {
        if (myToken !== token) return;
        if (part < parts.length) speak(parts[part++], myToken, nextPart);
        else { index += 1; readNext(myToken); }
      }
      nextPart();
    }
  }
  controls.play.addEventListener('click', () => {
    if (state === 'paused') {
      setState('playing', `Reading passage ${index + 1} of ${reading.length}.`);
      synth.resume();
      if (pendingResume) { const resume = pendingResume; pendingResume = undefined; resume(); }
      return;
    }
    synth.cancel(); synth.resume();
    reading = buildReading(); index = 0; token += 1;
    if (!reading.length) { setState('idle', 'There is no visible passage to read.'); return; }
    savePreference(); readNext(token);
  });
  controls.pause.addEventListener('click', () => {
    synth.pause(); setState('paused', 'Paused. Press Resume to continue.');
  });
  controls.stop.addEventListener('click', () => stop());
  controls.preview.addEventListener('click', () => {
    synth.cancel(); synth.resume(); token += 1; setState('preview', 'Playing a short voice sample…');
    savePreference();
    speak('An important case of topological spaces is given by metric spaces that we now introduce.', token, () => setState('idle', 'Voice sample finished.'));
  });
  window.addEventListener('pagehide', () => { if (state !== 'idle') stop(); });
  setState('idle');
})();
