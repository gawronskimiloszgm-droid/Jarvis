// Klient zdalnych zgod: tworzy prosbe na serwerze (push z przyciskami na
// telefon) i czeka na decyzje dlugim zapytaniem. Uzywany przez askConfirm()
// w app.js i przez agenta ekranu.
(function () {
  const UI = window.JarvisUI;
  if (!UI) return;
  const { api } = UI;

  function begin(text, onResult) {
    let closed = false;
    let id = null;

    const closeOnServer = (allow) => {
      if (!id) return;
      api(`/api/approvals/${id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allow: Boolean(allow) }),
      }).catch(() => {});
    };

    (async () => {
      try {
        const created = await api('/api/approvals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        id = created.id;
        // Bez skonfigurowanego push nie ma komu wyslac prosby - zostaje samo
        // lokalne potwierdzenie, nie zawieszamy sie na pusto.
        if (!created.pushConfigured) return;
        while (!closed) {
          const r = await api(`/api/approvals/${id}/wait`);
          if (closed) return;
          if (r.status === 'allowed' || r.status === 'denied') {
            closed = true;
            onResult(r.status === 'allowed');
            return;
          }
          if (r.status === 'expired' || r.status === 'unknown') return;
        }
      } catch {
        /* siec/serwer - lokalne potwierdzenie nadal dziala */
      }
    })();

    return {
      close(allow) {
        if (closed) return;
        closed = true;
        closeOnServer(allow);
      },
    };
  }

  UI.remoteApproval = { begin };
})();
