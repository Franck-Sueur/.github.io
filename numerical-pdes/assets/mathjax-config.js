/* MathJax 4.1.3; local assets and the original MathJax TeX font. */
(() => {
  const base = new URL('assets/mathjax-v4/', document.baseURI).href;
  window.MathJax = {
    loader: {
      paths: {
        mathjax: base,
        'mathjax-tex': base + 'fonts/mathjax-tex-font'
      },
      // Retain the hidden MathML support used with the previous renderer.
      // This tiny component is supplied locally with the course assets.
      load: ['a11y/assistive-mml']
    },
    output: {
      font: 'mathjax-tex',
      fontPath: base + 'fonts/mathjax-tex-font',
      displayOverflow: 'linebreak',
      linebreaks: { inline: true, width: '100%', lineleading: 0.2 }
    },
    svg: { fontCache: 'global' },
    options: {
      enableMenu: false,
      enableExplorer: false,
      enableEnrichment: false,
      enableSpeech: false,
      enableBraille: false,
      enableComplexity: false,
      enableAssistiveMml: true,
      menuOptions: {
        settings: {
          enrich: false,
          collapsible: false,
          speech: false,
          braille: false,
          assistiveMml: true
        }
      }
    }
  };
})();
