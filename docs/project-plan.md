# Watchflow - plan i stan projektu

## Cel produktu

Watchflow pomaga widzowi świadomie wybrać film pasujący do czasu, intencji i zainteresowań. Wynikiem jest skończona sesja albo skończony zestaw alternatyw pojedynczego filmu, a nie kolejny nieskończony feed. Użytkownik może wybrać 3, 5 lub 10 wyników. Analityka twórców pozostaje opcjonalnym dodatkiem.

## Zrealizowany przepływ live

- Google OAuth korzysta z `openid`, `email`, `profile` i `youtube.readonly`.
- Użytkownik jest identyfikowany przez stabilne Google `sub`.
- Refresh token jest szyfrowany AES-256-GCM, a przeglądarka otrzymuje wyłącznie losową sesję w cookie `HttpOnly`.
- Profil widza, synchronizacje, filmy, rekomendacje, kolejka, feedback i otwarcia są zapisywane w PostgreSQL.
- Po logowaniu aplikacja importuje stary lokalny profil tylko raz, jeżeli profil serwerowy nie został jeszcze zmieniony.
- Synchronizacja działa automatycznie po przekroczeniu sześciu godzin oraz ręcznie z 15-minutowym cooldownem.
- Demo jest osobnym, jawnym trybem i nie jest używane jako ukryte uzupełnienie danych live.
- Po zalogowaniu profil z PostgreSQL jest źródłem prawdy. Lokalny profil może zostać przeniesiony tylko raz, gdy konto nie ma jeszcze własnych ustawień.
- Szkic filtrów oraz ostatni zestaw rekomendacji są przywracane po odświeżeniu. Konto live przechowuje je w PostgreSQL, a demo w wersjonowanych kluczach `localStorage`.
- Avatar Google jest pobierany wyłącznie z zaufanego hosta HTTPS, ograniczony do 1 MB i cache'owany w bazie. Interfejs używa inicjałów, gdy obraz jest niedostępny.
- Historia oglądania może zostać zaimportowana z `watch-history.json` pobranego przez Google Takeout. Plik jest parsowany w przeglądarce, do backendu trafia maksymalnie 5000 znormalizowanych wpisów, import automatycznie włącza ten sygnał, a użytkownik może go później wyłączyć w profilu. Historia nie jest pobierana przez YouTube Data API.

## Sygnały i synchronizacja

Synchronizacja pobiera wszystkie dostępne subskrypcje, maksymalnie 200 ostatnich polubionych filmów oraz po maksymalnie 50 ostatnich materiałów z maksymalnie 60 kanałów w jednym przebiegu. Gdy użytkownik włączył zaimportowaną historię, około połowa ograniczonej puli kanałów jest rezerwowana dla jego najczęściej oglądanych subskrypcji. Pozostałe miejsca trafiają najpierw do kanałów, dla których YouTube zgłasza nowe publikacje, następnie do kanałów występujących w polubieniach, a reszta rotuje między synchronizacjami. Dzięki temu ranking nie traci ulubionego twórcy tylko dlatego, że jego materiały nie znalazły się w bieżącej rotacji. Limity można zmienić przez `SUBSCRIPTION_CHANNEL_LIMIT` i `SUBSCRIPTION_VIDEOS_PER_CHANNEL`, przy czym API YouTube ogranicza pojedynczą stronę playlisty do 50 pozycji. Kandydaci z subskrypcji są przechowywani przez 30 dni, więc kolejne synchronizacje budują pulę materiałów zamiast usuwać ją po sześciu godzinach.

Import ma ograniczoną równoległość, limit czasu dla pojedynczych żądań YouTube oraz limit całego zadania. Przerwany proces nie może pozostawić użytkownika z trwałym stanem `RUNNING`: przy następnym uruchomieniu backend oznacza takie zadania jako nieudane i pozwala wykonać ponowną próbę.

Polubienia są sygnałem gustu, a nie osobnym źródłem kandydatów. Historia oglądania i Watch Later pozostają niedostępne przez YouTube Data API.

Nowi twórcy są wyszukiwani przez maksymalnie trzy profile oparte na rzeczywistych sygnałach użytkownika oraz dwa szerokie tory odkrywania dla bieżącego tematu. Profile mogą pochodzić z najczęściej oglądanych kanałów, polubień lub subskrypcji, ale same metadane ostatnich filmów subskrybowanego kanału nie wystarczają do uznania konkretnej gry za zainteresowanie użytkownika. Przy temacie Gaming rozpoznane gry otrzymują dodatkowe punkty tylko wtedy, gdy powtarzają się w zaimportowanej historii albo polubieniach. Są miękką preferencją rankingu, nigdy wymaganiem wobec wszystkich kandydatów. Kanał źródłowy oraz jego warianty `More`, `Plus`, `Clips` i podobne nie są przedstawiane jako nowy twórca.

