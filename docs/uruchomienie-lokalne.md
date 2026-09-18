# Uruchomienie Watchflow na własnym komputerze

Ten przewodnik opisuje uruchomienie obecnej wersji demonstracyjnej Watchflow oraz opcjonalne skonfigurowanie połączenia z kontem YouTube przez Google OAuth. Demo rekomendacji działa bez danych dostępowych Google.

## Wymagania

- Node.js 20 lub nowszy;
- npm, instalowany razem z Node.js;
- Git;
- konto Google Cloud tylko wtedy, gdy ma działać przycisk połączenia z YouTube.

PostgreSQL nie jest jeszcze wymagany. Zmienna `DATABASE_URL` jest przygotowana pod kolejny etap projektu, ale obecne demo nie zapisuje danych w bazie.

## Pobranie projektu

### Windows PowerShell

```powershell
git clone https://github.com/Ciszpan3/Watchflow.git
Set-Location Watchflow
npm install
```

### macOS lub Linux

```bash
git clone https://github.com/Ciszpan3/Watchflow.git
cd Watchflow
npm install
```

## Konfiguracja środowiska

Backend i frontend mają oddzielne pliki konfiguracyjne. Sekrety Google mogą znajdować się wyłącznie w `backend/.env`. Frontend otrzymuje tylko publiczny adres API.

### Windows PowerShell

```powershell
Copy-Item .env.example backend/.env
Copy-Item frontend/.env.example frontend/.env
```

### macOS lub Linux

```bash
cp .env.example backend/.env
cp frontend/.env.example frontend/.env
```

Najważniejsze zmienne backendu:

| Zmienna | Znaczenie |
| --- | --- |
| `PORT` | Port API Express, domyślnie `4000`. |
| `CLIENT_ORIGIN` | Dokładny adres frontendu, na który wraca użytkownik po OAuth. |
| `GOOGLE_CLIENT_ID` | Identyfikator klienta OAuth z Google Cloud. |
| `GOOGLE_CLIENT_SECRET` | Sekret klienta OAuth. Nigdy nie trafia do frontendu ani repozytorium. |
| `GOOGLE_REDIRECT_URI` | Callback backendu zarejestrowany w Google Cloud. |
| `YOUTUBE_API_KEY` | Klucz do przyszłych zapytań o publiczne dane YouTube. Nie jest wymagany przez demo. |
| `DATABASE_URL` | Połączenie PostgreSQL przygotowane na przyszłość. |
| `OPENAI_API_KEY` | Opcjonalna konfiguracja przyszłych funkcji AI. |

Frontend używa wyłącznie `VITE_API_BASE_URL`. Dla lokalnego backendu wartość pozostaje równa `http://localhost:4000`.

Pliki `.env` są ignorowane przez Git. Nie należy przesyłać ich przez GitHub, wklejać do zgłoszeń ani publikować na zrzutach ekranu.

## Uruchomienie aplikacji

Otwórz dwa terminale w głównym folderze projektu.

W pierwszym uruchom backend:

```powershell
npm run dev:backend
```

W drugim uruchom frontend:

```powershell
npm run dev:frontend
```

API powinno być dostępne pod `http://localhost:4000`, a aplikacja zwykle pod `http://localhost:5173`. Stan backendu można sprawdzić, otwierając `http://localhost:4000/health`.

Jeżeli port `5173` jest zajęty, Vite wybierze kolejny, na przykład `5174` lub `5175`. Wtedy ustaw ten sam adres w `CLIENT_ORIGIN` w `backend/.env` i ponownie uruchom backend. Ta zmienna decyduje, dokąd callback OAuth przekieruje użytkownika.

## Konfiguracja Google Cloud i YouTube OAuth

Poniższe kroki są potrzebne tylko do przetestowania połączenia konta Google.

