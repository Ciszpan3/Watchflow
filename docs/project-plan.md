# Watchflow - plan projektu

## Cel produktu

Watchflow pomaga zwykłym użytkownikom YouTube wybrać film zgodny z ich aktualną intencją, dostępnym czasem i osobistym gustem. Wynikiem jest mała, uporządkowana sesja z jasnym wyjaśnieniem rekomendacji i świadomym punktem zakończenia.

Analityka twórcy pozostaje opcjonalnym przyszłym dodatkiem i nie stanowi głównego przepływu aplikacji.

## Główne historie użytkownika

- Jako widz chcę opisać swoją aktualną potrzebę bez wymyślania dokładnej frazy wyszukiwania.
- Chcę określić czas, temat, język i format materiału.
- Chcę zdecydować, czy rekomendacje mają pochodzić z subskrypcji, od nowych twórców, czy z obu źródeł.
- Chcę rozumieć, dlaczego każdy film został wybrany.
- Chcę kontrolować wykorzystanie subskrypcji i polubionych filmów.
- Chcę poprawiać profil gustu i przekazywać konkretny powód odrzucenia rekomendacji.
- Chcę zakończyć sesję po kilku dobrych materiałach zamiast wejść w nieskończony feed.

## Zakres aktualnego demo

- onboarding uruchamiany po pierwszym poprawnym OAuth;
- trzy kroki: zainteresowania, styl oglądania i źródła;
- zapis stanu `not_started`, `in_progress`, `completed` lub `skipped` w wersjonowanym `localStorage`;
- edycja profilu z dashboardu;
- sześć intencji oraz wybór źródła rekomendacji;
- rozwijane filtry tematu, języka, formatu, głębokości i odkrywania;
- deterministyczny ranking i kontrolowana proporcja źródeł;
- stany pustych wyników bez automatycznego obchodzenia wyboru użytkownika;
- lokalne dane i grafiki demonstracyjne.

Demo nie może sugerować, że przykładowe rekomendacje lub statystyki zostały pobrane z konta użytkownika.

## Kontrakty przyszłego API

- `GET /api/viewer/profile` - profil, status onboardingu i ustawienia domyślne.
- `PUT /api/viewer/profile` - zapis jawnych preferencji użytkownika.
- `GET /api/viewer/signals` - stan połączenia i dostępność sygnałów YouTube.
- `POST /api/recommendations/session` - utworzenie skończonej sesji dla przekazanego kontekstu.
- `POST /api/recommendations/:videoId/feedback` - zapis reakcji i przyczyny odrzucenia.
- `GET /api/queue` - kolejka materiałów zapisana wewnątrz Watchflow.
- `GET /api/learning-paths` - uporządkowane ścieżki edukacyjne.

W obecnym etapie funkcje frontendowego adaptera odpowiadają pierwszym czterem kontraktom, ale korzystają z danych lokalnych. Backend nie tworzy nietrwałej atrapy bazy w pamięci.

## Model preferencji

Profil widza zawiera:

- status i wersję onboardingu;
- kategorie zainteresowań, własne tematy i wykluczenia;
- języki oraz formaty;
- domyślne źródło rekomendacji;
- głębokość, tempo i poziom odkrywania;
- ustawienia audio-friendly i anti-clickbait;
- oddzielne zgody na subskrypcje i polubione filmy.

Żądanie sesji może tymczasowo nadpisać ustawienia profilu, ale ich nie zmienia.

## Strategia rekomendacji

Ranking demonstracyjny jest deterministyczny:

- intencja: 30%;
- temat: 25%;
- profil i zgodność z polubieniami: 20%;
- dopasowanie czasu: 15%;
- głębokość i odkrywanie: 10%.

Język i format są filtrami wymaganymi. Algorytm nakłada karę za powtarzający się kanał lub bardzo podobny temat. Tryb mieszany preferuje układ subskrypcja, nowy twórca, subskrypcja. Tryby wyłączne nigdy samodzielnie nie rozszerzają źródła.

## Granice YouTube API

Zakres `youtube.readonly` może obsłużyć odczyt subskrypcji i polubionych filmów. YouTube Data API nie udostępnia historii oglądania ani elementów Watch Later. Watchflow będzie łączyć dostępne dane z jawnymi preferencjami oraz aktywnością wykonaną wewnątrz aplikacji.

Tokeny i klucze pozostają wyłącznie na backendzie. Prawdziwa integracja wymaga kont użytkowników, szyfrowania refresh tokenów, trwałych sesji, mechanizmu odświeżania oraz kontroli limitów API.

## Następny etap techniczny

1. Dodać PostgreSQL i migracje dla użytkowników, kont Google, profili, sygnałów i sesji rekomendacji.
2. Po OAuth zapisywać zaszyfrowany refresh token i zwracać frontendowi wyłącznie stan sesji.
3. Importować subskrypcje oraz polubione filmy z cache i cooldownem.
4. Zastąpić adapter demo prawdziwymi endpointami bez zmiany typów UI.
5. Dodać zapis feedbacku i aktywności wykonanej w Watchflow.

## Testowanie

- testy rankingu, źródeł, limitów czasu, filtrów i różnorodności;
- testy zapisu, odczytu i uszkodzonego stanu profilu lokalnego;
- testy onboardingu: walidacja, postęp, pominięcie, ukończenie i edycja;
- testy pustych wyników oraz jawnych ograniczeń YouTube API;
- testy OAuth i redakcji tokenów na backendzie;
- kontrola wizualna przy szerokościach około 1440, 1024 i 390 px.
