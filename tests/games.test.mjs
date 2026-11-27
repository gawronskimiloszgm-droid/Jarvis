import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const G = require('../desktop/games.js');

test('VDF: biblioteki Steama z zagniezdzeniami i ukosnikami w sciezkach', () => {
  // W pliku VDF ukosnik jest podwojony ("D:\\Steam"), po odczycie pojedynczy.
  const bs = String.fromCharCode(92);
  const v = G.parseVdf(`"libraryfolders" { "0" { "path" "D:${bs}${bs}Steam" "apps" { "730" "69947149634" } } "1" { "path" "F:${bs}${bs}Gry${bs}${bs}SteamLibrary" } }`);
  assert.equal(v.libraryfolders['0'].path, `D:${bs}Steam`);
  assert.equal(v.libraryfolders['0'].apps['730'], '69947149634');
  assert.equal(v.libraryfolders['1'].path, `F:${bs}Gry${bs}SteamLibrary`);
});

test('stan gry z manifestu (prawdziwe wartosci z Ready or Not i GROUND BRANCH)', () => {
  const ron = G.steamState({ StateFlags: '1030', buildid: '24942528', TargetBuildID: '25784851', BytesToDownload: '6254487888', BytesDownloaded: '5074176' });
  assert.equal(ron.state, 'pobiera');
  assert.equal(ron.toDownloadGb, 6.2);
  assert.equal(G.steamState({ StateFlags: '4', buildid: '22285733', TargetBuildID: '0', BytesToDownload: '436393312', BytesDownloaded: '436393312' }).state, 'ok');
  assert.equal(G.steamState({ StateFlags: '6', buildid: '1', TargetBuildID: '2' }).state, 'aktualizacja');
  assert.equal(G.steamState({ StateFlags: '518', buildid: '1', TargetBuildID: '2' }).state, 'wstrzymana');
  assert.equal(G.steamState({ StateFlags: '4', buildid: '5', TargetBuildID: '6' }).state, 'aktualizacja', 'nowsza wersja docelowa bez flagi');
});

test('zdublowane instalacje i dopasowanie nazw z aliasami', () => {
  // Prawdziwe wpisy z tego komputera: 1.0.3889 jest nowsza niz 1.0.3411 (porownanie liczb, nie napisow).
  const d = G.duplicates([{ name: 'Grand Theft Auto V', location: String.raw`D:\gta5\GTAV`, sizeGb: 129.2, version: '1.0.3889.0_v1' }, { name: 'Grand Theft Auto V', location: String.raw`C:\Epic Games\GTAV`, sizeGb: 122.7, version: '1.0.3411.0' }, { name: 'X', location: String.raw`C:\X`, sizeGb: 1, version: '1' }]);
  assert.equal(d.length, 1);
  assert.equal(d[0].extraGb, 123, 'do usuniecia starsza wersja');
  assert.equal(d[0].keep, String.raw`D:\gta5\GTAV`);
  assert.deepEqual(d[0].remove, [String.raw`C:\Epic Games\GTAV`]);
  const list = [{ name: 'Counter-Strike 2' }, { name: 'Counter-Strike: Source' }, { name: 'Grand Theft Auto V' }, { name: 'Ready or Not' }];
  assert.equal(G.bestMatch(list, 'cs2').name, 'Counter-Strike 2');
  assert.equal(G.bestMatch(list, 'gta 5').name, 'Grand Theft Auto V');
  assert.equal(G.bestMatch(list, 'ready or not').name, 'Ready or Not');
  assert.equal(G.bestMatch(list, 'minecraft'), null);
});
