// Polskie znaki w calym interfejsie: kazdy tekst dopisany do strony przechodzi przez PlText.
// Bez ruszania tego, co pisze uzytkownik i wynikow narzedzi (pola, kod, modul Narzedzia, [data-raw]).
(function () {
  const P = window.PlText;
  if (!P) return;
  const SKIP = 'input, textarea, select, script, style, pre, code, canvas, svg, [contenteditable], [data-raw], [data-win="tools"], .vout';

  const skip = (node) => {
    const e = node.nodeType === 1 ? node : node.parentElement;
    return !e || Boolean(e.closest(SKIP));
  };
  function fixText(node) {
    const v = node.nodeValue;
    if (!v || skip(node)) return;
    const f = P.fix(v);
    if (f !== v) node.nodeValue = f; // poprawiony tekst sie juz nie zmieni, wiec obserwator nie zapetli sie
  }
  function fixAttrs(e) {
    if (e.closest(SKIP.replace('input, textarea, select, ', ''))) return;
    ['placeholder', 'title'].forEach((a) => {
      const v = e.getAttribute(a);
      if (!v) return;
      const f = P.fix(v);
      if (f !== v) e.setAttribute(a, f);
    });
  }
  function walk(root) {
    if (root.nodeType === 3) return fixText(root);
    if (root.nodeType !== 1) return;
    if (root.hasAttribute('placeholder') || root.hasAttribute('title')) fixAttrs(root);
    if (root.closest(SKIP) && !root.matches('input, textarea, select')) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n = w.nextNode();
    while (n) {
      if (n.nodeType === 3) fixText(n);
      else if (n.hasAttribute('placeholder') || n.hasAttribute('title')) fixAttrs(n);
      n = w.nextNode();
    }
  }

  const start = () => {
    walk(document.body);
    new MutationObserver((list) => {
      list.forEach((m) => {
        if (m.type === 'characterData') fixText(m.target);
        else if (m.type === 'attributes') fixAttrs(m.target);
        else m.addedNodes.forEach(walk);
      });
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'title'] });
    if (document.title) document.title = P.fix(document.title);
  };
  if (document.body) start();
  else addEventListener('DOMContentLoaded', start);
})();
