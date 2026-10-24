// Laduje skrypty rozszerzen SYNCHRONICZNIE (document.write w trakcie
// parsowania strony) - dzieki temu kazdy z nich zdazy sie zarejestrowac w
// JarvisUI, zanim boot() zbuduje dok. Nowa funkcja = nowy plik + wpis tutaj.
(function () {
  const FILES = ['system'];
  FILES.forEach((f) => document.write('<script src="/extras/' + f + '.js"><\/script>'));
})();
