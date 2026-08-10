// AudioWorkletProcessor dziala na dedykowanym watku audio, calkowicie
// niezaleznym od glownego watku (UI, kodowanie klatek wideo, itp.) - w
// przeciwienstwie do przestarzalego ScriptProcessorNode, ktory dzielil
// glowny watek z reszta strony i mogl gubic probki audio przy jakimkolwiek
// zacinieciu (np. kodowanie klatki kamery), co objawialo sie jako
// nieprzewidywalne, duze opoznienia w odpowiedziach Jarvisa.
class LiveAudioProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0] && input[0].length) {
      this.port.postMessage(input[0].slice());
    }
    return true;
  }
}

registerProcessor('live-audio-processor', LiveAudioProcessor);
