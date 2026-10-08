(() => {
  'use strict';

  function initialiseReadingPage() {
    const contents = document.querySelector('details.contents');
    const narrow = window.matchMedia('(max-width: 1120px)');
    const links = Array.from(document.querySelectorAll('.toc-link[href^="#"]'));

    function fitNavigation() {
      if (contents) contents.open = !narrow.matches;
    }
    fitNavigation();
    if (narrow.addEventListener) narrow.addEventListener('change', fitNavigation);
    else narrow.addListener(fitNavigation);

    function targetFor(link) {
      try {
        return document.getElementById(decodeURIComponent(link.hash.slice(1)));
      } catch (_) {
        return null;
      }
    }

    function markCurrent(link) {
      for (const item of links) {
        if (item === link) item.setAttribute('aria-current', 'location');
        else item.removeAttribute('aria-current');
      }
    }

    for (const link of links) {
      link.addEventListener('click', () => {
        markCurrent(link);
        if (contents && narrow.matches) {
          contents.open = false;
          const target = targetFor(link);
          if (target) {
            if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
            window.requestAnimationFrame(() => target.focus({ preventScroll: true }));
          }
        }
      });
    }

    if (contents) {
      contents.addEventListener('keydown', event => {
        if (event.key === 'Escape' && narrow.matches && contents.open) {
          contents.open = false;
          contents.querySelector('summary')?.focus();
          event.preventDefault();
        }
      });
    }

    for (const picker of document.querySelectorAll('select.chapter-picker')) {
      if (!picker.labels?.length && !picker.hasAttribute('aria-label')) {
        picker.setAttribute('aria-label', 'Choose a chapter');
      }
      picker.addEventListener('change', () => {
        const option = picker.selectedOptions[0];
        const href = option?.dataset.href || picker.value;
        if (href) window.location.assign(href);
      });
    }

    const scrollAreas = Array.from(document.querySelectorAll('.math-display, .data-table'));
    let overflowFrame = 0;

    function markScrollableContent() {
      overflowFrame = 0;
      for (const expression of document.querySelectorAll('mjx-container:not([display])')) {
        if (expression.closest('.math-display, .data-table')) continue;
        const block = expression.closest('p, dd, li, h1, h2, h3, h4, figcaption') || expression.parentElement;
        const pieces = Array.from(expression.querySelectorAll('svg'));
        if (!block?.clientWidth || !pieces.length) continue;
        const wide = pieces.some(svg => svg.getBoundingClientRect().width > block.clientWidth + 3);
        expression.classList.toggle('math-inline-scroll', wide);
        expression.classList.toggle('needs-scroll', wide);
        if (wide) {
          expression.setAttribute('tabindex', '0');
          expression.setAttribute('aria-label', 'Mathematical expression; scroll horizontally to see the complete expression.');
        } else if (expression.getAttribute('aria-label') === 'Mathematical expression; scroll horizontally to see the complete expression.') {
          expression.removeAttribute('tabindex');
          expression.removeAttribute('aria-label');
        }
      }
      for (const area of scrollAreas) {
        const overflowing = area.scrollWidth > area.clientWidth + 3;
        area.classList.toggle('needs-scroll', overflowing);
        if (overflowing) {
          if (!area.hasAttribute('tabindex')) {
            area.tabIndex = 0;
            area.dataset.readingTabindex = 'true';
          }
          if (!area.hasAttribute('role')) {
            area.setAttribute('role', 'region');
            area.dataset.readingRole = 'true';
          }
          if (!area.hasAttribute('aria-label') && !area.hasAttribute('aria-labelledby')) {
            area.setAttribute('aria-label', area.classList.contains('data-table')
              ? 'Table; scroll horizontally to see all columns.'
              : 'Mathematical expression; scroll horizontally to see the complete expression.');
            area.dataset.readingLabel = 'true';
          }
        } else {
          if (area.dataset.readingTabindex) {
            area.removeAttribute('tabindex');
            delete area.dataset.readingTabindex;
          }
          if (area.dataset.readingRole) {
            area.removeAttribute('role');
            delete area.dataset.readingRole;
          }
          if (area.dataset.readingLabel) {
            area.removeAttribute('aria-label');
            delete area.dataset.readingLabel;
          }
        }
      }
    }

    function scheduleOverflowCheck() {
      if (!overflowFrame) overflowFrame = window.requestAnimationFrame(markScrollableContent);
    }

    function afterTypesetting() {
      const startup = window.MathJax?.startup?.promise;
      if (!startup) return;
      Promise.resolve(startup).then(
        scheduleOverflowCheck,
        scheduleOverflowCheck
      );
    }

    const page = document.querySelector('.chapter, .course-home');
    let lastReadingWidth = page?.clientWidth;
    let reflowTimer = 0;

    function reflowMathematics() {
      const width = page?.clientWidth;
      if (!width || width === lastReadingWidth) return;
      lastReadingWidth = width;
      window.clearTimeout(reflowTimer);
      reflowTimer = window.setTimeout(() => {
        Promise.resolve(window.MathJax?.startup?.promise).then(() => {
          // MathJax 4 METRICS (110) refreshes container widths and line breaks,
          // retaining the compiled expressions and their reference targets.
          return window.MathJax?.startup?.document?.rerenderPromise?.(110);
        }).then(scheduleOverflowCheck, scheduleOverflowCheck);
      }, 250);
    }

    scheduleOverflowCheck();
    afterTypesetting();
    window.addEventListener('resize', () => {
      reflowMathematics();
      scheduleOverflowCheck();
    }, { passive: true });
    window.addEventListener('load', afterTypesetting, { once: true });
    if (document.fonts?.ready) document.fonts.ready.then(scheduleOverflowCheck);
    if ('ResizeObserver' in window) {
      if (page) new ResizeObserver(() => {
        reflowMathematics();
        scheduleOverflowCheck();
      }).observe(page);
    }

    function markHashLocation() {
      const current = links.find(link => link.hash === window.location.hash);
      if (current) markCurrent(current);
      else if (!window.location.hash && links.length) markCurrent(links[0]);
    }
    markHashLocation();
    window.addEventListener('hashchange', markHashLocation);

    if ('IntersectionObserver' in window && links.length) {
      const targetLinks = new Map();
      for (const link of links) {
        const target = targetFor(link);
        if (target) targetLinks.set(target, link);
      }
      const visible = new Set();
      const observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target);
          else visible.delete(entry.target);
        }
        const first = Array.from(visible).sort((a, b) =>
          a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
        if (first) markCurrent(targetLinks.get(first));
      }, { rootMargin: '-8% 0px -65% 0px', threshold: 0 });
      for (const target of targetLinks.keys()) observer.observe(target);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialiseReadingPage, { once: true });
  } else {
    initialiseReadingPage();
  }
})();
