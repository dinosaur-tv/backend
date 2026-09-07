const codeNames: Record<number, string> = {
  0: "Ясно", 1: "Преимущественно ясно", 2: "Переменная облачность", 3: "Пасмурно",
  45: "Туман", 48: "Изморозь", 51: "Лёгкая морось", 53: "Морось", 55: "Сильная морось",
  61: "Небольшой дождь", 63: "Дождь", 65: "Сильный дождь", 71: "Небольшой снег",
  73: "Снег", 75: "Сильный снег", 80: "Ливень", 81: "Ливень", 82: "Сильный ливень",
  95: "Гроза", 96: "Гроза с градом", 99: "Сильная гроза с градом",
};

interface OpenMeteoResponse {
  current?: { temperature_2m?: number; apparent_temperature?: number; weather_code?: number };
  daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[] };
}

export async function saintPetersburgWeather() {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: "59.9386",
    longitude: "30.3141",
    current: "temperature_2m,apparent_temperature,weather_code",
    daily: "temperature_2m_max,temperature_2m_min",
    timezone,
  }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`Weather service returned ${response.status}`);
  const data = await response.json() as OpenMeteoResponse;
  return {
    temperature: Math.round(data.current?.temperature_2m ?? 0),
    feelsLike: Math.round(data.current?.apparent_temperature ?? 0),
    description: codeNames[data.current?.weather_code ?? -1] ?? "Нет данных",
    high: Math.round(data.daily?.temperature_2m_max?.[0] ?? 0),
    low: Math.round(data.daily?.temperature_2m_min?.[0] ?? 0),
    location: "Санкт-Петербург",
  };
}

const timezone = "Europe/Moscow";