Zapytania nowych twórców w Gaming używają `videoCategoryId=20`, żeby odsiać materiały, w których przypadkowo pojawiło się słowo „game”. Dla subskrypcji kategoria YouTube nie jest jednak jedyną bramką: często oglądany kanał oznaczony jako `Entertainment` może zostać rozpoznany jako gamingowy, jeżeli powtarzalne dowody występują w jego tytułach, opisach, tagach, linkach i zaimportowanej historii użytkownika. Wyjątek nie dotyczy nieznanych twórców i jest ograniczony do jednego filmu danego kanału w zestawie. Oprócz profili twórców aplikacja uruchamia szerokie wyszukiwanie popularnych materiałów typu variety/multiplayer oraz indie/gameplay. Wyniki z jednego profilu i kanału są limitowane, dlatego Minecraft, Clash Royale ani inna pojedyncza gra nie mogą zdominować zestawu, a pozostałe gatunki pozostają dostępne. Ogólne etykiety takie jak `gaming`, `video` czy `obejrzano` nie są sygnałem gustu. Każda sesja korzysta wyłącznie z kandydatów zwróconych dla jej aktualnych profili, a wersjonowany cache nie może przywrócić puli z poprzedniego algorytmu.

Użytkownik wybiera jeden temat bieżącej sesji. Interfejs zastępuje poprzedni wybór zamiast kumulować wiele tematów, a backend normalizuje także starsze szkice i żądania. Dzięki temu wybranie `Technology` albo `Science` nie pozostawia ukrytego filtra `Gaming`. Dla tych dwóch szerokich tematów dodatkowa walidacja semantyczna sprawdza kategorię YouTube oraz kilka konkretnych sygnałów z tytułu, opisu, tagów i kontekstu kanału. Chroni to wyniki przed przypadkowymi trafieniami takimi jak sportowy kanał z nazwą uczelni zawierającą słowo „Tech” albo fabularny film ze słowem „space”.

Limit publikacji wynosi: 30 dni, 3, 6, 12 lub 24 miesiące albo brak limitu; domyślnie obowiązuje 12 miesięcy. Wybrane okno trafia do `publishedAfter` i klucza cache. Przy braku limitu starsze materiały są dozwolone, ale otrzymują karę wieku. Wyniki `search.list` są przechowywane przez 12 godzin. Atomowy licznik zatrzymuje aplikację przy 80 wywołaniach dziennie, pozostawiając margines bezpieczeństwa. Odkrywanie nowych twórców wymaga domyślnie co najmniej 25 000 wyświetleń (`MINIMUM_NEW_CREATOR_VIEWS`) oraz wiarygodnego poziomu polubień; ten próg nie dotyczy kanałów, które użytkownik świadomie subskrybuje. Filtr języka respektuje kody YouTube i odrzuca również oczywiste materiały w innych językach, gdy API nie podało kodu.

## Ranking

Ranking jest deterministyczny. Temat filmu jest wyznaczany z tytułu, opisu, tagów oraz kontekstu kanału, czyli jego nazwy i opisu. Dzięki temu wybór `Health & fitness` obejmuje także kanały opisujące transformacje sylwetki bez słowa „health” w każdym tytule. Dodatkowo materiały z kategorią YouTube Gaming nie przechodzą filtra finansowego tylko dlatego, że w tytule pojawiło się słowo „money”.

Ranking korzysta z następujących sygnałów:

- intencja: do 30 punktów;
- temat: do 25 punktów;
- profil, polubienia i aktywność: do 20 punktów;
- dopasowanie czasu: do 15 punktów, gdy limit jest aktywny;
- świeżość i feedback odejmują punkty od wyniku wewnętrznego.
- popularność i proporcja polubień wzmacniają odkrywanie nowych twórców, a domyślny próg 25 000 wyświetleń odrzuca przypadkowe materiały o minimalnym ruchu;
- wybrana intencja wpływa na ranking na podstawie sklasyfikowanych metadanych filmu, np. `Solve a problem` preferuje poradniki i instrukcje, a `Keep me company` rozmowy i podcasty; aplikacja nie deklaruje zgodności intencji tylko dlatego, że podobne słowo znalazło się w zapytaniu.

