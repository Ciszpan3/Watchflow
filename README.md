# Watchflow

Watchflow pomaga zwykłym użytkownikom YouTube znaleźć filmy dopasowane do dostępnego czasu, bieżącej intencji i własnego gustu. Zamiast nieskończonego feedu aplikacja buduje krótką, wyjaśnialną sesję albo proponuje wybrany zestaw alternatywnych filmów do obejrzenia.

Projekt jest pełnostackową aplikacją portfolio: łączy bezpieczne Google OAuth, YouTube Data API, PostgreSQL, kontrolę limitów API oraz deterministyczny ranking, którego wynik użytkownik może zrozumieć i korygować.

## Co działa

- logowanie Google i trwała sesja w cookie `HttpOnly`;
- szyfrowanie refresh tokenów AES-256-GCM wyłącznie na backendzie;
- trwały profil zainteresowań i onboarding w PostgreSQL;
- synchronizacja subskrypcji, maksymalnie 200 polubień oraz 15 ostatnich filmów z wybranych subskrybowanych kanałów;
- wyszukiwanie nowych twórców z 12-godzinnym cache i dziennym limitem bezpieczeństwa;
- pobieranie do 50 wyników wyszukiwania na język oraz filtr kategorii YouTube dla Gaming, aby ograniczyć przypadkowe dopasowania z tytułów;
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
