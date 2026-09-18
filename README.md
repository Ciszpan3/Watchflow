# Watchflow

Watchflow to aplikacja pomagająca zwykłym użytkownikom YouTube znaleźć film dopasowany do aktualnej sytuacji, zamiast bez końca przewijać rekomendacje. Użytkownik określa czas, intencję i źródło materiałów, a aplikacja tworzy krótką, wyjaśnialną sesję z wyraźnym punktem zakończenia.

Projekt jest rozwijany jako pełnostackowa aplikacja portfolio prezentująca Google OAuth, YouTube Data API, kontrolowaną personalizację, projekt backendu świadomy limitów API oraz dopracowany interfejs React.

## Aktualne demo

Interaktywne demo zawiera:

- trzyetapowy onboarding zainteresowań, stylu oglądania i źródeł rekomendacji;
- wersjonowany profil widza przechowywany lokalnie;
- sześć intencji oglądania i cztery limity czasu;
- wybór między subskrypcjami, trybem mieszanym i nowymi twórcami;
- filtry tematu, formatu, języka, głębokości i poziomu odkrywania;
- osobne ustawienia wykorzystania subskrypcji i polubionych filmów;
- maksymalnie trzy rekomendacje z wyjaśnieniem oraz naturalnym końcem sesji;
- zapisywanie i semantyczne odrzucanie rekomendacji;
- przykładową kolejkę, ścieżkę edukacyjną i content diet;
- responsywny ciemny interfejs dla desktopu, tabletu i telefonu.

Wszystkie rekomendacje i statystyki są wyraźnie oznaczone jako dane demonstracyjne. Połączenie OAuth działa, ale aplikacja nie importuje jeszcze danych użytkownika i nie zapisuje tokenów.

## Dostępne sygnały YouTube

YouTube Data API pozwala w przyszłości wykorzystać między innymi:

- kanały zasubskrybowane przez użytkownika;
- filmy polubione przez użytkownika;
- publiczne metadane filmów i kanałów;
- dostępne playlisty użytkownika.

API nie udostępnia historii oglądania ani zawartości playlisty Watch Later. Watchflow nie przedstawia tych danych jako dostępnych i opiera przyszłą personalizację także na jawnym profilu oraz aktywności wykonanej wewnątrz aplikacji.

## Architektura

```text
Frontend React
  -> adapter kontraktów widza
    -> Node/Express API
      -> Google OAuth
      -> YouTube Data API
      -> PostgreSQL i cache
      -> deterministyczny ranking
      -> opcjonalne wyjaśnienia AI
```

Obecne demo korzysta z lokalnego adaptera o kształcie przyszłych endpointów. Dzięki temu UI można później przełączyć na prawdziwy backend bez przebudowy modelu profilu i sesji.

## Stack

- React 19 i TypeScript
- Vite
- Node.js i Express
- Google OAuth 2.0
- YouTube Data API v3
- PostgreSQL planowany dla trwałego przechowywania
- Vitest i Testing Library

## Uruchomienie lokalne

```powershell
npm install
Copy-Item .env.example backend/.env
Copy-Item frontend/.env.example frontend/.env
npm run dev:backend
npm run dev:frontend
```

Backend i frontend uruchamia się w osobnych terminalach. Frontend zwykle otwiera się pod `http://localhost:5173`; jeżeli Vite wybierze inny port, trzeba zaktualizować `CLIENT_ORIGIN` w `backend/.env` i ponownie uruchomić backend.

Pełna instrukcja dla Windows, macOS i Linux, konfiguracja Google Cloud oraz opis dostępu dla użytkowników testowych znajdują się w pliku [docs/uruchomienie-lokalne.md](docs/uruchomienie-lokalne.md). Nigdy nie zapisuj prawdziwych sekretów ani tokenów w repozytorium.

## Status projektu

Dashboard, onboarding, profil widza i ranking demonstracyjny są interaktywne. Kolejny etap obejmie konta użytkowników, szyfrowane przechowywanie refresh tokenów, import subskrypcji i polubień oraz trwałość w PostgreSQL.
