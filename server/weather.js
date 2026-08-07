// Darmowe API pogodowe Open-Meteo - bez klucza, bez limitu dla normalnego uzycia.

const WMO_CODES = {
  0: 'bezchmurnie', 1: 'przewaznie bezchmurnie', 2: 'czesciowe zachmurzenie', 3: 'zachmurzenie calkowite',
  45: 'mgla', 48: 'mgla z szadzia',
  51: 'mzawka slaba', 53: 'mzawka umiarkowana', 55: 'mzawka silna',
  61: 'deszcz slaby', 63: 'deszcz umiarkowany', 65: 'deszcz silny',
  66: 'marznacy deszcz slaby', 67: 'marznacy deszcz silny',
  71: 'snieg slaby', 73: 'snieg umiarkowany', 75: 'snieg silny', 77: 'snieg ziarnisty',
  80: 'przelotne opady deszczu', 81: 'przelotne opady deszczu umiarkowane', 82: 'przelotne opady deszczu silne',
  85: 'przelotny snieg slaby', 86: 'przelotny snieg silny',
  95: 'burza', 96: 'burza z gradem', 99: 'silna burza z gradem',
};

export function looksLikeWeatherQuestion(text) {
  return /\bpogod\w*\b/i.test(text);
}

export function extractCity(text) {
  const match = text.match(/\bw\s+([A-ZŁŚŻŹĆŃÓĄĘ][\wąćęłńóśźż-]+(?:\s+[A-ZŁŚŻŹĆŃÓĄĘ][\wąćęłńóśźż-]+)?)/u);
  return match ? match[1] : null;
}

export async function getWeather(city) {
  const geoRes = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=pl&format=json`
  );
  const geoData = await geoRes.json();
  const place = geoData.results?.[0];
  if (!place) return null;

  const forecastRes = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m&timezone=auto`
  );
  const forecastData = await forecastRes.json();
  const current = forecastData.current;
  if (!current) return null;

  return {
    city: place.name,
    country: place.country,
    temperature: current.temperature_2m,
    windSpeed: current.wind_speed_10m,
    humidity: current.relative_humidity_2m,
    condition: WMO_CODES[current.weather_code] || 'nieznane warunki',
  };
}