1. Otwórz [Google Cloud Console](https://console.cloud.google.com/) i utwórz projekt albo wybierz istniejący.
2. W sekcji API Library włącz **YouTube Data API v3**.
3. Otwórz **Google Auth Platform** i skonfiguruj ekran zgody OAuth.
4. Ustaw typ odbiorców **External** i pozostaw status publikacji **Testing**.
5. W sekcji **Audience** dodaj adres testowy, na przykład `twoj-email@example.com`.
6. W sekcji **Data Access** dodaj zakres `https://www.googleapis.com/auth/youtube.readonly`.
7. W sekcji **Clients** utwórz klienta typu **Web application**.
8. W **Authorized redirect URIs** dodaj dokładnie:

```text
http://localhost:4000/api/auth/google/callback
```

9. Skopiuj Client ID i Client Secret do `backend/.env`:

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:4000/api/auth/google/callback
```

Adres callbacku w Google Cloud i wartość `GOOGLE_REDIRECT_URI` muszą być identyczne, łącznie z protokołem, portem i ścieżką.

## Dlaczego obecnie działa tylko dodany e-mail

Dla aplikacji typu External ze statusem Testing Google zezwala na autoryzację jedynie kontom wpisanym na listę test users. Jeżeli do projektu dodano tylko jeden adres, tylko jego właściciel przejdzie całą ścieżkę OAuth. Pozostałe osoby zwykle zobaczą błąd `403: access_denied`.

Tryb Testing pozwala dodać maksymalnie 100 użytkowników testowych. Autoryzacja użytkownika, a także wydany refresh token przy dostępie offline, wygasają po 7 dniach. Są to ograniczenia Google dla aplikacji w fazie testowej, a nie błąd Watchflow. Szczegóły znajdują się w [dokumentacji zarządzania odbiorcami OAuth](https://support.google.com/cloud/answer/15549945?hl=en).

### Szybkie udostępnienie wersji testowej

Właściciel projektu Google Cloud może dodać adres znajomego do listy test users. Jeżeli znajomy ma uruchomić backend na swoim komputerze, potrzebuje również konfiguracji klienta OAuth. Nie należy przekazywać jej przez repozytorium; dane powinny trafić osobnym, bezpiecznym kanałem i zostać zapisane wyłącznie w jego lokalnym `backend/.env`.

### Niezależna konfiguracja

Bezpieczniejszym rozwiązaniem dla osoby rozwijającej własną kopię projektu jest utworzenie osobnego projektu Google Cloud, klienta OAuth i lokalnego `backend/.env`. Dzięki temu każda osoba zarządza własnymi danymi dostępowymi, listą test users i limitami API.

## Co robi obecna integracja OAuth

- prosi wyłącznie o zakres odczytu `youtube.readonly`;
- żąda dostępu offline i ponownego pokazania ekranu zgody;
- wymienia kod autoryzacyjny na tokeny po stronie backendu;
- nie zapisuje access tokena ani refresh tokena w bazie lub pliku;
- przekierowuje frontend z informacją `refreshToken=present` albo `refreshToken=missing`, ale nie umieszcza samego tokena w adresie;
- nie importuje jeszcze subskrypcji, polubionych filmów ani danych kanału użytkownika.

Publiczne udostępnienie aplikacji korzystającej z wrażliwego zakresu OAuth będzie wymagało przejścia na środowisko produkcyjne i może wymagać weryfikacji przez Google. Opis przygotowania aplikacji znajduje się w [dokumentacji zgodności OAuth](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance).

## Najczęstsze problemy

### `redirect_uri_mismatch`

Sprawdź, czy `GOOGLE_REDIRECT_URI` i Authorized redirect URI w Google Cloud są identyczne. Po zmianie `backend/.env` uruchom backend ponownie.

### `403: access_denied` lub informacja o braku dostępu

Upewnij się, że aplikacja jest w trybie Testing, a używany adres Google znajduje się w sekcji Audience na liście test users. Zmiany w Google Cloud mogą potrzebować kilku minut.

### `Google OAuth is not configured`

Backend nie odnalazł `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` albo `GOOGLE_REDIRECT_URI`. Sprawdź, czy plik nazywa się dokładnie `backend/.env`, a następnie uruchom backend ponownie.

### Powrót OAuth na niewłaściwy port frontendu

Zmień `CLIENT_ORIGIN` w `backend/.env` na adres pokazany przez Vite, na przykład `http://localhost:5175`, i zrestartuj backend. Nie zmieniaj przez to callbacku `GOOGLE_REDIRECT_URI`, jeżeli backend nadal działa na porcie `4000`.

### Frontend nie łączy się z API

Sprawdź, czy backend odpowiada pod `/health` oraz czy `VITE_API_BASE_URL` w `frontend/.env` wskazuje właściwy protokół, host i port. Po zmianie konfiguracji uruchom frontend ponownie.

### Brak refresh tokena

Google nie zawsze zwraca nowy refresh token dla wcześniej zaakceptowanej zgody. Obecna aplikacja ustawia `access_type=offline` i `prompt=consent`, ale nadal jedynie raportuje obecność tokena i go nie zapisuje.

## Kontrola przed udostępnieniem

Przed commitem lub wysłaniem projektu sprawdź:

```powershell
git status --short --ignored
git check-ignore -v backend/.env frontend/.env
npm run lint
npm test
npm run build
```

W indeksie Git nie mogą znajdować się żadne pliki `.env`, tokeny, klucze API ani prywatne adresy używane wyłącznie do konfiguracji Google Cloud.
