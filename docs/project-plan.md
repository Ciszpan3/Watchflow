# Watchflow - plan i stan projektu

## Cel produktu

Watchflow pomaga widzowi świadomie wybrać film pasujący do czasu, intencji i zainteresowań. Wynikiem jest skończona sesja maksymalnie trzech materiałów albo pięć alternatyw pojedynczego filmu, a nie kolejny nieskończony feed. Analityka twórców pozostaje opcjonalnym dodatkiem.

## Zrealizowany przepływ live

- Google OAuth korzysta z `openid`, `email`, `profile` i `youtube.readonly`.
- Użytkownik jest identyfikowany przez stabilne Google `sub`.
- Refresh token jest szyfrowany AES-256-GCM, a przeglądarka otrzymuje wyłącznie losową sesję w cookie `HttpOnly`.
- Profil widza, synchronizacje, filmy, rekomendacje, kolejka, feedback i otwarcia są zapisywane w PostgreSQL.
- Po logowaniu aplikacja importuje stary lokalny profil tylko raz, jeżeli profil serwerowy nie został jeszcze zmieniony.
- Synchronizacja działa automatycznie po przekroczeniu sześciu godzin oraz ręcznie z 15-minutowym cooldownem.
- Demo jest osobnym, jawnym trybem i nie jest używane jako ukryte uzupełnienie danych live.
- Szkic filtrów oraz ostatni zestaw rekomendacji są przywracane po odświeżeniu. Konto live przechowuje je w PostgreSQL, a demo w wersjonowanych kluczach `localStorage`.
- Avatar Google jest pobierany wyłącznie z zaufanego hosta HTTPS, ograniczony do 1 MB i cache'owany w bazie. Interfejs używa inicjałów, gdy obraz jest niedostępny.

## Sygnały i synchronizacja

Synchronizacja pobiera wszystkie dostępne subskrypcje, maksymalnie 200 ostatnich polubionych filmów oraz po trzy ostatnie materiały z maksymalnie 40 kanałów. Najpierw wybiera kanały występujące w polubieniach, a pozostałe rotuje między synchronizacjami.

Import ma ograniczoną równoległość, limit czasu dla pojedynczych żądań YouTube oraz limit całego zadania. Przerwany proces nie może pozostawić użytkownika z trwałym stanem `RUNNING`: przy następnym uruchomieniu backend oznacza takie zadania jako nieudane i pozwala wykonać ponowną próbę.

Polubienia są sygnałem gustu, a nie osobnym źródłem kandydatów. Historia oglądania i Watch Later pozostają niedostępne przez YouTube Data API.

Nowi twórcy są wyszukiwani maksymalnie dla dwóch języków na sesję. Wyniki `search.list` są przechowywane przez 12 godzin. Atomowy licznik zatrzymuje aplikację przy 80 wywołaniach dziennie, pozostawiając margines bezpieczeństwa.

## Ranking

Ranking jest deterministyczny:

- intencja: 30%;
- temat: 25%;
- profil, polubienia i aktywność: 20%;
- dopasowanie czasu: 15%, gdy limit jest aktywny;
- głębokość i odkrywanie: 10%.

Język i format są filtrami wymaganymi. Wykluczone tematy oraz obejrzane filmy są usuwane. Powtarzające się kanały i tematy otrzymują karę różnorodności. Przy wyłączonym limicie długość nie filtruje ani nie punktuje materiałów. Tryb sesji zwraca do trzech filmów, a tryb pojedynczego filmu pięć alternatyw preferujących długość w zakresie ±20% wskazanego czasu, co najmniej ±5 minut.

W trybie mieszanym sesja preferuje układ subskrypcja, nowy twórca, subskrypcja, a pięć alternatyw kontynuuje ten wzorzec. Tryby wyłączne nie rozszerzają samodzielnie źródła. `Next set` zachowuje wspólny łańcuch i wyklucza wszystkie materiały pokazane na wcześniejszych stronach.

Feedback zmienia kolejne wyniki: obejrzany materiał jest wykluczany, brak zainteresowania obniża tematy, „zbyt długi” czasowo obniża podobne długości, „zbyt częsty” obniża kanał, a zapisanie lub otwarcie wzmacnia temat i kanał.

## Endpointy

- `GET /api/auth/session`, `GET /api/auth/avatar`, `POST /api/auth/logout`, `DELETE /api/auth/youtube`;
- `DELETE /api/viewer/account`;
- `GET /api/viewer/profile`, `PUT /api/viewer/profile`, `GET /api/viewer/signals`;
- `GET /api/viewer/session-draft`, `PUT /api/viewer/session-draft`;
- `POST /api/viewer/sync`;
- `POST /api/recommendations/session`, `GET /api/recommendations/session/latest`;
- `POST /api/recommendations/session/:sessionId/next`;
- `POST /api/recommendations/:videoId/feedback` i `POST /api/recommendations/:videoId/opened`;
- `GET /api/queue`, `POST /api/queue`, `DELETE /api/queue/:videoId`.

## Bezpieczeństwo i limity

- callback OAuth weryfikuje jednorazowy parametr `state`;
- nowa zgoda bez refresh tokena nie usuwa wcześniej zapisanego tokena;
- `invalid_grant` oznacza konto jako wymagające ponownego połączenia bez usuwania profilu;
- CORS z credentials dopuszcza skonfigurowany frontend;
- jeden użytkownik może mieć tylko jedno aktywne zadanie synchronizacji, co wymusza również unikalny klucz w bazie;
- klucze, tokeny i sekrety nigdy nie trafiają do frontendu ani repozytorium.

## Dalszy rozwój

1. Kolejka zewnętrzna dla synchronizacji i ponowień zamiast procesu aplikacji.
2. Rozbudowane testy integracyjne YouTube z nagranymi odpowiedziami API.
3. Live content diet po zebraniu wystarczającej aktywności.
4. Ścieżki edukacyjne tworzone wyłącznie z prawdziwych rekomendacji.
5. Publikacja aplikacji i weryfikacja OAuth przez Google.
