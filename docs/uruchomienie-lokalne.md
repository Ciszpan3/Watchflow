# Uruchomienie Watchflow na własnym komputerze

Ten przewodnik prowadzi przez lokalne uruchomienie trybu live z PostgreSQL i Google OAuth. Tryb demo działa bez konta Google, ale backend nadal wymaga bazy do obsługi sesji i endpointów live.

## Wymagania

- Node.js 20.19 lub nowszy;
- npm i Git;
- PostgreSQL, lokalnie używana jest wersja 18;
- projekt Google Cloud z YouTube Data API v3 dla trybu live.

## Pobranie i instalacja

### Windows PowerShell

```powershell
git clone https://github.com/Ciszpan3/Watchflow.git
Set-Location Watchflow
npm install
Copy-Item .env.example backend/.env
Copy-Item frontend/.env.example frontend/.env
```

### macOS lub Linux

```bash
git clone https://github.com/Ciszpan3/Watchflow.git
cd Watchflow
npm install
cp .env.example backend/.env
cp frontend/.env.example frontend/.env
```

Sekrety trafiają wyłącznie do `backend/.env`. Plik `frontend/.env` zawiera tylko publiczny `VITE_API_BASE_URL`.

## PostgreSQL i Prisma

Utwórz pustą bazę `watchflow`. Przykład, gdy polecenia PostgreSQL są dostępne w `PATH`:

```powershell
createdb -U postgres --encoding=UTF8 --template=template0 watchflow
```

Można też utworzyć bazę w pgAdmin, wybierając kodowanie **UTF8**. Jest ono wymagane, ponieważ tytuły i opisy z YouTube mogą zawierać emoji oraz znaki z wielu alfabetów. Następnie dopasuj hasło i port w `backend/.env`:

```env
DATABASE_URL=postgresql://postgres:twoje-haslo@localhost:5432/watchflow
```

Wygeneruj 32-bajtowy klucz szyfrowania refresh tokenów.

### Windows PowerShell

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### macOS lub Linux

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Wynik zapisz tylko lokalnie:

```env
TOKEN_ENCRYPTION_KEY=wygenerowana-wartosc-base64
```

Przygotuj klienta i tabele:

```powershell
npm run db:generate
npm run db:migrate
npm run db:status
```

Nie zmieniaj `TOKEN_ENCRYPTION_KEY` po zapisaniu kont. Stare refresh tokeny nie dadzą się odszyfrować nowym kluczem.

## Konfiguracja Google Cloud

