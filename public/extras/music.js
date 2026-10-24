// "Graj X": serwer zamienia zapytanie na link (Spotify albo YouTube), a link
// otwiera sie od razu i zaczyna grac - na komputerze lokalnie, z telefonu na
// komputerze przez pilota (jesli jest online), w ostatecznosci na tym urzadzeniu.
(function () {
  const UI = window.JarvisUI;
  if (!UI) return;
  const { api, toast } = UI;
  const D = () => window.jarvisDesktop;

  async function hostOnline() {
    try {
      return (await api('/api/remote/status')).online;
    } catch {
      return false;
    }
  }

  UI.clientActions['graj'] = async (p) => {
    const q = String(p?.zapytanie || '').trim();
    if (!q) return toast('Co mam zagrac?');
    let found;
    try {
      found = await api('/api/music/resolve?q=' + encodeURIComponent(q));
    } catch (e) {
      UI.pushSaid?.('jv', 'Nie udalo mi sie znalezc: ' + q + (e.message ? ' (' + e.message + ')' : ''));
      return;
    }
    UI.pushSaid?.('jv', 'Gram: ' + found.nazwa + (found.zrodlo === 'youtube' ? ' (YouTube)' : ''));
    if (D()) return UI.runDeviceAction('otworz-link', { url: found.url });
    if (await hostOnline()) return UI.clientActions['pilot-pc']?.({ akcja: 'otworz-link', wartosc: found.url });
    // Bez komputera: otwieramy na tym urzadzeniu (spotify:... uruchomi aplikacje Spotify).
    window.open(found.url, '_blank') || (location.href = found.url);
  };
})();
