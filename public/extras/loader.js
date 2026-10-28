// Laduje skrypty rozszerzen SYNCHRONICZNIE (document.write w trakcie
// parsowania strony) - dzieki temu kazdy z nich zdazy sie zarejestrowac w
// JarvisUI, zanim boot() zbuduje dok. Nowa funkcja = nowy plik + wpis tutaj.
(function () {
  const FILES = ['system', 'approvals', 'analysis', 'agent_gui', 'productivity', 'voiceux', 'macros', 'mail', 'insights', 'themes', 'remote', 'profiles', 'music', 'media', 'timers', 'home', 'clipboard', 'search', 'shell', 'voicefx', 'greet', 'vision', 'automation', 'wakeword', 'hudsfx', 'localvoice', 'holo', 'life', 'toolkit', 'tools', 'widgets2', 'viz'];
  FILES.forEach((f) => document.write('<script src="/extras/' + f + '.js"><\/script>'));
})();
