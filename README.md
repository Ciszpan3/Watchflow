# Watchflow

Watchflow pomaga zwykłym użytkownikom YouTube znaleźć filmy dopasowane do dostępnego czasu, bieżącej intencji i własnego gustu. Zamiast nieskończonego feedu aplikacja buduje krótką, wyjaśnialną sesję albo proponuje wybrany zestaw alternatywnych filmów do obejrzenia.

## Co działa

- logowanie Google i trwała sesja w cookie `HttpOnly`;
- szyfrowanie refresh tokenów AES-256-GCM wyłącznie na backendzie;
- trwały profil zainteresowań i onboarding w PostgreSQL;
- synchronizacja subskrypcji, maksymalnie 200 polubień oraz do 50 ostatnich filmów z maksymalnie 60 kanałów na przebieg; około połowa ograniczonej puli kanałów jest rezerwowana dla często oglądanych subskrypcji, a reszta uwzględnia nowe publikacje, polubienia i rotację;
- wyszukiwanie nowych twórców przez profile oparte na oglądanych kanałach, polubieniach i subskrypcjach, uzupełnione szerokimi torami odkrywania dla wybranego tematu;
- jeden jawny temat bieżącej sesji; starsze szkice z wieloma tematami są automatycznie normalizowane do ostatniego wyboru;
- rozpoznawanie konkretnych gier z historii i polubień jako miękka preferencja, a nie obowiązkowy filtr; szerokie `Gaming` obejmuje różne gry, gatunki i kanały;
- ograniczenie liczby wyników z jednego profilu twórcy oraz osobne tory popularnych materiałów ogólnych, dzięki czemu Minecraft, Clash Royale ani inna pojedyncza gra nie mogą zdominować całego zestawu;
- filtry semantyczne dla tematów `Technology` i `Science`, które uwzględniają metadane i kategorię filmu, a nie samo przypadkowe słowo w tytule;
- 12-godzinny cache wyszukiwania i dzienny limit bezpieczeństwa dla YouTube API;
- rozszerzona klasyfikacja tematów korzystająca także z nazwy i opisu kanału, dzięki czemu kanał poświęcony transformacji sylwetki może pasować do `Health & fitness`;
- próg jakości dla odkrywania nowych twórców, który chroni wyniki przed materiałami z przypadkowymi, pojedynczymi wyświetleniami; filmy z subskrypcji pozostają dostępne niezależnie od ich popularności;
- kontrola wieku filmu: 30 dni, 3, 6, 12 lub 24 miesiące albo brak limitu; domyślnie 12 miesięcy;
- dwa tryby rekomendacji: sesja filmów mieszcząca się w łącznym limicie albo alternatywy pojedynczych filmów;
- wybór liczby wyników: 3, 5 lub 10, także przy kolejnych zestawach;
- opcjonalny limit czasu od 5 do 180 minut, wymagane filtry języka i formatu oraz wybór źródła;
- kolejne zestawy bez powtarzania wcześniej pokazanych, obejrzanych lub odrzuconych materiałów;
- trwały szkic filtrów i ostatni zestaw, synchronizowane przez PostgreSQL po zalogowaniu oraz `localStorage` w demo;
- profil smaku przechowywany w PostgreSQL jako źródło prawdy dla zalogowanego użytkownika;
- dobrowolny import maksymalnie 5000 ostatnich wpisów historii z pliku Google Takeout; historia jest parsowana lokalnie i może być wyłączona w profilu;
- osobisty priorytet twórców oparty na liczbie unikalnych obejrzanych filmów, częstotliwości, świeżości, subskrypcjach, polubieniach oraz aktywności w Watchflow; około połowa miejsc z puli subskrypcji jest rezerwowana dla często oglądanych, pasujących kanałów;
- kontrolowane rozpoznawanie kanałów gamingowych oznaczonych przez YouTube jako `Entertainment`, oparte na całym korpusie ich materiałów i historii użytkownika, bez sztywnej listy dozwolonych gier;
- pięć precyzyjnych powodów odrzucenia rekomendacji, cofanie decyzji i ekran zarządzania feedbackiem; wpływ na temat, długość lub kanał wygasa stopniowo przez 30 dni;
- bezpiecznie cache'owany avatar Google i kontrolowane zastępniki brakujących obrazów;
- trwała kolejka z usuwaniem i sortowaniem po dacie zapisania, publikacji lub długości;
- poziomy `Excellent`, `Strong`, `Good` i `Exploratory` zamiast pozornie precyzyjnego procentu dopasowania;
- rozłączenie YouTube, wylogowanie i trwałe usunięcie konta;
- osobny tryb demo bez logowania, który nigdy nie miesza się z wynikami live.

Historia oglądania i zawartość Watch Later nie są dostępne przez YouTube Data API. Watchflow obsługuje historię wyłącznie przez dobrowolny import `watch-history.json` z Google Takeout: surowy plik jest czytany w przeglądarce, a do aplikacji trafiają tylko znormalizowane wpisy. Personalizacja może korzystać z subskrypcji, polubień, zaimportowanej historii, jawnego profilu oraz aktywności wykonanej wewnątrz aplikacji.

## Architektura

```text
React + TypeScript
  -> API Express z cookie sesyjnym
    -> Google OAuth / YouTube Data API
    -> Prisma 7 + PostgreSQL
    -> cache synchronizacji i wyszukiwania
    -> deterministyczny ranking oraz feedback
```

## Stack

- React 19, TypeScript i Vite;
- Node.js, Express i TypeScript;
- Prisma ORM 7 z adapterem `@prisma/adapter-pg`;
- PostgreSQL;
- Google OAuth 2.0 i YouTube Data API v3;
- Vitest i Testing Library.

## Szybki start

Po utworzeniu bazy PostgreSQL `watchflow` z wymaganym kodowaniem `UTF8`:

```powershell
npm install
Copy-Item .env.example backend/.env
Copy-Item frontend/.env.example frontend/.env
# Uzupełnij DATABASE_URL, dane Google i TOKEN_ENCRYPTION_KEY.
npm run db:generate
npm run db:migrate
npm run dev:backend
```

W drugim terminalu:

```powershell
npm run dev:frontend
```

Frontend używa stałego adresu `http://localhost:5173`. Jeżeli port jest zajęty, skrypt zatrzyma się zamiast zmienić port i zepsuć przekierowanie OAuth.

Pełna instrukcja dla Windows, macOS i Linux, konfiguracja PostgreSQL, Google Cloud, użytkownicy testowi i rozwiązywanie problemów znajdują się w [docs/uruchomienie-lokalne.md](docs/uruchomienie-lokalne.md).

## Weryfikacja

```powershell
npm run db:validate
npm run db:status
npm run lint
npm test
npm run build
```

Sekrety muszą pozostać w ignorowanym pliku `backend/.env`. Frontend przechowuje wyłącznie publiczny adres API.
