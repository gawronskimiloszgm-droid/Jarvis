// Pomocnicze funkcje do budowy czesci multimodalnej (obraz) dla Gemini.

export function imagePart(base64Data, mimeType) {
  return { inlineData: { mimeType, data: base64Data } };
}