Zaimportowana historia nie jest traktowana jako luźny tag przypięty do każdego filmu z tej samej kategorii. Po imporcie sygnał jest automatycznie włączany, a użytkownik może go później wyłączyć w profilu. Profile odkrywania liczą częstotliwość oglądania konkretnych kanałów, wzmacniają polubienia i subskrypcje, rozpoznają gry z metadanych oraz dbają o różnorodność między profilami. Sama szeroka kategoria, np. `Gaming`, nie wystarcza. Komunikat na karcie wskazuje konkretny kanał z historii, subskrypcji lub polubień, który był podstawą wyszukiwania. Historia nie zastępuje wybranego tematu sesji.

Osobisty wynik twórcy korzysta z liczby unikalnych obejrzanych filmów, częstotliwości i świeżości oglądania oraz polubień, otwarć i zapisów. Wielokrotne odtworzenie tego samego filmu ma ograniczony wpływ. Nazwy kanałów są normalizowane i łączone w bezpieczne rodziny, np. kanał główny oraz wariant `Plus`. W puli subskrypcji około połowa miejsc jest najpierw proponowana często oglądanym twórcom, o ile ich materiały spełniają bieżące filtry. Nadal obowiązuje limit dwóch filmów jednego kanału.

Wynik liczbowy służy wyłącznie do sortowania. Interfejs pokazuje `Excellent fit`, `Strong fit`, `Good fit` albo `Exploratory pick` oraz maksymalnie trzy rzeczywiste sygnały. Nie są używane suwaki głębokości, tempa ani znajomości, których nie da się wiarygodnie wyprowadzić z metadanych YouTube.

Język i format są filtrami wymaganymi. Wykluczone tematy oraz obejrzane filmy są usuwane. Powtarzające się kanały i tematy otrzymują karę różnorodności. Przy wyłączonym limicie długość nie filtruje ani nie punktuje materiałów. Oba tryby respektują wybraną liczbę wyników: 3, 5 albo 10. Tryb sesji układa filmy w ramach wspólnego limitu, a tryb pojedynczego filmu preferuje długość w zakresie ±20% wskazanego czasu, co najmniej ±5 minut.

Wybrany limit wieku jest ścisłym filtrem dla obu źródeł. Aplikacja nie uzupełnia zestawu starszymi materiałami. Opcja bez limitu usuwa granicę, lecz zachowuje deterministyczną preferencję świeższych filmów przy podobnym dopasowaniu.

W trybie mieszanym sesja preferuje układ subskrypcja, nowy twórca, subskrypcja, a pięć alternatyw kontynuuje ten wzorzec. Tryby wyłączne nie rozszerzają samodzielnie źródła. `Next set` zachowuje wspólny łańcuch i wyklucza wszystkie materiały pokazane na wcześniejszych stronach.

Feedback zawsze ukrywa konkretny odrzucony film do czasu cofnięcia decyzji. `Already watched` i `Not for me` nie wpływają szerzej. `Show less about this topic`, `Too long right now` oraz `Show this channel less` obniżają odpowiednio wybrany temat, długości zbliżone do odrzuconego filmu albo konkretny kanał. Siła tych trzech preferencji maleje liniowo i osiąga zero po 30 dniach. Użytkownik może od razu użyć `Undo`, usunąć pojedynczą decyzję lub wyczyścić cały feedback w `Taste Profile`. Zapisanie lub otwarcie filmu nadal wzmacnia jego temat i kanał.

## Endpointy

- `GET /api/auth/session`, `GET /api/auth/avatar`, `POST /api/auth/logout`, `DELETE /api/auth/youtube`;
- `DELETE /api/viewer/account`;
- `GET /api/viewer/profile`, `PUT /api/viewer/profile`, `GET /api/viewer/signals`;
- `GET /api/viewer/session-draft`, `PUT /api/viewer/session-draft`;
- `POST /api/viewer/sync`;
- `POST /api/recommendations/session`, `GET /api/recommendations/session/latest`;
- `POST /api/recommendations/session/:sessionId/next`;
- `POST /api/recommendations/:videoId/feedback`, `DELETE /api/recommendations/:videoId/feedback` i `POST /api/recommendations/:videoId/opened`;
- `GET /api/viewer/feedback`, `DELETE /api/viewer/feedback`;
- `GET /api/queue?sort=...`, `POST /api/queue`, `DELETE /api/queue/:videoId`.
- `GET /api/viewer/history`, `POST /api/viewer/history/import`, `DELETE /api/viewer/history`.

Kolejkę można sortować według daty zapisania, daty publikacji i długości. Usunięcie pozycji jest trwałe i ograniczone do konta zalogowanego użytkownika.

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
