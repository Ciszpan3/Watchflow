# Watchflow

Watchflow pomaga zwykłym użytkownikom YouTube znaleźć kilka filmów dopasowanych do dostępnego czasu, bieżącej intencji i własnego gustu. Zamiast nieskończonego feedu aplikacja buduje maksymalnie trzyczęściową, wyjaśnialną sesję z naturalnym punktem zakończenia.

Projekt jest pełnostackową aplikacją portfolio: łączy bezpieczne Google OAuth, YouTube Data API, PostgreSQL, kontrolę limitów API oraz deterministyczny ranking, którego wynik użytkownik może zrozumieć i korygować.

## Co działa

- logowanie Google i trwała sesja w cookie `HttpOnly`;
- szyfrowanie refresh tokenów AES-256-GCM wyłącznie na backendzie;
- trwały profil zainteresowań i onboarding w PostgreSQL;
- synchronizacja subskrypcji, maksymalnie 200 polubień oraz ostatnich filmów z wybranych subskrybowanych kanałów;
- wyszukiwanie nowych twórców z 12-godzinnym cache i dziennym limitem bezpieczeństwa;
- maksymalnie trzy prawdziwe rekomendacje z informacją, dlaczego pasują;
- wymagane filtry języka i formatu, limit czasu oraz wybór źródła;
- trwała kolejka, rejestrowanie otwarć i feedback wpływający na kolejne wyniki;
- rozłączenie YouTube, wylogowanie i trwałe usunięcie konta;
- osobny tryb demo bez logowania, który nigdy nie miesza się z wynikami live.

Historia oglądania i zawartość Watch Later nie są dostępne przez YouTube Data API, dlatego Watchflow ich nie udaje. Personalizacja wykorzystuje subskrypcje, polubienia, jawny profil oraz aktywność wykonaną wewnątrz aplikacji.

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

Po utworzeniu bazy PostgreSQL `watchflow`:

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
