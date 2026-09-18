# AGENTS.md

## Tożsamość projektu

Projekt nazywa się **Watchflow**. Jest to aplikacja portfolio pomagająca zwykłym użytkownikom YouTube wybrać film dopasowany do dostępnego czasu, nastroju i celu.

Analityka twórców może istnieć jako osobny, opcjonalny moduł, ale nie może dominować produktu, nawigacji, modelu danych ani treści interfejsu.

## Kierunek produktu

- Projektuj dla zwykłych widzów YouTube, a nie przede wszystkim dla właścicieli kanałów.
- Preferuj celowe, skończone sesje oglądania zamiast nieskończonego feedu.
- Wyjaśniaj rekomendacje krótką informacją, dlaczego dany materiał pasuje.
- Pozwalaj użytkownikowi edytować profil zainteresowań i podawać konkretny powód odrzucenia rekomendacji.
- Traktuj przepełnione listy zapisanych filmów, powtarzalne rekomendacje, clickbait i utratę czasu jako problemy produktowe.
- Demo ma pozostać użyteczne bez konfiguracji zewnętrznych usług i wystarczająco dopracowane do prezentacji w portfolio.

## Ograniczenia YouTube Data API

- Nie obiecuj dostępu do historii oglądania użytkownika; YouTube Data API jej nie udostępnia.
- Przyszła personalizacja może korzystać z subskrypcji, polubionych filmów, dostępnych playlist, jawnych preferencji i aktywności wykonanej wewnątrz Watchflow. Historia oglądania i elementy Watch Later nie są dostępne przez YouTube Data API.
- Klucze YouTube API, sekrety klienta OAuth, access tokeny i refresh tokeny przechowuj wyłącznie po stronie backendu.
- Projektuj zapytania z uwzględnieniem limitów API, cache, cooldownów i czytelnych stanów nieaktualnych danych.

## Kierunek techniczny

- Frontend: React i TypeScript.
- Backend: Node.js, Express i TypeScript.
- Planowana trwałość danych: PostgreSQL.
- Google OAuth należy do backendu i powinien używać najmniejszego wystarczającego zakresu uprawnień.
- Dane demonstracyjne i lokalne zasoby wizualne muszą działać bez danych dostępowych.
- Oddzielaj frontend, ranking rekomendacji, integrację YouTube, trwałość danych i opcjonalną analitykę twórców.

## Zasady UX

- Używaj stonowanego, ciemnego interfejsu z czerwienią YouTube przeznaczoną dla głównych akcji i zaznaczeń.
- Nawigacja ma być zrozumiała bez terminologii przeznaczonej dla twórców.
- Zachowuj czytelną hierarchię, stabilne wymiary komponentów, widoczny focus klawiatury, kontrast WCAG AA i obsługę ograniczonego ruchu.
- Obsługuj stany ładowania, pustych danych, rozłączenia, błędu OAuth, wyczerpania limitu i braku rekomendacji.
- Dynamiczna zawartość nie może nachodzić na kontrolki ani powodować niepotrzebnych przeskoków układu.

## Zasady inżynierskie

- Dodawaj testy dla budowania sesji, preferencji, feedbacku rekomendacji, OAuth, limitów API i błędów backendu.
- Nie wyprowadzaj wniosków z niedostępnych danych YouTube i nie przedstawiaj rekomendacji demo jako prawdziwej personalizacji.
- Utrzymuj `.env.example` zgodnie ze zmianami konfiguracji.
- Ważne decyzje produktowe i techniczne zapisuj w `docs/project-plan.md`.

## Git i GitHub

- Jedno ukończone zadanie lub jedna spójna poprawka powinny tworzyć jeden lokalny commit.
- Przed commitem sprawdź diff i uruchom testy odpowiednie do zakresu zmiany.
- Stosuj komunikaty Conventional Commits, między innymi `feat:`, `fix:`, `docs:`, `test:` i `chore:`.
- Dodawaj do indeksu wyłącznie pliki związane z bieżącym zadaniem.
- Nigdy nie commituj plików `.env`, tokenów, kluczy API ani innych sekretów.
- Nie wykonuj `git push` bez jednoznacznego polecenia użytkownika. Po zakończeniu pracy podaj hash lokalnego commita i wynik weryfikacji.

## Język dokumentacji

- `README.md`, pliki w `docs/` i inne pliki opisujące projekt pisz po polsku.
- Zachowaj tę zasadę w przyszłych aktualizacjach, chyba że użytkownik wyraźnie poprosi o inny język.
- Identyfikatory w kodzie i utrwalone terminy techniczne mogą pozostać po angielsku, jeśli poprawia to czytelność.
