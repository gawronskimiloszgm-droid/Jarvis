// AudioWorkletProcessor dziala na dedykowanym watku audio, calkowicie
// niezaleznym od glownego watku (UI, kodowanie klatek wideo, itp.) - w
// przeciwienstwie do przestarzalego ScriptProcessorNode, ktory dzielil
// glowny watek z reszta strony i mogl gubic probki audio przy jakimkolwiek
// zacinieciu (np. kodowanie klatki kamery), co objawialo sie jako
// nieprzewidywalne, duze opoznienia w odpowiedziach Jarvisa.
// process() jest wolywane raz na "render quantum" (128 probek) - gdybysmy
// wysylali wiadomosc do glownego watku przy kazdym wywolaniu, robilibysmy
// to ~300+ razy na sekunde zamiast dawnych ~10-12 (jak przy
// ScriptProcessorNode o buforze 4096), co zalewa WebSocket i glowny watek.
// Buforujemy wiec probki tutaj i wysylamy w kawalkach zblizonej wielkosci
// do starego zachowania.
class LiveAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    this.bufferedLength = 0;
    this.targetLength = 4096;
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input[0] && input[0].length) {
      this.buffer.push(input[0].slice());
      this.bufferedLength += input[0].length;
      if (this.bufferedLength >= this.targetLength) {
        const merged = new Float32Array(this.bufferedLength);
        let offset = 0;
        for (const chunk of this.buffer) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }
        this.port.postMessage(merged, [merged.buffer]);
        this.buffer = [];
        this.bufferedLength = 0;
      }
    }
    return true;
  }
}

registerProcessor('live-audio-processor', LiveAudioProcessor);
