# Ukrainian defaults and three-language interface

Added during the local review of PR #29, after the financial refactor baseline and its verification. The original baseline remains unchanged.

## Behavior

- New/missing settings use UAH, Ukrainian, 24-hour time, Monday, Europe/Bucharest and +380. Existing explicit workshop settings are preserved; an explicitly empty country code still disables national-number expansion.
- The internal interface defaults to Ukrainian even when the browser requests English. A user's explicit language cookie takes precedence. Only Ukrainian, Russian and English remain available; removed locale cookies fall back to Ukrainian.
- Company/customer phone examples and the company IBAN example use Ukrainian formats in all three interfaces. These are placeholders, not saved contact/bank details.
- Operational finance, receipts, suppliers, payroll, employees, document links, directory screens and additional shared UI labels use a common translation adapter. Document journal captions are bound SQL parameters; stored customer names, product descriptions and accounting data are not rewritten.
- Server action errors and access refusals use the request language. Runtime/database failures still return a generic message without private technical details. Outside a request, domain/background errors retain their original text for logs.
- Calendar controls support all three interface languages. Completion-act labels follow the selected language; the Ukrainian amount-in-words helper is not used for English/Russian documents.
- Corrected 277 existing Russian catalog values that were still English. A regression check now rejects identical English prose in Ukrainian/Russian catalogs while allowing reviewed technical identifiers and product names.
- Removed translation directories: de, es, fr, it, lt, nb, nl, pl, pt-BR, pt-PT, tr. Tests now check the three supported languages; Norwegian regulatory inspection data remains available independently of interface language.

The local review organization was set to the requested defaults without resetting its database. No production data was changed, no existing monetary amounts were converted and no release was performed.

## Verification

- Full unit suite before the final copy-only corrections: 412 files passed, 8 skipped; 4,685 tests passed, 104 skipped. The lower count compared with the earlier financial-refactor run reflects removal of parameterized translation cases for deleted languages.
- Financial integration suite against the dedicated local `finance_test` PostgreSQL database: all 254 tests in 27 files passed.
- Final targeted localization/action-error/inspection audit: 212 tests passed; includes three-language access/runtime error assertions and static translation-call coverage.
- Receipt return UI and action-error focused suite: 41 tests passed.
- SMS suite: 24 tests passed, including +380 fallback, explicit alternative country code, explicit empty setting and already international numbers.
- Final lint passed for 2,106 files; TypeScript and production build passed.

The catalog checks enforce matching keys, nonempty translations and resolution of every static operational translation call. They do not prove human translation quality or every possible external-provider error. Browser smoke checks are recorded separately below; they are not a full end-to-end test of every page or integration.

Raw logs: `/Users/lvovych/Projects/CRM/outputs/refactor-baseline/localization-*.log`.

## Final browser verification

The rebuilt app was restarted at `http://127.0.0.1:3100` against the preserved `crm_refactor_review` database.

- All 45 route/language combinations passed (15 routes × uk/ru/en), HTTP 200 with the expected document language and no browser runtime errors.
- Verified defaults: Ukrainian, UAH, 24-hour time, Monday, Europe/Bucharest and +380. The language selector contains exactly three choices.
- Verified Ukrainian phone and IBAN examples in all three interfaces, and translated operational headings in Russian/English. Existing customer/account names remain unchanged.
- Four Playwright auth-page tests passed, including switching to Russian before login and defaulting to Ukrainian in a fresh English-language browser.
- Final catalog and action-error suite: 206 tests passed, including the new untranslated-English regression check.

E2E signed-out fixtures now explicitly select their intended UI language; the full E2E/cloud suite was not rerun locally. SMTP is not configured and background jobs remain disabled in the review environment. Production build logs contain the existing auth-secret warning during prerendering; the running review server has its explicit test secret configured.

Evidence checksums:

```text
b82897d59492152f4143b58d5408ba3fffb05705548352b6368e991dbff7f6dd  localization-final-tests.log
e03643df969ec47dc6d8e2fa2754ad01518810316585bf6c245aaf45796fad51  localization-finance-tests.log
69d9f917a2aba25d0f2dd5e6c54eca2062ef62cb3ef8f4bcc9a01cc6152ed0ff  localization-final-catalogs.log
b5c364ccad3cb5057fad97d34a26f6c215cac4d598bf0795cc86bafe56037264  localization-auth-e2e.log
03c79c0639a6e7fe8393381e0de8594a67977fad835581204d68865842e691a5  localization-browser-verified.log
c803a421efcee838fd6dbabe6a11d45e2abadad64e5381cda77e8f74e55b70e7  localization-build-verified.log
110736109efd11f6043d2a0e15aab03f66ba89a2ae7acfdc5f0ea6cc64494191  localization-lint.log
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  localization-types.log
```

## Release verification follow-up: PDF text encoding

The full browser suite exposed empty `ToUnicode` entries for Latin B/H after a prior Cyrillic PDF. Fontkit caches composite glyph components without code points; a later Latin document reused those cached glyphs. The page looked correct, but copying/searching its text could lose letters (including UAH).

All server PDF writers now use a shared renderer which loads and primes the embedded Unicode fonts once before rendering. Presentation-form ligatures remain owned by the shaper so ordinary `fi`/`ffi` text remains searchable. A regression test prints Cyrillic first, then checks exact Latin text and currency codes in a second PDF, for both bold-font registration styles. No server or database is needed for this test.

Browser monetary expectations now use UAH; the Stripe/PayPal contract scenario explicitly sets USD and restores the prior setting. The settlement double-submit scenario uses the Ukrainian controls selected by its fixture. The pre-release CI remains the final gate.
