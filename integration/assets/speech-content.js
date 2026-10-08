/* Capture the source HTML before MathJax replaces its MathML. No DOM writes. */
(() => {
  'use strict';

  const omittedTags = new Set([
    'script', 'style', 'template', 'noscript', 'nav', 'header', 'footer', 'aside',
    'form', 'button', 'input', 'select', 'option', 'textarea', 'svg',
    'mjx-container', 'mjx-assistive-mml'
  ]);
  const omittedClasses = new Set([
    'skip-link', 'sidebar', 'course-header', 'course-links', 'contents',
    'chapter-list', 'course-list', 'start-reading', 'previous-next',
    'chapter-footer', 'reference-anchor', 'reader-toolbar', 'reader-controls',
    'speech-toolbar', 'speech-controls', 'lecture-speech-toolbar'
  ]);
  const blockTags = new Set([
    'main', 'article', 'section', 'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'dl', 'dt', 'dd', 'ol', 'ul', 'li', 'figure', 'figcaption', 'table',
    'blockquote', 'pre', 'details', 'summary', 'address', 'hr'
  ]);
  const tag = node => (node.localName || '').toLowerCase();
  const classes = node => (node.getAttribute('class') || '').split(/\s+/);
  const hasClass = (node, name) => classes(node).includes(name);
  const children = node => Array.from(node.childNodes || []);
  const elements = node => children(node).filter(child => child.nodeType === 1);
  const whitespace = value => String(value || '').replace(/\s+/g, ' ');

  function omitted(node) {
    return omittedTags.has(tag(node)) || node.hasAttribute('hidden') ||
      node.getAttribute('aria-hidden') === 'true' ||
      node.hasAttribute('data-speech-ignore') || node.hasAttribute('data-reader-ignore') ||
      classes(node).some(name => omittedClasses.has(name));
  }

  function find(node, predicate) {
    for (const child of elements(node)) {
      if (predicate(child)) return child;
      const result = find(child, predicate);
      if (result) return result;
    }
    return null;
  }

  function addText(tokens, value) {
    const text = whitespace(value);
    if (!text) return;
    const previous = tokens[tokens.length - 1];
    if (previous?.kind === 'text') previous.text = whitespace(previous.text + text);
    else tokens.push({kind: 'text', text});
  }

  function cleanTokens(tokens) {
    const result = [];
    for (const token of tokens) {
      if (token.kind === 'text') addText(result, token.text);
      else result.push(token);
    }
    if (result[0]?.kind === 'text') result[0].text = result[0].text.trimStart();
    if (result[result.length - 1]?.kind === 'text') {
      result[result.length - 1].text = result[result.length - 1].text.trimEnd();
    }
    return result.filter(token => token.kind !== 'text' || token.text);
  }

  function mathToken(node) {
    return {
      kind: 'math',
      mathml: new XMLSerializer().serializeToString(node),
      display: node.getAttribute('display') === 'block'
    };
  }

  // Suppress only an alt that repeats the figure's entire non-mathematical caption.
  function imageDescription(node) {
    const alt = whitespace(node.getAttribute('alt')).trim();
    if (!alt) return '';
    let figure = node.parentElement;
    while (figure && tag(figure) !== 'figure' && tag(figure) !== 'main') {
      figure = figure.parentElement;
    }
    if (tag(figure || {}) === 'figure') {
      const caption = find(figure, child => tag(child) === 'figcaption');
      if (caption && !find(caption, child => tag(child) === 'math')) {
        const comparable = text => whitespace(text).trim().toLowerCase()
          .replace(/^figure\s+[\d.]+\s*[:.]?\s*/i, '').replace(/[.!]\s*$/, '');
        if (comparable(alt) === comparable(caption.textContent)) return '';
      }
    }
    return alt;
  }

  // Used for atomic displays, table cells and list labels, never whole prose containers.
  function inlineTokens(node) {
    const tokens = [];
    function visit(current) {
      if (current.nodeType === 3) { addText(tokens, current.nodeValue); return; }
      if (current.nodeType !== 1 || omitted(current)) return;
      const name = tag(current);
      if (name === 'math') { tokens.push(mathToken(current)); return; }
      if (name === 'img') { addText(tokens, imageDescription(current)); return; }
      if (name === 'br') { addText(tokens, ' '); return; }
      for (const child of children(current)) visit(child);
      if (blockTags.has(name) || name === 'td' || name === 'th' || hasClass(current, 'head')) {
        addText(tokens, ' ');
      }
    }
    visit(node);
    return cleanTokens(tokens);
  }

  function headingId(heading, main) {
    if (heading.id) return heading.id;
    // LaTeXML attaches section anchors to the surrounding section, not the h2/h3.
    let parent = heading.parentElement;
    while (parent && parent !== main) {
      if (tag(parent) === 'section' && parent.id) return parent.id;
      parent = parent.parentElement;
    }
    return find(heading, child => Boolean(child.id))?.id || null;
  }

  function equationTable(node) {
    return tag(node) === 'table' && classes(node).some(name =>
      /^equation\*?$/.test(name) || name === 'ltx_equation' || name === 'ltx_eqn_table');
  }

  function capture(main) {
    if (!main || main.nodeType !== 1) return [];
    const chunks = [];
    let sectionId = main.id || null;

    function emit(element, kind, tokens) {
      const cleaned = cleanTokens(tokens);
      if (!cleaned.length) return;
      // The converter sometimes leaves an end-of-proof glyph as a loose text node.
      if (cleaned.every(token => token.kind === 'text') &&
          /^[\s□∎]+$/.test(cleaned.map(token => token.text).join(''))) return;
      chunks.push({element, sectionId, kind, tokens: cleaned});
    }

    function definitionList(list) {
      let labels = [];
      let labelHost = list;
      function flushLabels() {
        if (labels.length) emit(labelHost, 'list-item', labels);
        labels = [];
      }
      for (const child of children(list)) {
        if (child.nodeType === 1 && !omitted(child) && tag(child) === 'dt') {
          if (labels.length) addText(labels, '; ');
          labels.push(...inlineTokens(child));
          labelHost = child;
        } else if (child.nodeType === 1 && !omitted(child) && tag(child) === 'dd') {
          const start = chunks.length;
          visitBlock(child, 'list-item');
          if (labels.length) {
            addText(labels, ' ');
            if (chunks.length > start) {
              chunks[start].tokens = cleanTokens([...labels, ...chunks[start].tokens]);
            } else emit(child, 'list-item', labels);
            labels = [];
          }
        } else if (child.nodeType === 3 && !child.nodeValue.trim()) {
          continue;
        } else {
          flushLabels();
          if (child.nodeType === 1) visitBlock(child);
          else if (child.nodeType === 3) emit(list, 'text', [{kind: 'text', text: child.nodeValue}]);
        }
      }
      flushLabels();
    }

    function dataTable(table) {
      let rowNumber = 0;
      function visit(node) {
        for (const child of elements(node)) {
          if (omitted(child)) continue;
          if (tag(child) === 'tr') {
            const cells = elements(child).filter(cell => ['td', 'th'].includes(tag(cell)));
            const isHeader = cells.length && cells.every(cell => tag(cell) === 'th');
            const tokens = [{kind: 'text', text: isHeader ? 'Table headings. ' : `Row ${++rowNumber}. `}];
            cells.forEach((cell, index) => {
              if (index) addText(tokens, '; ');
              tokens.push(...inlineTokens(cell));
            });
            // Header MathML is read once, rather than repeated as a label on every row.
            emit(child, 'table-row', tokens);
          } else if (tag(child) === 'caption') {
            emit(child, 'figure', inlineTokens(child));
          } else visit(child);
        }
      }
      visit(table);
    }

    function flow(container, kind) {
      let buffer = [];
      function flush() {
        emit(container, kind, buffer);
        buffer = [];
      }
      function visit(node) {
        if (node.nodeType === 3) { addText(buffer, node.nodeValue); return; }
        if (node.nodeType !== 1 || omitted(node)) return;
        const name = tag(node);
        if (name === 'math') {
          if (node.getAttribute('display') === 'block') {
            flush();
            // MathJax replaces <math>; the containing HTML element survives rerenders.
            emit(container, 'display', [mathToken(node)]);
          } else buffer.push(mathToken(node));
          return;
        }
        if (name === 'img') {
          flush();
          emit(container, 'figure', [{kind: 'text', text: imageDescription(node)}]);
          return;
        }
        if (name === 'br') { addText(buffer, ' '); return; }
        if (blockTags.has(name) || hasClass(node, 'math-display')) {
          flush();
          visitBlock(node, kind === 'figure' ? 'figure' : undefined);
          return;
        }
        for (const child of children(node)) visit(child);
        if (hasClass(node, 'head') || hasClass(node, 'remark-label')) addText(buffer, ' ');
      }
      for (const child of children(container)) visit(child);
      flush();
    }

    function visitBlock(node, inheritedKind) {
      if (omitted(node)) return;
      const name = tag(node);
      if (/^h[1-3]$/.test(name)) sectionId = headingId(node, main) || sectionId;
      if (hasClass(node, 'math-display') || equationTable(node)) {
        // Numbers outside MathML and numbers inside align-label stay in their source order.
        emit(node, 'display', inlineTokens(node));
      } else if (name === 'dl') definitionList(node);
      else if (name === 'table') dataTable(node);
      else if (/^h[1-6]$/.test(name)) emit(node, 'heading', inlineTokens(node));
      else {
        const kind = inheritedKind ||
          (name === 'figure' || name === 'figcaption' ? 'figure' :
            name === 'li' || name === 'dd' || name === 'dt' ? 'list-item' :
              name === 'p' ? 'paragraph' : 'text');
        // Closed details remain captured; the playback controller decides visibility.
        flow(node, kind);
      }
    }

    visitBlock(main);
    return chunks;
  }

  window.LectureSpeechContent = Object.freeze({capture});
})();