1. Otwórz [Google Cloud Console](https://console.cloud.google.com/) i utwórz lub wybierz projekt.
2. Włącz **YouTube Data API v3**.
3. W **Google Auth Platform** skonfiguruj aplikację **External** w trybie **Testing**.
4. W sekcji **Audience** dodaj konto testowe, np. `twoj-email@example.com`.
5. Dodaj zakres `https://www.googleapis.com/auth/youtube.readonly`. Zakresy `openid`, `email` i `profile` aplikacja dołącza do żądania logowania.
6. Utwórz klienta OAuth typu **Web application**.
7. W **Authorized redirect URIs** dodaj dokładnie:

```text
http://localhost:4000/api/auth/google/callback
```

8. Uzupełnij `backend/.env`:

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:4000/api/auth/google/callback
CLIENT_ORIGIN=http://localhost:5173
```

Tryb Testing przepuszcza tylko konta dodane jako test users. Można dopisać znajomego do tej listy albo poprosić go o utworzenie własnego projektu Google Cloud. Nie należy publikować ani przesyłać sekretu klienta przez GitHub.

Google pozwala na maksymalnie 100 użytkowników testowych. W trybie Testing zgoda i refresh token zwykle wygasają po 7 dniach; wtedy Watchflow zachowa profil i poprosi o ponowne połączenie. Szczegóły: [zarządzanie odbiorcami OAuth](https://support.google.com/cloud/answer/15549945?hl=en).

Publiczne wdrożenie zakresu YouTube może wymagać weryfikacji Google: [zgodność OAuth](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance).

## Uruchomienie

W pierwszym terminalu:

```powershell
npm run dev:backend
```

W drugim:

```powershell
npm run dev:frontend
```

API działa domyślnie pod `http://localhost:4000`, a Vite pod stałym adresem `http://localhost:5173`. Zdrowie API sprawdzisz pod `http://localhost:4000/health`.

Skrypt deweloperski używa `--strictPort`, dlatego przy zajętym porcie `5173` zakończy się czytelnym błędem zamiast po cichu uruchomić frontend na innym porcie. Zamknij stary proces Vite i uruchom polecenie ponownie. `CLIENT_ORIGIN` musi pozostać zgodny z adresem frontendu, a `VITE_API_BASE_URL` powinien wskazywać port backendu `4000`.

## Co dzieje się po logowaniu

- callback sprawdza losowy parametr `state` i zweryfikowany Google ID token;
- konto jest identyfikowane przez Google `sub`, a nie zmienny adres e-mail;
- refresh token jest szyfrowany AES-256-GCM w PostgreSQL i nigdy nie wraca w adresie URL;
- przeglądarka dostaje tylko losowe cookie sesyjne `HttpOnly`, `SameSite=Lax`;
- frontend uruchamia synchronizację, gdy dane są starsze niż sześć godzin;
- ręczna synchronizacja ma 15-minutowy cooldown;
- pojedyncze zapytanie do YouTube jest przerywane po 15 sekundach, a całe zadanie po pięciu minutach;
- kanały są importowane w kontrolowanych grupach po pięć operacji, aby przyspieszyć synchronizację bez przeciążania API;
- po restarcie backendu przerwane zadanie zostaje automatycznie zwolnione i można uruchomić je ponownie;
- wylogowanie usuwa bieżącą sesję, odłączenie usuwa import i token, a usunięcie konta kasuje wszystkie dane użytkownika.

## Najczęstsze problemy

### `redirect_uri_mismatch`

Adres w Google Cloud i `GOOGLE_REDIRECT_URI` muszą być identyczne, łącznie z protokołem, portem i ścieżką.

### `403: access_denied`

Sprawdź, czy konto znajduje się na liście test users i czy aplikacja pozostaje w trybie Testing.

### `oauth_not_configured`

Uzupełnij `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` i `GOOGLE_REDIRECT_URI` w `backend/.env`, a następnie zrestartuj backend.

### `reconnect_required` lub `invalid_grant`

Zgoda albo refresh token wygasły. Kliknij **Reconnect YouTube**. Profil, kolejka i feedback pozostaną w bazie.

### Synchronizacja trwa zbyt długo albo została przerwana

Standardowo pierwsza synchronizacja może potrwać od kilkunastu sekund do kilku minut, zależnie od liczby subskrypcji i odpowiedzi YouTube. Po pięciu minutach zadanie kończy się czytelnym błędem zamiast pozostawać w stanie aktywnym bez końca. Po restarcie backendu przerwane zadanie także zostaje zwolnione automatycznie. Użyj przycisku **Retry sync**, aby rozpocząć nową próbę.

Limity można dostosować w `backend/.env` przez `YOUTUBE_REQUEST_TIMEOUT_MS`, `SYNC_JOB_TIMEOUT_MINUTES` i `SYNC_CONCURRENCY`. Zwiększanie równoległości ponad wartość domyślną `5` nie jest zalecane bez sprawdzenia limitów i stabilności API.

### Błąd połączenia z PostgreSQL

Sprawdź usługę PostgreSQL, nazwę bazy, hasło i port w `DATABASE_URL`. Następnie uruchom `npm run db:status`.

### `DATABASE_URL must point to a UTF8 PostgreSQL database`

Baza została utworzona w lokalnym kodowaniu, na przykład `WIN1250`, które nie obsługuje wszystkich metadanych YouTube. Utwórz nową bazę poleceniem z sekcji **PostgreSQL i Prisma**, przenieś dane i ustaw jej adres w `DATABASE_URL`. Sama zmiana kodowania istniejącej bazy nie jest obsługiwana przez PostgreSQL.

### CORS lub powrót na niewłaściwy frontend

`CLIENT_ORIGIN` musi dokładnie odpowiadać adresowi Vite. Po zmianie zrestartuj backend.

### Zajęty port

Zmień `PORT` backendu albo pozwól Vite wybrać kolejny port. Po zmianie backendu popraw również `VITE_API_BASE_URL` i callback OAuth w Google Cloud.

## Kontrola przed commitem

```powershell
git check-ignore -v backend/.env frontend/.env
npm run db:validate
npm run db:status
npm run lint
npm test
npm run build
git diff --check
```

W repozytorium nie mogą znaleźć się pliki `.env`, tokeny, klucze API, sekrety klienta ani prywatne adresy e-mail.
