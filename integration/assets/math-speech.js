/* Semantic MathML speech; visible formulas remain unchanged. */
(() => {
  function createLectureMathSpeech({
    base = new URL('assets/mathjax-speech/', document.baseURI).href,
    domain = 'clearspeak',
    style = 'default',
    normalizeNorms = true,
    greekIdentifiers = ['Ω']
  } = {}) {
    let handler = null;
    let ready = null;
    const cache = new Map();
    // In this course Ω denotes an open set or a measure-space domain. It is
    // not an electrical unit. Keep this explicit corpus context configurable.
    const identifierSymbols = new Set(greekIdentifiers);
    const options = {
      locale: 'en', modality: 'speech', domain, style,
      enableSpeech: true, enableBraille: false
    };

    async function initialize() {
      if (!ready) {
        ready = (async () => {
          await window.MathJax.startup.promise;
          const Handler = window.MathJax._.a11y.speech.WebWorker.WorkerHandler;
          handler = new Handler(window.MathJax.startup.adaptor, {
            path: base.replace(/\/$/, ''),
            maps: new URL('mathmaps', base).href,
            worker: 'speech-worker.js',
            debug: false
          });
          await handler.Start();
          // Setup is queued until the worker has loaded its local base/en maps.
          await handler.Setup(options);
          return handler;
        })().catch(error => {
          ready = null;
          throw error;
        });
      }
      return ready;
    }

    function inheritedFonts(node, inherited = null) {
      if (node.nodeType !== 1) return;
      const variant = node.getAttribute('mathvariant') || inherited;
      if (variant && /^(mi|mn|mo)$/.test(node.localName || node.nodeName) &&
          !node.hasAttribute('mathvariant')) {
        // Equivalent MathML styling, made explicit only on this detached copy.
        // SRE otherwise loses script L inherited from an mstyle wrapper.
        node.setAttribute('mathvariant', variant);
      }
      if ((node.localName || node.nodeName) === 'mi' &&
          identifierSymbols.has(node.textContent.trim()) &&
          node.getAttribute('mathvariant') === 'normal' && !unitContext(node)) {
        // SRE treats upright Ω as ohms in some compound expressions. The
        // italic identifier role yields its Greek name on this speech copy.
        node.setAttribute('mathvariant', 'italic');
      }
      for (const child of Array.from(node.childNodes)) inheritedFonts(child, variant);
    }

    function unitContext(node) {
      if (/(?:^|:)unit\b/.test(node.getAttribute('intent') || '') ||
          node.getAttribute('data-semantic-role') === 'unit' ||
          /(?:^|\s)(?:unit|MathML-Unit)(?:\s|$)/.test(node.getAttribute('class') || '') ||
          node.hasAttribute('data-unit')) return true;
      // Preserve an ordinary quantity such as 3 Ω, which may legitimately
      // denote resistance outside the integration-course identifier context.
      let before = node.previousSibling;
      while (before && (before.nodeType !== 1 ||
             (before.localName || before.nodeName) === 'mspace')) before = before.previousSibling;
      return before && (before.localName || before.nodeName) === 'mn';
    }

    function normalizeNormScripts(node) {
      if (node.nodeType !== 1) return;
      const name = node.localName || node.nodeName;
      const replacement = {munder: 'msub', mover: 'msup', munderover: 'msubsup'}[name];
      function baseFence(part) {
        if (!part || part.nodeType !== 1) return null;
        const kind = part.localName || part.nodeName;
        if (kind === 'mo') return part.textContent.trim();
        if (kind !== 'mrow' && kind !== 'mstyle') return null;
        const children = Array.from(part.childNodes).filter(child => child.nodeType === 1);
        return children.length === 1 ? baseFence(children[0]) : null;
      }
      const children = Array.from(node.childNodes).filter(child => child.nodeType === 1);
      if (replacement && ['∥', '‖'].includes(baseFence(children[0])) &&
          node.getAttribute('accent') !== 'true' && node.getAttribute('accentunder') !== 'true') {
        let before = node.previousSibling;
        let paired = false;
        while (before) {
          if (before.nodeType === 1) {
            if (['∥', '‖'].includes(baseFence(before))) { paired = true; break; }
            if ((before.localName || before.nodeName) === 'mo' && /[,;]/.test(before.textContent)) break;
          }
          before = before.previousSibling;
        }
        if (paired) {
          // Non-accent indices/powers on a closing norm fence have the same
          // mathematical meaning above/below as in sub/sup positions. SRE
          // otherwise omits the annotations on some embellished fences.
          const normalized = node.ownerDocument.createElementNS(node.namespaceURI, replacement);
          for (const attribute of Array.from(node.attributes)) {
            if (attribute.name !== 'accent' && attribute.name !== 'accentunder') {
              normalized.setAttribute(attribute.name, attribute.value);
            }
          }
          while (node.firstChild) normalized.appendChild(node.firstChild);
          node.parentNode.replaceChild(normalized, node);
          node = normalized;
        }
      }
      for (const child of Array.from(node.childNodes)) normalizeNormScripts(child);
    }

    function normFenceIds(node, found = []) {
      if (node.nodeType !== 1) return found;
      if (node.getAttribute('data-semantic-type') === 'fenced' &&
          node.getAttribute('data-semantic-role') === 'metric') {
        const ids = (node.getAttribute('data-semantic-content') || '').split(',');
        const fences = [];
        function collect(part) {
          if (part.nodeType !== 1) return;
          if (ids.includes(part.getAttribute('data-semantic-id')) &&
              (part.localName || part.nodeName) === 'mo') fences.push(part.textContent.trim());
          for (const child of Array.from(part.childNodes)) collect(child);
        }
        collect(node);
        // A binary parallel relation, or prose containing the word metric,
        // does not satisfy this explicit two-sided norm-fence check.
        if (fences.length === 2 && fences.every(value => value === '∥' || value === '‖')) {
          found.push(node.getAttribute('data-semantic-id'));
        }
      }
      for (const child of Array.from(node.childNodes)) normFenceIds(child, found);
      return found;
    }

    async function describe(mathML) {
      if (cache.has(mathML)) return cache.get(mathML);
      const worker = await initialize();
      const semantic = window.MathJax._.a11y.sre_ts;
      const detached = semantic.parseDOM(mathML);
      inheritedFonts(detached);
      normalizeNormScripts(detached);
      // Worker speechFor requires semantic annotations, not raw presentation MathML.
      const enriched = semantic.toEnriched(detached.toString());
      const structure = await worker.speechFor(enriched.toString(), options, undefined);
      let spoken = structure.label;
      if (typeof spoken !== 'string' || !spoken.trim()) {
        throw new Error('No mathematical speech was generated for this expression.');
      }
      if (normalizeNorms) {
        // In these lecture notes, paired double bars denote a norm. SRE calls
        // this generic fence a metric; this optional corpus-specific wording
        // correction never changes MathML or ordinary prose.
        const corrections = normFenceIds(enriched).map(id => {
          const original = structure.speech?.[id]?.['speech-none'];
          if (!original) return null;
          const corrected = original.replace(/^StartMetric\b/, 'Start norm')
            .replace(/\bEndMetric$/, 'End norm')
            .replace(/^the metric of\b/, 'the norm of');
          return { original, corrected };
        }).filter(Boolean).sort((a, b) => b.original.length - a.original.length);
        for (const { original, corrected } of corrections) {
          spoken = spoken.split(original).join(corrected);
        }
      }
      if (cache.size >= 512) cache.delete(cache.keys().next().value);
      cache.set(mathML, spoken);
      return spoken;
    }

    async function stop() {
      if (ready) await ready.catch(() => {});
      if (handler?.ready) await handler.Stop();
      handler = null;
      ready = null;
    }

    return { speak: describe, describe, stop };
  }
  window.LectureMathSpeech = { create: createLectureMathSpeech };
  window.createLectureMathSpeech = createLectureMathSpeech;
})();
